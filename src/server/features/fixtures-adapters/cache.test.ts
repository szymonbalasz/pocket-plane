// Bundle snapshot cache (fix/test-fixture-cache): hit / miss, keys, atomic writers, opt-outs.
// FR-FIX-08 (deterministic loads) is what makes a snapshot equal to a replay; FR-FIX-11 is the
// in-process load it speeds up.
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as contextModule from "../../commands/context";
import { armCrashHook } from "../../commands/crash";
import { parseConfig } from "../../config";
import { closeDb, openFileDb } from "../../db/client";
import { stateDigest } from "../../db/digest";
import { campaign, player } from "../../db/schema";
import { addPlayer, createCampaign } from "../campaign-management/commands";
import {
  type CacheSettings,
  codeHash,
  codeKey,
  entryKey,
  parseCacheEnv,
  prune,
  readEntry,
  writeEntry,
} from "./cache";
import { defineBundle, defineFixture, type FixtureLibrary, step } from "./fixture-types";
import { FixtureError, loadInProcess, resetAndLoad, resolveBundle } from "./loader";

const dirs: string[] = [];
afterEach(() => {
  armCrashHook(null);
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // Windows may hold a just-closed DB file a moment longer; the OS temp dir is cleaned up.
    }
  }
});

const temp = (prefix: string) => {
  const d = mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
};

function tempConfig(env: Record<string, string> = {}) {
  return parseConfig({
    PP_PORT: "0",
    PP_DATA_DIR: temp("pp-cache-test-"),
    PP_DATA_DISPOSABLE: "1",
    PP_DM_SECRET: "cache-test-secret",
    ...env,
  });
}

const settings = (extra: Partial<CacheSettings> = {}): Partial<CacheSettings> => ({
  enabled: true,
  verifyAll: false,
  dir: temp("pp-cache-dir-"),
  codeKey: "test-code-key",
  ...extra,
});

const fx = {
  campaign: defineFixture({
    key: "campaign",
    kind: "setup",
    requires: [],
    ownerSpec: "t",
    steps: [step(createCampaign, { name: "C" })],
  }),
  p1: defineFixture({
    key: "p1",
    kind: "setup",
    requires: ["campaign"],
    ownerSpec: "t",
    steps: [step(addPlayer, { name: "P1" })],
  }),
  p2: defineFixture({
    key: "p2",
    kind: "setup",
    requires: ["campaign"],
    ownerSpec: "t",
    steps: [step(addPlayer, { name: "P2" })],
  }),
};

const lib: FixtureLibrary = {
  fixtures: Object.values(fx),
  bundles: [
    defineBundle({ name: "base", includes: [], fixtures: ["campaign", "p1"] }),
    defineBundle({ name: "two", includes: ["base"], fixtures: ["p2"] }),
  ],
};

/** Each real load seeds one context per fixture; a copied snapshot seeds none. */
async function counted<T>(fn: () => Promise<T>): Promise<{ value: T; seeded: number }> {
  const spy = spyOn(contextModule, "seededContext");
  try {
    const value = await fn();
    return { value, seeded: spy.mock.calls.length };
  } finally {
    spy.mockRestore();
  }
}

function rows(dbPath: string) {
  const db = openFileDb(dbPath);
  try {
    return {
      campaigns: db.select().from(campaign).all(),
      players: db.select().from(player).all(),
      digest: stateDigest(db.$client).sha256,
    };
  } finally {
    closeDb(db);
  }
}

const entries = (dir: string, code: string) =>
  existsSync(path.join(dir, code)) ? readdirSync(path.join(dir, code)) : [];

