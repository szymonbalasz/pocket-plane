// Compendium expansion X1 wiring and X2's REST on `cmpx-5etools` + `fixtures/5etools-mini`: `5et-*`
// keys through `cmp.import` (FR-CMPX-02), source rows and versions (-03), one transaction per book
// (-12, crash included), one folder read per run (§11, #397), entry-only monsters (-08), the
// folder's states (-17), credits and badges (-16, -18), FR-CMP-31 timing.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FIVE_ETOOLS_MINI_DIR } from "@fixtures/5etools-mini/prepare";
import { loadBundle } from "@fixtures/index";
import { ImportResponse, SourcesResponse } from "@shared/compendium/import";
import { CreditsResponse, EntryResponse, SearchResponse } from "@shared/compendium/rest";
import { and, eq } from "drizzle-orm";
import { createApi } from "../../app";
import { armCrashHook } from "../../commands/crash";
import { closeDb, openFileDb, openMemoryDb } from "../../db/client";
import {
  campaign,
  compendiumEntry,
  compendiumSource,
  encounter,
  entity,
  player,
} from "../../db/schema";
import { readEventLog } from "../../events/log";
import type { Actor } from "../../events/types";
import { createTestServices, TEST_SECRET } from "../../testing/services";
import { bookVersion } from "./adapter/5etools";
import { DERIVE_MONSTER } from "./derive";
import { END_COMBAT_FIRST, IMPORT, type ImportResult } from "./import";
import { bookAbbrOf, bookAttribution, FIVE_ETOOLS_LICENCE } from "./sources/five-etools";

const TB1 = "5et-tb1";
const TB2 = "5et-tb2";
const DM = { Authorization: `Bearer ${TEST_SECRET}` };

let bytes: Uint8Array;
let bundleDir: string;
const temps: string[] = [];

beforeAll(async () => {
  const loaded = await loadBundle("cmpx-5etools", { dmSecret: TEST_SECRET, testMode: true });
  bundleDir = loaded.dir;
  const db = openFileDb(loaded.config.dbPath);
  db.$client.run("PRAGMA journal_mode = DELETE");
  bytes = db.$client.serialize();
  closeDb(db);
}, 60_000);

afterAll(() => {
  for (const d of [bundleDir, ...temps]) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // Windows may hold the WAL briefly; a leftover temp dir is harmless.
    }
  }
});

afterEach(() => armCrashHook(null));

