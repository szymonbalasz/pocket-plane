// gsb:import end to end: a real in-process server (port 0) on `base`, a written server.lock, the
// real stdio MCP server spawned once (as the CLI does), the invented export in a temp dir.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadBundle } from "@fixtures/index";
import { closeDb, type Db, openFileDb } from "@server/db/client";
import { startTestServer, type TestServer } from "@server/testing/harness";
import { TEST_SECRET } from "@server/testing/services";
import { readDataset } from "./dataset";
import type { Filters } from "./diff";
import { loadLedger } from "./ledger";
import { runImport, type Summary } from "./run";
import { type RawItem, rawItem, type TestExport, testExport, uidOf } from "./testing";
import { connectStdio, type ToolCaller } from "./tools";

const ROOT = path.resolve(import.meta.dir, "..", "..", "..");

let h: TestServer;
let db: Db;
let bundleDir: string;
let lockDir: string;
let cwd: string;
let ledgerDir: string;
let caller: ToolCaller;
let ex: TestExport;
let items: RawItem[];

interface Entry {
  id: string;
  name: string;
  shared: boolean;
  imageAssetIds: string[];
  body: { text: string; typeLine: string };
  facets: Record<string, unknown>;
}
const get = async (id: string) =>
  (await caller.call<{ entry: Entry }>("compendium_get", { id })).entry;
const homebrewItems = async () =>
  (
    await caller.call<{ results: { id: string; name: string; sourceLabel: string }[] }>(
      "compendium_search",
      { q: "Test", kind: "item" },
    )
  ).results.filter((r) => r.sourceLabel === "Homebrew");

async function run(
  opts: {
    apply?: boolean;
    overwrite?: boolean;
    filters?: Filters;
    dir?: string;
    mapperVersion?: number;
  } = {},
): Promise<Summary> {
  ex.write(items);
  return runImport({
    caller,
    dataset: await readDataset(ex.root),
    target: "verify",
    ledgerDir: opts.dir ?? ledgerDir,
    filters: opts.filters ?? {},
    apply: opts.apply ?? false,
    overwrite: opts.overwrite ?? false,
    now: () => "2026-11-06T00:00:00.000Z",
    progress: (l) => progressLines.push(l),
    mapperVersion: opts.mapperVersion,
  });
}
const progressLines: string[] = [];
/** The DM deletes an entry in the client (REST, as the DM client does). */
async function deleteEntry(id: string) {
  const r = await fetch(`${h.http}/api/compendium/entries/${id}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${TEST_SECRET}` },
  });
  expect(r.ok).toBe(true);
}
const ledgerRow = (s: Summary, key: string) => loadLedger(s.ledger).items[uidOf(key)];

beforeAll(async () => {
  const loaded = await loadBundle("base", { dmSecret: TEST_SECRET, testMode: true });
  bundleDir = loaded.dir;
  db = openFileDb(loaded.config.dbPath);
  h = await startTestServer({ db });
  lockDir = mkdtempSync(path.join(os.tmpdir(), "pp-gsb-lock-"));
  cwd = mkdtempSync(path.join(os.tmpdir(), "pp-gsb-cwd-"));
  ledgerDir = mkdtempSync(path.join(os.tmpdir(), "pp gsb ledger "));
  writeFileSync(
    path.join(lockDir, "server.lock"),
    JSON.stringify({
      owner: "server",
      pid: process.pid,
      port: Number(new URL(h.http).port),
      startedAt: "2026-03-01T00:00:00Z",
    }),
  );
  // The parent's env minus every PP_* (no developer .env values), cwd a temp dir (no .env).
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => e[1] !== undefined && !e[0].startsWith("PP_"),
    ),
  );
  caller = await connectStdio({
    root: ROOT,
    args: [],
    env: { ...env, PP_DATA_DIR: lockDir, PP_DM_SECRET: TEST_SECRET, PP_PROFILE: "verify" },
    cwd,
  });
  ex = testExport();
  items = [
    rawItem("alpha", {
      flavor: "It glows a little.",
      images: [await ex.image("imgA1", 1), await ex.image("imgA2", 2, ["original"])],
      image: "assets/images/imgA2/original.png",
    }),
    rawItem("beta", {
      images: [await ex.image("imgB", 3)],
      image: "assets/images/imgB/medium.png",
    }),
    rawItem("gamma", { rarity: "rarity varies", rarities: ["uncommon", "rare"] }),
  ];
}, 30_000);