describe("fixture cache (FR-FIX-08, FR-FIX-11)", () => {
  test("FR-FIX-11 cache miss runs the commands and stores; a hit copies the snapshot: same rows, manifest and links", async () => {
    const s = settings();
    const notices: string[] = [];
    const opts = { cache: true, cacheSettings: s, notice: (m: string) => notices.push(m) };
    const a = tempConfig();
    const miss = await counted(() => resetAndLoad(a, lib, "two", opts));
    expect(miss.seeded).toBe(3);
    expect(entries(s.dir as string, "test-code-key")).toHaveLength(1);
    expect(notices.some((n) => n.includes("stored"))).toBe(true);

    const b = tempConfig({ PP_PUBLIC_BASE_URL: "https://example.test" });
    const hit = await counted(() => resetAndLoad(b, lib, "two", opts));
    expect(hit.seeded).toBe(0);
    expect(notices.some((n) => n.includes("copied from"))).toBe(true);
    expect(hit.value.status).toBe("complete");
    expect(hit.value.fixtures).toEqual(miss.value.fixtures);
    expect(hit.value.records).toEqual(miss.value.records);
    // Links are rebuilt for this load's config, from the same tokens.
    expect(hit.value.playerLinks.map((l) => l.url.replace("https://example.test", ""))).toEqual(
      miss.value.playerLinks.map((l) => l.url),
    );
    expect(rows(b.dbPath)).toEqual(rows(a.dbPath));
    expect(existsSync(b.assetDir)).toBe(true);
    expect(JSON.parse(readFileSync(path.join(b.dataDir, "load-manifest.json"), "utf8"))).toEqual(
      hit.value,
    );
  });

  test("FR-FIX-11 the key changes with bundle, test mode, clock anchor and a fixture's definition; not with the DM secret, durability or a same-minute `now`", async () => {
    const order = resolveBundle(lib, "two");
    const base = { bundle: "two", order, testMode: false, anchor: null };
    const k = entryKey(base);
    expect(entryKey({ ...base })).toBe(k);
    expect(entryKey({ ...base, bundle: "other" })).not.toBe(k);
    expect(entryKey({ ...base, testMode: true })).not.toBe(k);
    expect(entryKey({ ...base, anchor: 0 })).not.toBe(k);
    const edited = order.map((f) =>
      f.key === "p2" ? { ...f, steps: [step(addPlayer, { name: "P2b" })] } : f,
    );
    expect(entryKey({ ...base, order: edited })).not.toBe(k);
    const fnInput = order.map((f) =>
      f.key === "p2" ? { ...f, steps: [step(addPlayer, () => ({ name: "P2" }))] } : f,
    );
    expect(entryKey({ ...base, order: fnInput })).not.toBe(k);

    // Through the loader: secret / durable / same-minute `now` hit; another minute misses.
    const s = settings();
    const now = Date.parse("2026-10-22T19:40:31Z");
    const load = (env: Record<string, string>, o: { durable?: boolean; now?: number }) =>
      counted(() =>
        resetAndLoad(tempConfig(env), lib, "two", { cache: true, cacheSettings: s, ...o }),
      );
    expect((await load({}, { now })).seeded).toBe(3);
    expect((await load({ PP_DM_SECRET: "another-secret-1" }, { now, durable: false })).seeded).toBe(
      0,
    );
    expect((await load({}, { now: now + 20_000 })).seeded).toBe(0);
    expect((await load({}, { now: now + 60_000 })).seeded).toBe(3);
    expect((await load({ PP_TEST_MODE: "1" }, { now })).seeded).toBe(3);
  });

  test("FR-FIX-11 the code key hashes file contents under fixtures/ src/server/ src/shared/ and bun.lock, test files left out; PP_FIXTURE_CACHE_KEY overrides it", () => {
    const tree = (files: Record<string, string>) => {
      const root = temp("pp-cache-root-");
      for (const [rel, body] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        writeFileSync(path.join(root, rel), body);
      }
      return root;
    };
    const files = {
      "fixtures/units/a.ts": "a",
      "src/server/x.ts": "x",
      "src/shared/y.ts": "y",
      "bun.lock": "lock",
    };
    const k = codeHash(tree(files));
    expect(codeHash(tree(files))).toBe(k);
    expect(codeHash(tree({ ...files, "src/server/x.ts": "x2" }))).not.toBe(k);
    expect(codeHash(tree({ ...files, "bun.lock": "lock2" }))).not.toBe(k);
    expect(codeHash(tree({ ...files, "fixtures/assets/m.svg": "<svg/>" }))).not.toBe(k);
    expect(codeHash(tree({ ...files, "src/server/x.test.ts": "t" }))).toBe(k);
    expect(codeHash(tree({ ...files, "src/client/z.ts": "z" }))).toBe(k);

    const env = parseCacheEnv({ PP_FIXTURE_CACHE_KEY: "parent-key-123" });
    expect(codeKey("/nowhere", env)).toBe("parent-key-123");
    expect(() => parseCacheEnv({ PP_FIXTURE_CACHE_KEY: "../x" })).toThrow();
  });

  test("FR-FIX-11 PP_FIXTURE_CACHE=0 turns the cache off: real loads, nothing stored", async () => {
    expect(parseCacheEnv({ PP_FIXTURE_CACHE: "0" }).enabled).toBe(false);
    expect(parseCacheEnv({}).enabled).toBe(true);
    expect(parseCacheEnv({}).dir).toBe(path.join(os.tmpdir(), "pp-fixture-cache"));
    expect(parseCacheEnv({ PP_FIXTURE_CACHE_DIR: "/ci/cache" }).dir).toBe(
      path.resolve("/ci/cache"),
    );
    expect(parseCacheEnv({ PP_FIXTURE_CACHE: "verify" }).verifyAll).toBe(true);
    const s = settings({ enabled: false });
    for (let i = 0; i < 2; i++) {
      const r = await counted(() =>
        resetAndLoad(tempConfig(), lib, "base", { cache: true, cacheSettings: s }),
      );
      expect(r.seeded).toBe(2);
    }
    expect(readdirSync(s.dir as string)).toEqual([]);
  });

  test("FR-FIX-11 a load without `cache` (CLI, the loader's own tests) neither reads nor writes the cache; loadInProcess uses it", async () => {
    const s = settings();
    const r = await counted(() => resetAndLoad(tempConfig(), lib, "base", { cacheSettings: s }));
    expect(r.seeded).toBe(2);
    expect(readdirSync(s.dir as string)).toEqual([]);
    const first = await loadInProcess(lib, "base", { cacheSettings: s });
    dirs.push(first.dir);
    const second = await counted(() => loadInProcess(lib, "base", { cacheSettings: s }));
    dirs.push(second.value.dir);
    expect(second.seeded).toBe(0);
    const real = await counted(() =>
      loadInProcess(lib, "base", { cacheSettings: s, cache: false }),
    );
    dirs.push(real.value.dir);
    expect(real.seeded).toBe(2);
  });

  test("FR-FIX-11 an armed crash hook (PP_TEST_CRASH, #163) bypasses the cache: the load runs and reaches the hook", async () => {
    const s = settings();
    await resetAndLoad(tempConfig(), lib, "two", { cache: true, cacheSettings: s });
    expect(entries(s.dir as string, "test-code-key")).toHaveLength(1);
    const hits: string[] = [];
    armCrashHook({ point: "fixture", target: "p2" }, (where) => {
      hits.push(where);
      throw new Error("killed");
    });
    await expect(
      resetAndLoad(tempConfig(), lib, "two", { cache: true, cacheSettings: s }),
    ).rejects.toThrow(/fixture "p2"/);
    expect(hits).toEqual(["fixture:p2"]);
  });

  test('FR-FIX-08 cache "verify" always loads for real; equal to the stored snapshot passes, a differing one fails', async () => {
    const s = settings();
    const verify = () =>
      counted(() => resetAndLoad(tempConfig(), lib, "two", { cache: "verify", cacheSettings: s }));
    expect((await verify()).seeded).toBe(3); // stores
    expect((await verify()).seeded).toBe(3); // compares: equal
    const [entry] = entries(s.dir as string, "test-code-key");
    const metaFile = path.join(s.dir as string, "test-code-key", entry as string, "meta.json");
    const meta = JSON.parse(readFileSync(metaFile, "utf8"));
    meta.records.p2.player = ["not-the-seeded-id"];
    writeFileSync(metaFile, JSON.stringify(meta));
    await expect(verify()).rejects.toThrow(FixtureError);
    await expect(verify()).rejects.toThrow(/cache mismatch/);
    // PP_FIXTURE_CACHE=verify upgrades every cached load.
    const audit = await counted(() =>
      resetAndLoad(tempConfig(), lib, "base", {
        cache: true,
        cacheSettings: { ...s, verifyAll: true },
      }),
    );
    expect(audit.seeded).toBe(2);
  });

  test("FR-FIX-11 a second writer of the same entry loses cleanly: one entry, no temp dir left", () => {
    const s = settings();
    const dir = s.dir as string;
    const snap = {
      bundle: "b",
      fixtures: [],
      records: {},
      players: [],
      db: new Uint8Array([1, 2, 3]),
      assetDir: path.join(dir, "no-assets"),
    };
    expect(writeEntry(dir, "code", "entry", snap, "t")).toBe(true);
    expect(writeEntry(dir, "code", "entry", snap, "t")).toBe(false);
    expect(readdirSync(path.join(dir, "code"))).toEqual(["entry"]);
    expect(readEntry(dir, "code", "entry")?.meta.bundle).toBe("b");
    expect(readEntry(dir, "code", "missing")).toBeNull();
  });

  test("FR-FIX-11 two processes racing on one cold key: both loads complete, one entry is published, no temp dir left", async () => {
    const s = settings();
    const dir = s.dir as string;
    const here = (f: string) => JSON.stringify(pathToFileURL(path.join(import.meta.dir, f)).href);
    const commands = JSON.stringify(
      pathToFileURL(path.join(import.meta.dir, "..", "campaign-management", "commands.ts")).href,
    );
    const startAt = Date.now() + 2_000;
    const child = `
      const { loadInProcess } = await import(${here("loader.ts")});
      const { defineBundle, defineFixture, step } = await import(${here("fixture-types.ts")});
      const { addPlayer, createCampaign } = await import(${commands});
      const lib = {
        fixtures: [
          defineFixture({ key: "campaign", kind: "setup", requires: [], ownerSpec: "t", steps: [step(createCampaign, { name: "C" })] }),
          defineFixture({ key: "p1", kind: "setup", requires: ["campaign"], ownerSpec: "t", steps: [step(addPlayer, { name: "P1" })] }),
        ],
        bundles: [defineBundle({ name: "base", includes: [], fixtures: ["campaign", "p1"] })],
      };
      await Bun.sleep(Math.max(0, ${startAt} - Date.now()));
      const r = await loadInProcess(lib, "base");
      console.log(JSON.stringify(r.manifest.records));
      r.cleanup();
    `;
    const env = {
      ...process.env,
      PP_FIXTURE_CACHE: "1",
      PP_FIXTURE_CACHE_DIR: dir,
      PP_FIXTURE_CACHE_KEY: "race-code-key",
    };
    const spawn = () => Bun.spawn(["bun", "-e", child], { env, stdout: "pipe", stderr: "pipe" });
    const procs = [spawn(), spawn()];
    const outs = await Promise.all(
      procs.map(async (p) => {
        const [out, err, code] = await Promise.all([
          new Response(p.stdout).text(),
          new Response(p.stderr).text(),
          p.exited,
        ]);
        return { out: out.trim(), err, code };
      }),
    );
    for (const o of outs) expect(o).toMatchObject({ code: 0 });
    expect(outs[0]?.out).toBe(outs[1]?.out as string);
    expect(readdirSync(path.join(dir, "race-code-key"))).toHaveLength(1);
    // The published entry serves a third load.
    const third = await counted(() =>
      loadInProcess(lib, "base", { cacheSettings: { ...s, codeKey: "race-code-key" } }),
    );
    dirs.push(third.value.dir);
    expect(third.seeded).toBe(0);
    expect(JSON.stringify(third.value.manifest.records)).toBe(outs[0]?.out as string);
  }, 60_000);

  test("FR-FIX-11 pruning: code dirs unused for a day go, and all but the 6 most recent; the current one stays", () => {
    const dir = temp("pp-cache-prune-");
    const at = (name: string, hoursAgo: number) => {
      mkdirSync(path.join(dir, name));
      const t = (Date.now() - hoursAgo * 3600 * 1000) / 1000;
      utimesSync(path.join(dir, name), t, t);
    };
    at("current", 48);
    at("old", 30);
    for (let i = 1; i <= 6; i++) at(`recent-${i}`, i);
    expect(prune(dir, "current").sort()).toEqual(["old", "recent-6"]);
    expect(readdirSync(dir).sort()).toEqual([
      "current",
      "recent-1",
      "recent-2",
      "recent-3",
      "recent-4",
      "recent-5",
    ]);
  });
});