/** A fresh copy of the bundle, the server pointed at `dir` (default the mini folder). */
function fresh(dir: string | null = FIVE_ETOOLS_MINI_DIR) {
  const s = createTestServices({
    db: openMemoryDb(bytes),
    env: dir === null ? {} : { PP_5ETOOLS_DIR: dir },
  });
  const cid = s.db.select().from(campaign).where(eq(campaign.active, true)).get()?.id as string;
  const token = s.db.select().from(player).all()[0]?.linkToken as string;
  const actor: Actor = { role: "dm", playerId: null, campaignId: cid };
  const api = createApi(s);
  const run = (input: { source: string; run?: string }) =>
    s.commands.run(IMPORT, input, { actor }) as ImportResult;
  const get = (url: string, headers: Record<string, string> = DM) =>
    api.request(`/api/compendium${url}`, { headers });
  const post = (body: unknown) =>
    api.request("/api/compendium/import", {
      method: "POST",
      headers: { ...DM, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const sources = async () => SourcesResponse.parse(await (await get("/sources")).json());
  const entry = (source: string, sourceKey: string) =>
    s.db
      .select()
      .from(compendiumEntry)
      .where(and(eq(compendiumEntry.source, source), eq(compendiumEntry.sourceKey, sourceKey)))
      .get();
  const entriesOf = (source: string) =>
    s.db.select().from(compendiumEntry).where(eq(compendiumEntry.source, source)).all();
  const search = async (q: string, headers: Record<string, string> = DM) =>
    SearchResponse.parse(await (await get(`/search?q=${q}`, headers)).json()).results;
  const player1 = { Authorization: `Player ${token}` };
  return { s, cid, actor, run, get, post, sources, entry, entriesOf, search, player1 };
}

/** A writable copy of the mini folder. */
function copyFolder(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "pp-5etools-"));
  temps.push(dir);
  cpSync(path.join(FIVE_ETOOLS_MINI_DIR, "data"), path.join(dir, "data"), { recursive: true });
  return dir;
}

const bumpRelease = (dir: string, ver: string) =>
  writeFileSync(path.join(dir, "data/changelog.json"), JSON.stringify([{ ver }]));

const writes = (s: { db: { $client: { query(q: string): { get(): unknown } } } }) =>
  (s.db.$client.query("SELECT total_changes() AS n").get() as { n: number }).n;

const totals = (r: ImportResult) => {
  const t = { created: 0, updated: 0, existing: 0 };
  for (const c of Object.values(r.counts)) {
    t.created += c.created;
    t.updated += c.updated;
    t.existing += c.existing;
  }
  return t;
};

describe("FR-CMPX-02 book keys", () => {
  test("FR-CMPX-02 cmp.import takes a book of the folder; a key not in its list → invalid, nothing written", async () => {
    const t = fresh();
    expect(t.run({ source: TB1 }).source).toBe(TB1);
    expect(t.entriesOf(TB1).length).toBeGreaterThan(0);
    const r = await t.post({ source: "5et-nope" });
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ code: "invalid" });
    expect(
      t.s.db.select().from(compendiumSource).where(eq(compendiumSource.key, "5et-nope")).get(),
    ).toBeUndefined();
    // Neither a bundled key nor a book key at all.
    expect((await t.post({ source: "homebrew" })).status).toBe(400);
  });

  test("FR-CMPX-02 never a path from the client: an extra field or a path as the key → invalid", async () => {
    const t = fresh();
    expect((await t.post({ source: TB1, path: "C:/somewhere" })).status).toBe(400);
    expect((await t.post({ source: "5et-../../secrets" })).status).toBe(400);
    expect(t.entriesOf(TB1)).toHaveLength(0);
  });

  test("FR-CMPX-02 no folder configured → invalid; the bundled source still imports (FR-CMPX-01)", async () => {
    const t = fresh(null);
    expect((await t.post({ source: TB1 })).status).toBe(400);
    expect(t.entriesOf(TB1)).toHaveLength(0);
    expect((await t.get("/sources")).status).toBe(200);
  });

  test("FR-CMPX-02 FR-CMPX-18 per-book source row: book name, licence, attribution, url null, version", () => {
    const t = fresh();
    const r = t.run({ source: TB1 });
    const row = t.s.db.select().from(compendiumSource).where(eq(compendiumSource.key, TB1)).get();
    expect(row).toMatchObject({
      name: "Test Book One",
      licence: FIVE_ETOOLS_LICENCE,
      attribution: bookAttribution("Test Book One"),
      url: null,
      version: bookVersion("0.0.1"),
    });
    expect(r.version).toBe(bookVersion("0.0.1"));
    expect(row?.attribution).toBe(
      "Test Book One — © Wizards of the Coast. Read from your own 5etools files for use at your table.",
    );
  });
});