afterAll(async () => {
  await caller?.close();
  await h?.stop();
  closeDb(db);
  for (const d of [bundleDir, lockDir, cwd, ledgerDir, ex?.root]) {
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

describe("GSB import over the MCP server", () => {
  test("GSB import: dry run lists new items, plan_check ok, writes nothing", async () => {
    const s = await run();
    expect(s.mode).toBe("dry-run");
    expect(s.counts.new).toBe(3);
    expect(s.names.new.shown).toEqual(["Test alpha", "Test beta", "Test gamma"]);
    expect(s.planIssues).toEqual([]);
    expect(s.work).toBe(3);
    expect(await homebrewItems()).toEqual([]);
    expect(loadLedger(s.ledger).items).toEqual({});
  });

  test("GSB import: --limit narrows the work list", async () => {
    const s = await run({ filters: { limit: 1 } });
    expect(s.work).toBe(1);
    expect(s.names.new.shown).toEqual(["Test alpha"]);
    expect(s.filtered).toBe(true);
  });

  test("GSB import: first apply creates the entries unshared, with images, main first", async () => {
    const s = await run({ apply: true });
    expect(s.result).toMatchObject({ created: 3, updated: 0, failed: 0 });
    expect(s.failures).toEqual([]);
    const alpha = ledgerRow(s, "alpha");
    expect(alpha?.imageAssetIds).toHaveLength(2);
    const e = await get(alpha?.entryId as string);
    expect(e.shared).toBe(false);
    expect(e.imageAssetIds).toEqual(alpha?.imageAssetIds as string[]);
    expect(e.body.text).toStartWith("*It glows a little.*");
    expect(e.body.text).toContain(uidOf("alpha"));
    expect(alpha?.imageSha256s[0]).toBe(items[0]?.images[1].files.original.sha256);
    expect((await get(ledgerRow(s, "beta")?.entryId as string)).imageAssetIds).toHaveLength(1);
    const gamma = await get(ledgerRow(s, "gamma")?.entryId as string);
    expect(gamma.facets.rarity).toBe("rarity varies");
    expect(gamma.imageAssetIds).toEqual([]);
    expect(loadLedger(s.ledger).datasetHash).toBe(s.datasetHash);
  });

  test("GSB import: rerun is a no-op", async () => {
    const dry = await run();
    expect(dry.nothingChanged).toBe(true);
    expect(dry.datasetChanged).toBe(false);
    expect(dry.counts.unchanged).toBe(3);
    expect(dry.work).toBe(0);
    const s = await run({ apply: true });
    expect(s.result).toMatchObject({ created: 0, updated: 0, adopted: 0, failed: 0 });
    expect((await homebrewItems()).length).toBe(3);
  });

  test("GSB import: an item changed upstream is updated, images reused", async () => {
    const before = ledgerRow(await run(), "alpha");
    items[0] = {
      ...items[0],
      contentHash: `sha256:${"1".repeat(64)}`,
      description: "Now brighter.",
    };
    const dry = await run();
    expect(dry.counts.changed).toBe(1);
    expect(dry.planIssues).toEqual([]);
    const s = await run({ apply: true });
    expect(s.result).toMatchObject({ created: 0, updated: 1, failed: 0 });
    const row = ledgerRow(s, "alpha");
    expect(row?.entryId).toBe(before?.entryId as string);
    expect(row?.imageAssetIds).toEqual(before?.imageAssetIds as string[]);
    expect((await get(row?.entryId as string)).body.text).toContain("Now brighter.");
  });

  test("GSB import: a DM-edited entry is skipped as locally edited; --overwrite replaces it", async () => {
    const id = ledgerRow(await run(), "beta")?.entryId as string;
    await caller.call("homebrew_edit", { id, patch: { body: { text: "The DM's own words." } } });
    items[1] = {
      ...items[1],
      contentHash: `sha256:${"2".repeat(64)}`,
      description: "Upstream v2.",
    };
    const dry = await run();
    expect(dry.counts.locallyEdited).toBe(1);
    expect(dry.names.locallyEdited.shown).toEqual(["Test beta"]);
    expect(dry.work).toBe(0);
    const s = await run({ apply: true });
    expect(s.result).toMatchObject({ updated: 0, skipped: 1 });
    expect((await get(id)).body.text).toBe("The DM's own words.");
    const o = await run({ apply: true, overwrite: true });
    expect(o.result).toMatchObject({ updated: 1, skipped: 0 });
    expect((await get(id)).body.text).toContain("Upstream v2.");
    expect((await run()).nothingChanged).toBe(true);
  });

  test("GSB import: a mapper version bump re-maps unchanged items; locally edited ones stay skipped", async () => {
    const alphaId = ledgerRow(await run(), "alpha")?.entryId as string;
    await caller.call("homebrew_edit", { id: alphaId, patch: { name: "Test alpha (DM)" } });
    const dry = await run({ mapperVersion: 2 });
    expect(dry.counts.unchanged).toBe(0);
    expect(dry.counts.changed).toBe(3);
    expect(dry.names.locallyEdited.shown).toEqual(["Test alpha"]);
    expect(dry.work).toBe(2);
    expect(dry.planIssues).toEqual([]);
    const s = await run({ apply: true, mapperVersion: 2 });
    expect(s.result).toMatchObject({ updated: 2, skipped: 1, failed: 0 });
    expect(ledgerRow(s, "beta")?.mapperVersion).toBe(2);
    expect(ledgerRow(s, "alpha")?.mapperVersion).toBe(1);
    expect((await get(alphaId)).name).toBe("Test alpha (DM)");
    const again = await run({ mapperVersion: 2 });
    expect([again.counts.unchanged, again.counts.locallyEdited, again.work]).toEqual([2, 1, 0]);
    // Back to version 1 (the rest of the file): beta / gamma re-map again; alpha's row is at 1,
    // so it is unchanged and the DM's name stays until the DM undoes it.
    expect((await run({ apply: true })).result).toMatchObject({ updated: 2, skipped: 0 });
    expect((await get(alphaId)).name).toBe("Test alpha (DM)");
    await caller.call("homebrew_edit", { id: alphaId, patch: { name: "Test alpha" } });
    expect((await run()).nothingChanged).toBe(true);
  });

  test("GSB import: an item gone from the dataset is reported once, its entry kept", async () => {
    const gamma = items.pop() as RawItem;
    const dry = await run();
    expect(dry.counts.removed).toBe(1);
    expect(dry.names.removed.shown).toEqual([uidOf("gamma")]);
    const s = await run({ apply: true });
    expect(s.result?.removed).toBe(1);
    const row = ledgerRow(s, "gamma");
    expect(row?.removedAt).toBe("2026-11-06T00:00:00.000Z");
    expect((await get(row?.entryId as string)).name).toBe("Test gamma");
    expect((await run()).counts.removed).toBe(0);
    // Back with the same content: unchanged, the mark cleared.
    items.push(gamma);
    const back = await run({ apply: true });
    expect(back.counts.unchanged).toBe(3);
    expect(ledgerRow(back, "gamma")?.removedAt).toBeUndefined();
  });

  test("GSB import: an entry deleted in the campaign is 'deleted', changed or not; --overwrite recreates it", async () => {
    const old = ledgerRow(await run(), "gamma")?.entryId as string;
    await deleteEntry(old);
    progressLines.length = 0;
    const dry = await run();
    expect(progressLines.some((l) => l.startsWith("[gsb] listing the homebrew items"))).toBe(true);
    expect([dry.counts.deleted, dry.counts.unchanged, dry.work]).toEqual([1, 2, 0]);
    expect(dry.names.deleted.shown).toEqual(["Test gamma"]);
    expect(dry.nothingChanged).toBe(false);
    expect((await run({ apply: true })).result).toMatchObject({ created: 0, skipped: 1 });
    const o = await run({ apply: true, overwrite: true });
    expect(o.result).toMatchObject({ created: 1, failed: 0 });
    const now = ledgerRow(o, "gamma")?.entryId as string;
    expect(now).not.toBe(old);
    expect((await get(now)).name).toBe("Test gamma");
    expect((await run()).nothingChanged).toBe(true);
  });

  test("GSB import: images are uploaded on every write, so a stale ledger asset id can't break an edit", async () => {
    const s0 = await run();
    const before = ledgerRow(s0, "beta");
    const ledger = loadLedger(s0.ledger);
    const row = ledger.items[uidOf("beta")];
    if (row) row.imageAssetIds = ["gone-asset-id"];
    writeFileSync(s0.ledger, JSON.stringify(ledger));
    items[1] = {
      ...items[1],
      contentHash: `sha256:${"3".repeat(64)}`,
      description: "Upstream v3.",
    };
    progressLines.length = 0;
    const s = await run({ apply: true });
    expect(s.result).toMatchObject({ updated: 1, failed: 0 });
    expect(progressLines).toContain("[gsb] reading changed entries 1/1");
    const e = await get(before?.entryId as string);
    expect(e.imageAssetIds).toEqual(before?.imageAssetIds as string[]);
    expect(ledgerRow(s, "beta")?.imageAssetIds).toEqual(before?.imageAssetIds as string[]);
  });

  test("GSB import: no ledger row + name taken by an earlier import → adopted by its footer uid; else a clash", async () => {
    const fresh = mkdtempSync(path.join(os.tmpdir(), "pp gsb ledger2 "));
    try {
      await caller.call("homebrew_create", {
        entry: {
          kind: "item",
          name: "Test delta",
          facets: { category: "magic", attunement: false },
          body: { typeLine: "Ring", text: "Someone else's ring." },
        },
      });
      items.push(rawItem("delta"));
      const dry = await run({ dir: fresh });
      expect(dry.counts.new).toBe(4);
      expect(dry.counts.adopt).toBe(3);
      expect(dry.names.clash.shown).toEqual(["Test delta"]);
      expect(dry.planIssues).toEqual([]);
      const s = await run({ apply: true, dir: fresh });
      expect(s.result).toMatchObject({ created: 0, adopted: 3, failed: 1 });
      expect(s.failures).toEqual([
        expect.objectContaining({ uid: uidOf("delta"), name: "Test delta", code: "conflict" }),
      ]);
      expect(loadLedger(s.ledger).datasetHash).toBeNull();
      expect(ledgerRow(s, "alpha")?.entryId).toBe(
        ledgerRow(await run(), "alpha")?.entryId as string,
      );
      expect((await homebrewItems()).length).toBe(4);
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  });

  test("GSB import: items sharing a name (any case) import as Name and Name (2), by uid order", async () => {
    const [first, second] = ["twin-x", "twin-y"].sort((a, b) => (uidOf(a) < uidOf(b) ? -1 : 1));
    items.push(
      rawItem(second as string, { name: "TEST TWIN" }),
      rawItem(first as string, { name: "Test twin" }),
    );
    const dry = await run();
    expect(dry.planIssues).toEqual([]);
    expect(dry.names.clash.shown).toEqual(["Test delta"]);
    expect(dry.warnings).toEqual([
      {
        uid: uidOf(second as string),
        name: "TEST TWIN",
        message: 'name shared with another item: imported as "TEST TWIN (2)"',
      },
    ]);
    const s = await run({ apply: true });
    expect(s.result).toMatchObject({ created: 2 });
    expect((await get(ledgerRow(s, first as string)?.entryId as string)).name).toBe("Test twin");
    expect((await get(ledgerRow(s, second as string)?.entryId as string)).name).toBe(
      "TEST TWIN (2)",
    );
  });
});
