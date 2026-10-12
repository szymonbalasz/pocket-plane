import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseConfig } from "../../config";
import { closeDb, openFileDb } from "../../db/client";
import { campaign } from "../../db/schema";
import { silentLogger } from "../../log";
import { acquireLock, LockHeldError, lockPath } from "../../runtime/lock";
import { readManifest, writeManifest } from "../../runtime/manifest";
import { StartupError, startServer } from "../../server";
import { addPlayer, createCampaign } from "../campaign-management/commands";
import { defineBundle, defineFixture, type FixtureLibrary, step } from "./fixture-types";
import { FixtureError, load, reset, resetAndLoad, resolveBundle } from "./loader";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempConfig(env: Record<string, string> = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pp-loader-test-"));
  dirs.push(dir);
  return parseConfig({
    PP_PORT: "0",
    PP_DATA_DIR: dir,
    PP_DATA_DISPOSABLE: "1",
    PP_DM_SECRET: "loader-test-secret",
    ...env,
  });
}

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
  broken: defineFixture({
    key: "broken",
    kind: "setup",
    requires: ["p1"],
    ownerSpec: "t",
    steps: [step(addPlayer, { name: "OK" }), step(addPlayer, { name: "p1" })],
  }),
  cycA: defineFixture({
    key: "cyc-a",
    kind: "setup",
    requires: ["cyc-b"],
    ownerSpec: "t",
    steps: [],
  }),
  cycB: defineFixture({
    key: "cyc-b",
    kind: "setup",
    requires: ["cyc-a"],
    ownerSpec: "t",
    steps: [],
  }),
  missing: defineFixture({
    key: "missing",
    kind: "setup",
    requires: ["nope"],
    ownerSpec: "t",
    steps: [],
  }),
};

const lib: FixtureLibrary = {
  fixtures: Object.values(fx),
  bundles: [
    defineBundle({ name: "base", includes: [], fixtures: ["campaign", "p1"] }),
    defineBundle({ name: "two", includes: ["base"], fixtures: ["p2", "p1"] }),
    defineBundle({ name: "nested", includes: ["two"], fixtures: ["campaign"] }),
    defineBundle({ name: "no-base", includes: [], fixtures: ["p1"] }),
    defineBundle({ name: "broken", includes: ["base"], fixtures: ["broken"] }),
    defineBundle({ name: "cycle", includes: ["base"], fixtures: ["cyc-a"] }),
    defineBundle({ name: "missing", includes: ["base"], fixtures: ["missing"] }),
    defineBundle({ name: "unknown", includes: ["base"], fixtures: ["what"] }),
  ],
};

describe("resolution (FR-FIX-04, FR-FIX-15)", () => {
  test("FR-FIX-15 flattens includes, dedupes, orders by dependency then declaration", () => {
    expect(resolveBundle(lib, "two").map((f) => f.key)).toEqual(["campaign", "p1", "p2"]);
    expect(resolveBundle(lib, "nested").map((f) => f.key)).toEqual(["campaign", "p1", "p2"]);
    expect(resolveBundle(lib, "broken").map((f) => f.key)).toEqual(["campaign", "p1", "broken"]);
  });

  test("FR-FIX-15 every bundle except base includes base", () => {
    expect(() => resolveBundle(lib, "no-base")).toThrow(/must include "base"/);
  });

  test("FR-FIX-04 unknown bundle / fixture, missing dependency, cycle", () => {
    expect(() => resolveBundle(lib, "zzz")).toThrow(/Unknown bundle/);
    expect(() => resolveBundle(lib, "unknown")).toThrow(/unknown fixture "what"/);
    expect(() => resolveBundle(lib, "missing")).toThrow(/requires unknown fixture "nope"/);
    expect(() => resolveBundle(lib, "cycle")).toThrow(/cycle/);
  });
});