describe("FR-CMPX-17 folder states over REST", () => {
  test("FR-CMPX-17 not-configured: state only, DM only (player 401)", async () => {
    const t = fresh(null);
    expect((await t.sources()).fiveEtools).toEqual({ state: "not-configured", books: [] });
    expect((await t.get("/sources", t.player1)).status).toBe(401);
  });

  test("FR-CMPX-17 not-found: the resolved path; the bundled sources are unaffected", async () => {
    const missing = path.join(tmpdir(), "pp-5etools-not-there");
    const t = fresh(missing);
    const body = await t.sources();
    expect(body.fiveEtools.state).toBe("not-found");
    expect(body.fiveEtools.path).toBe(missing);
    expect(body.sources.map((x) => x.key)).toEqual(["srd-5.1"]);
  });

  test("FR-CMPX-17 a folder with data/books.json but a broken changelog: not-found, says why", async () => {
    const dir = copyFolder();
    writeFileSync(path.join(dir, "data/changelog.json"), "not json");
    const f = (await fresh(dir).sources()).fiveEtools;
    expect(f.state).toBe("not-found");
    expect(f.issues).toEqual(["data/changelog.json: not valid JSON"]);
  });

  test("FR-CMPX-17 ready: release, version, books with names, abbreviations and counts", async () => {
    const f = (await fresh().sources()).fiveEtools;
    expect(f.state).toBe("ready");
    expect(f.release).toBe("0.0.1");
    expect(f.version).toBe(bookVersion("0.0.1"));
    expect(f.books.map((b) => [b.key, b.name, b.abbr])).toEqual([
      [TB1, "Test Book One", "TB1"],
      [TB2, "Test Book Two", "TB2"],
    ]);
    for (const b of f.books) {
      expect(b.counts.monster + b.counts.spell + b.counts.item).toBeGreaterThan(0);
      expect(b.importedVersion).toBeUndefined();
    }
  });
});

describe("FR-CMPX-03 versions and Update", () => {
  test("FR-CMPX-03 a new release: the list follows (cache until the version changes), the imported book differs, Update brings it level", async () => {
    const dir = copyFolder();
    const t = fresh(dir);
    t.run({ source: TB1 });
    const before = (await t.sources()).fiveEtools;
    expect(before.books.find((b) => b.key === TB1)?.importedVersion).toBe(before.version);
    expect(before.books.find((b) => b.key === TB1)?.importedAt).toBeString();

    bumpRelease(dir, "0.0.2");
    const after = (await t.sources()).fiveEtools;
    expect(after.release).toBe("0.0.2");
    expect(after.version).toBe(bookVersion("0.0.2"));
    expect(after.books.find((b) => b.key === TB1)?.importedVersion).toBe(before.version as string);
    expect(after.books.find((b) => b.key === TB2)?.importedVersion).toBeUndefined();

    const r = t.run({ source: TB1 });
    expect(r.changed).toBe(true); // the source row's version moved
    expect(totals(r).created).toBe(0);
    expect((await t.sources()).fiveEtools.books.find((b) => b.key === TB1)?.importedVersion).toBe(
      after.version as string,
    );
  });

  test("FR-CMPX-03 the book list isn't re-read while the version stands", async () => {
    const dir = copyFolder();
    const t = fresh(dir);
    const count = (await t.sources()).fiveEtools.books[0]?.counts.monster as number;
    // Same release, one more monster: still the cached list.
    const file = path.join(dir, "data/bestiary/bestiary-tb1.json");
    const doc = JSON.parse(readFileSync(file, "utf8")) as { monster: unknown[] };
    doc.monster.push({ name: "Added Later", source: "TB1", ac: [10], hp: { average: 1 } });
    writeFileSync(file, JSON.stringify(doc));
    expect((await t.sources()).fiveEtools.books[0]?.counts.monster).toBe(count);
    bumpRelease(dir, "0.0.2");
    expect((await t.sources()).fiveEtools.books[0]?.counts.monster).toBe(count + 1);
  });
});

describe("FR-CMPX-12 import per book", () => {
  test("FR-CMPX-12 re-import is idempotent: all existing, 0 writes, no event, no log entry", () => {
    const t = fresh();
    t.run({ source: TB1 });
    const log = readEventLog(t.s.db).length;
    const before = writes(t.s);
    const again = t.run({ source: TB1 });
    expect(again.changed).toBe(false);
    expect(totals(again)).toMatchObject({ created: 0, updated: 0 });
    expect(totals(again).existing).toBe(t.entriesOf(TB1).length);
    expect(writes(t.s)).toBe(before);
    expect(readEventLog(t.s.db)).toHaveLength(log);
  });

  test("FR-CMPX-12 PP_TEST_CRASH=cmp.import:before-commit between books: the first stays, the running one rolls back, re-running imports the rest", () => {
    const t = fresh();
    class Killed extends Error {}
    t.run({ source: TB1, run: "crash" });
    const tb1 = t.entriesOf(TB1).length;
    armCrashHook({ point: "before-commit", target: IMPORT }, () => {
      throw new Killed("killed");
    });
    expect(() => t.run({ source: TB2, run: "crash" })).toThrow();
    armCrashHook(null);
    expect(t.entriesOf(TB1)).toHaveLength(tb1);
    expect(t.entriesOf(TB2)).toHaveLength(0);
    expect(
      t.s.db.select().from(compendiumSource).where(eq(compendiumSource.key, TB2)).get(),
    ).toBeUndefined();
    expect(t.s.db.select().from(entity).where(eq(entity.source, TB2)).all()).toHaveLength(0);

    expect(totals(t.run({ source: TB1 })).created).toBe(0);
    expect(totals(t.run({ source: TB2 })).created).toBeGreaterThan(0);
  });

  test("FR-CMPX-12 refused while an encounter is started (FR-CMP-07): 409, nothing written", async () => {
    const t = fresh();
    // The bundle has no encounter; only the started row matters to the check.
    t.s.db
      .insert(encounter)
      .values({
        id: "enc-1",
        campaignId: t.cid,
        seq: 1,
        name: "Fight",
        status: "started",
        createdAt: "2026-10-30T00:00:00.000Z",
        updatedAt: "2026-10-30T00:00:00.000Z",
      })
      .run();
    const r = await t.post({ source: TB1 });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ code: "conflict", message: END_COMBAT_FIRST });
    expect(t.entriesOf(TB1)).toHaveLength(0);
  });

  test("FR-CMPX-12 a malformed file fails the book with issues, nothing written (§11)", async () => {
    const dir = copyFolder();
    const t = fresh(dir);
    writeFileSync(path.join(dir, "data/items.json"), "{ nope");
    const r = await t.post({ source: TB1 });
    expect(r.status).toBe(400);
    expect(JSON.stringify(await r.json())).toContain("data/items.json: not valid JSON");
    expect(t.entriesOf(TB1)).toHaveLength(0);
  });

  test("FR-CMPX-12 POST /import answers counts and warnings; each book emits its own CompendiumImported", async () => {
    const t = fresh();
    const seen: string[] = [];
    t.s.bus.subscribe("test", ({ event }) => {
      if (event.type === "CompendiumImported") {
        seen.push((event.payload as { source: string }).source);
      }
    });
    for (const source of [TB1, TB2]) {
      const res = await t.post({ source, run: "both" });
      expect(res.status).toBe(200);
      const body = ImportResponse.parse(await res.json());
      expect(body.source).toBe(source);
      expect(body.warnings.length).toBeGreaterThan(0); // the raw fixture has no token files
    }
    expect(seen).toEqual([TB1, TB2]);
  });

  test("§11 #397 one run reads the folder once: a release extracted mid-run reaches the next run only", () => {
    const dir = copyFolder();
    const t = fresh(dir);
    const first = t.run({ source: TB1, run: "r1" });
    bumpRelease(dir, "9.9.9");
    rmSync(path.join(dir, "data/bestiary/bestiary-tb2.json"));
    // TB2's file is gone and the release moved; the run still has what it read at its start.
    const second = t.run({ source: TB2, run: "r1" });
    expect(second.version).toBe(first.version);
    expect(second.counts.monster.created).toBeGreaterThan(0);
    // Not part of that run: reads again, sees the new release (TB2's bestiary file is missing).
    expect(() => t.run({ source: TB2, run: "r2" })).toThrow();
    writeFileSync(
      path.join(dir, "data/bestiary/index.json"),
      JSON.stringify({ TB1: "bestiary-tb1.json" }),
    );
    expect(t.run({ source: TB1, run: "r3" }).version).toBe(bookVersion("9.9.9"));
  });

  test("§11 the same run's books match what separate reads give", () => {
    const together = fresh();
    together.run({ source: TB1, run: "same" });
    together.run({ source: TB2, run: "same" });
    const apart = fresh();
    apart.run({ source: TB1 });
    apart.run({ source: TB2 });
    const hashes = (t: ReturnType<typeof fresh>, source: string) =>
      t
        .entriesOf(source)
        .map((e) => `${e.sourceKey} ${e.dataHash}`)
        .sort();
    expect(hashes(together, TB1)).toEqual(hashes(apart, TB1));
    expect(hashes(together, TB2)).toEqual(hashes(apart, TB2));
  });

  test("FR-CMP-31 importing a book of 5etools-mini: target ≤ 2 s (logged), fails above 10 s; re-import writes nothing", () => {
    const t = fresh();
    const t0 = performance.now();
    t.run({ source: TB1 });
    const ms = performance.now() - t0;
    console.log(`FR-CMP-31 5etools-mini TB1: ${ms.toFixed(0)} ms (${ms > 2_000 ? "WARN" : "ok"})`);
    expect(ms).toBeLessThan(10_000);
    const t1 = performance.now();
    t.run({ source: TB1 });
    const again = performance.now() - t1;
    console.log(`FR-CMP-31 5etools-mini TB1 again: ${again.toFixed(0)} ms`);
    expect(again).toBeLessThan(10_000);
  });
});