describe("reset and load", () => {
  test("FR-FIX-01/03/09 reset-and-load writes rows and a complete manifest without the DM secret", async () => {
    const config = tempConfig();
    const m = await resetAndLoad(config, lib, "two");
    expect(m.status).toBe("complete");
    expect(m.fixtures).toEqual(["campaign", "p1", "p2"]);
    expect(Object.keys(m.records)).toEqual(["campaign", "p1", "p2"]);
    expect(m.records.p1?.player).toHaveLength(1);
    expect(m.playerLinks.map((l) => l.player)).toEqual(["P1", "P2"]);
    expect(JSON.stringify(readManifest(config.dataDir))).not.toContain(config.dmSecret);
    await reset(config);
    const db = openFileDb(config.dbPath);
    expect(db.select().from(campaign).all()).toHaveLength(0);
    closeDb(db);
    expect(readManifest(config.dataDir)?.status).toBe("empty");
    expect(existsSync(config.assetDir)).toBe(true);
  });

  test("FR-FIX-06 load on a non-empty DB → refuses with 'reset first'", async () => {
    const config = tempConfig();
    await resetAndLoad(config, lib, "base");
    await expect(load(config, lib, "base")).rejects.toThrow(/Reset first/);
  });

  test("FR-FIX-05 a failing step → back to empty, error names bundle, fixture, step, command, message", async () => {
    const config = tempConfig();
    const err = (await resetAndLoad(config, lib, "broken").catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(FixtureError);
    expect(err.message).toContain('bundle "broken"');
    expect(err.message).toContain('fixture "broken"');
    expect(err.message).toContain("step 1");
    expect(err.message).toContain('"player.add"');
    expect(err.message).toContain("already exists");
    expect(readManifest(config.dataDir)?.status).toBe("empty");
    const db = openFileDb(config.dbPath);
    expect(db.select().from(campaign).all()).toHaveLength(0);
    closeDb(db);
  });

  test("FR-FIX-04 pre-flight failure writes nothing", async () => {
    const config = tempConfig();
    await expect(resetAndLoad(config, lib, "cycle")).rejects.toThrow(FixtureError);
    expect(readManifest(config.dataDir)).toBeNull();
    const t = tempConfig();
    await expect(resetAndLoad(t, lib, "zzz")).rejects.toThrow(/Unknown bundle/);
  });
});

describe("guards and locks (FR-FIX-02, 27, 28)", () => {
  test("FR-FIX-02 refuses when the data dir is not flagged disposable", async () => {
    const config = { ...tempConfig(), disposable: false };
    await expect(reset(config)).rejects.toThrow(/not flagged disposable/);
    expect(readManifest(config.dataDir)).toBeNull();
  });

  test("FR-FIX-02 refuses a data dir outside <worktree>/data and the OS temp dir", async () => {
    const config = tempConfig();
    const outside = {
      ...config,
      dataDir: path.join(config.root, "src"),
      dbPath: path.join(config.root, "src", "x.db"),
    };
    await expect(reset(outside)).rejects.toThrow(/not under/);
    const sneaky = { ...config, dbPath: path.join(config.root, "package.db") };
    await expect(reset(sneaky)).rejects.toThrow(/DB path/);
  });

  test("FR-FIX-02/27 refuses while a live lock is held; server refuses while the loader holds it", async () => {
    const config = tempConfig();
    const held = acquireLock(config.dataDir, "loader", "now");
    await expect(reset(config)).rejects.toThrow(LockHeldError);
    await expect(startServer({ config, log: silentLogger })).rejects.toThrow(LockHeldError);
    held.release();
    await reset(config);
  });

  test("FR-FIX-27 a stale lock (dead PID) is cleared with a notice", async () => {
    const config = tempConfig();
    writeFileSync(
      lockPath(config.dataDir),
      JSON.stringify({ owner: "server", pid: 2_147_000_000, port: 1, startedAt: "x" }),
    );
    const notices: string[] = [];
    await reset(config, { notice: (m) => notices.push(m) });
    expect(notices[0]).toMatch(/stale lock/);
    expect(existsSync(lockPath(config.dataDir))).toBe(false);
  });

  test("FR-FIX-28 server start refuses on a resetting/loading manifest; reset-and-load recovers", async () => {
    const config = tempConfig();
    for (const status of ["resetting", "loading"] as const) {
      writeManifest(config.dataDir, {
        status,
        bundle: null,
        fixtures: [],
        records: {},
        dmUrl: null,
        playerLinks: [],
        startedAt: "x",
        durationMs: null,
      });
      await expect(startServer({ config, log: silentLogger })).rejects.toThrow(StartupError);
      await expect(load(config, lib, "base")).rejects.toThrow(/Reset first/);
    }
    const m = await resetAndLoad(config, lib, "base");
    expect(m.status).toBe("complete");
    const running = await startServer({ config, log: silentLogger });
    expect(running.port).toBeGreaterThan(0);
    await running.stop();
  });
});