describe("FR-CMPX-08 entry-only monsters", () => {
  test("FR-CMPX-08 the pipeline stores the entry with definitionId null and no creature; a sibling keeps its own", () => {
    const t = fresh();
    t.run({ source: TB1 });
    const wisp = t.entry(TB1, "monster/wobbling-fenwisp");
    expect(wisp?.definitionId).toBeNull();
    expect(
      t.s.db
        .select()
        .from(entity)
        .where(and(eq(entity.source, TB1), eq(entity.sourceKey, "monster/wobbling-fenwisp")))
        .get(),
    ).toBeUndefined();
    expect(t.entry(TB1, "monster/goblin")?.definitionId).toBeString();
  });

  test("FR-CMPX-08 not draggable, no stat block: the row has no definitionId, GET has no definition", async () => {
    const t = fresh();
    t.run({ source: TB1 });
    const [row] = await t.search("fenwisp");
    expect(row?.definitionId).toBeUndefined();
    const body = EntryResponse.parse(await (await t.get(`/entries/${row?.id}`)).json());
    expect(body.definition).toBeUndefined();
    expect(body.entry.definitionId).toBeNull();
  });

  test("FR-CMPX-08 Derive… from the entry: a new creature with the DM's numbers, no derivedFromId", () => {
    const t = fresh();
    t.run({ source: TB1 });
    const wisp = t.entry(TB1, "monster/wobbling-fenwisp");
    const r = t.s.commands.run(
      DERIVE_MONSTER,
      {
        entryId: wisp?.id,
        entity: {
          kind: "monster",
          name: "My Wisp",
          statBlock: { size: "small", cr: "1", ac: 12, hpMax: 9, initBonus: 0, attacks: [] },
        },
        copyText: true,
      },
      { actor: t.actor },
    ) as { entity: { name: string; derivedFromId: string | null } };
    expect(r.entity.name).toBe("My Wisp");
    expect(r.entity.derivedFromId).toBeNull();
  });
});

describe("FR-CMPX-16 FR-CMPX-18 badges and credits", () => {
  test("FR-CMPX-16 search: 'goblin' → one row badged TB1, sourceLabel the book's name, SRD's hidden; FR-CMPX-14 Gnasher → TB2 only", async () => {
    const t = fresh();
    expect((await t.search("goblin")).filter((r) => r.name === "Goblin")).toHaveLength(1);
    t.run({ source: TB1, run: "x" });
    t.run({ source: TB2, run: "x" });
    const goblins = (await t.search("goblin")).filter((r) => r.name === "Goblin");
    expect(goblins).toHaveLength(1);
    expect(goblins[0]).toMatchObject({ sourceLabel: "Test Book One", sourceAbbr: "TB1" });
    const gnashers = (await t.search("gnasher")).filter((r) => r.name === "Gnasher");
    expect(gnashers.map((r) => r.sourceAbbr)).toEqual(["TB2"]);
  });

  test("FR-CMPX-16 a source that isn't a book carries no sourceAbbr", async () => {
    const t = fresh();
    const [row] = (await t.search("goblin")).filter((r) => r.name === "Goblin");
    expect(row?.sourceLabel).toBe("SRD 5.1");
    expect(row?.sourceAbbr).toBeUndefined();
  });

  test("#396 the badge is the book's real abbreviation, not the key upper-cased", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pp-5etools-"));
    temps.push(dir);
    mkdirSync(path.join(dir, "data"));
    writeFileSync(
      path.join(dir, "data/books.json"),
      JSON.stringify({ book: [{ name: "Curse of Things", source: "CoT" }] }),
    );
    writeFileSync(path.join(dir, "data/changelog.json"), JSON.stringify([{ ver: "1" }]));
    const known = bookAbbrOf(dir);
    expect(known("5et-cot", "Curse of Things")).toBe("CoT");
    // Not in the labels: such a book is named after its abbreviation.
    expect(known("5et-xyz", "XyZ")).toBe("XyZ");
    // No folder: the key upper-cased is the best left. Not a book: nothing.
    expect(bookAbbrOf(null)("5et-cot", "Curse of Things")).toBe("COT");
    expect(known("srd-5.1", "SRD 5.1")).toBeUndefined();
  });

  test("FR-CMPX-18 entry: source carries the abbreviation for the footer", async () => {
    const t = fresh();
    t.run({ source: TB1 });
    const id = t.entry(TB1, "monster/goblin")?.id;
    const body = EntryResponse.parse(await (await t.get(`/entries/${id}`)).json());
    expect(body.source).toMatchObject({ name: "Test Book One", abbr: "TB1", url: null });
  });

  test("FR-CMPX-18 GET /credits lists each imported book for the DM, the SRD first; players the books they can read", async () => {
    const t = fresh();
    t.run({ source: TB1, run: "x" });
    t.run({ source: TB2, run: "x" });
    const dm = CreditsResponse.parse(await (await t.get("/credits")).json()).sources;
    expect(dm.map((s) => s.key)).toEqual(["srd-5.1", TB1, TB2]);
    expect(dm[1]?.attribution).toBe(bookAttribution("Test Book One"));
    const pl = CreditsResponse.parse(await (await t.get("/credits", t.player1)).json()).sources;
    expect(pl.map((s) => s.key)).toContain(TB1);
    expect((await t.get("/credits", {})).status).toBe(401);
  });

  test("FR-CMP-14 FR-CMPX-14 player: the TB1 spell by search, no monsters", async () => {
    const t = fresh();
    t.run({ source: TB1 });
    const spell = await t.search("quarry", t.player1);
    expect(spell.map((r) => [r.name, r.sourceAbbr])).toEqual([["Quarry Sign", "TB1"]]);
    expect(await t.search("goblin", t.player1)).toEqual([]);
    const wispId = t.entry(TB1, "monster/goblin")?.id;
    expect((await t.get(`/entries/${wispId}`, t.player1)).status).toBe(404);
  });
});
