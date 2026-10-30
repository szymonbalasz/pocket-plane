// Compendium expansion §13 core integration on the `cmpx-core` bundle (SRD mini + two hand-made
// books): stored `replaces` / `artPath` and their hash (FR-CMPX-13, -23), the hidden set
// (FR-CMPX-14), preset inheritance (FR-CMPX-15), rank and labels (FR-CMPX-16), 0 B (FR-CMPX-21).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { CMPX_BOOKS_VERSION, TB1_SOURCE, TB2_SOURCE } from "@fixtures/units/compendium/cmpx-books";
import { CMP_INTENTS } from "@shared/compendium/homebrew";
import { type EntryResponse, SearchQuery } from "@shared/compendium/rest";
import { isValidArtPath } from "@shared/compendium/schemas";
import { and, eq } from "drizzle-orm";
import { CommandError } from "../../commands/errors";
import { closeDb, openFileDb, openMemoryDb } from "../../db/client";
import {
  asset,
  campaign,
  compendiumEntry,
  entity,
  importedArt,
  player,
  ruleTrigger,
} from "../../db/schema";
import type { Actor } from "../../events/types";
import { createTestServices, TEST_SECRET } from "../../testing/services";
import { servicesFromBundle, snapshotSizes } from "../../ws/testing/snapshot-size";
import { adaptOpen5e } from "./adapter/open5e";
import { DERIVE_MONSTER } from "./derive";
import { IMPORT_RECORDED, type ImportResult } from "./import";
import { readEntry } from "./read";
import { searchEntries } from "./search";
import { searchIndex } from "./search-index";
import type { EntryViewer } from "./visibility";

const BOOK = {
  key: TB1_SOURCE,
  name: "Test Book One",
  licence: "User-supplied (5etools)",
  attribution: "Invented.",
};

let bytes: Uint8Array;
let dir: string;

beforeAll(async () => {
  const loaded = await loadBundle("cmpx-core", { dmSecret: TEST_SECRET, testMode: true });
  dir = loaded.dir;
  const db = openFileDb(loaded.config.dbPath);
  db.$client.run("PRAGMA journal_mode = DELETE");
  bytes = db.$client.serialize();
  closeDb(db);
}, 60_000);

afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows may hold the WAL briefly; a leftover temp dir is harmless.
  }
});

/** A fresh in-memory copy of the bundle. */
function fresh() {
  const s = createTestServices({ db: openMemoryDb(bytes) });
  const cid = s.db.select().from(campaign).where(eq(campaign.active, true)).get()?.id as string;
  const pid = s.db.select().from(player).all()[0]?.id as string;
  const dm: EntryViewer = { role: "dm", campaignId: cid, playerId: null };
  const pl: EntryViewer = { role: "player", campaignId: cid, playerId: pid };
  const dmActor: Actor = { role: "dm", playerId: null, campaignId: cid };
  const find = (params: Record<string, string>, v: EntryViewer = dm) =>
    searchEntries(s.db, v, SearchQuery.parse(params)).results;
  const row = (source: string, sourceKey: string) =>
    s.db
      .select()
      .from(compendiumEntry)
      .where(and(eq(compendiumEntry.source, source), eq(compendiumEntry.sourceKey, sourceKey)))
      .get();
  const book = (records: unknown[], key = TB1_SOURCE, version = CMPX_BOOKS_VERSION) =>
    s.commands.run(
      IMPORT_RECORDED,
      { source: { ...BOOK, key }, version, records },
      { actor: dmActor },
    ) as ImportResult;
  return { s, cid, pid, dm, pl, dmActor, find, row, book };
}

type Fresh = ReturnType<typeof fresh>;

const spell = (name: string, sourceKey: string, extra: object = {}) => ({
  kind: "spell",
  sourceKey,
  data: {
    kind: "spell",
    name,
    facets: { level: 1, school: "evocation", classes: [], concentration: false, ritual: false },
    body: {
      castingTime: "1 action",
      range: "Self",
      components: "V",
      duration: "1 round",
      text: "Invented.",
    },
  },
  ...extra,
});

const names = (rows: { name: string; sourceLabel: string }[]) =>
  rows.map((r) => `${r.name} · ${r.sourceLabel}`);

describe("FR-CMPX-13 / -23 stored refs and art path", () => {
  test("FR-CMPX-13 replaces and artPath are stored; an entry without them keeps [] and null", () => {
    const { row } = fresh();
    expect(row(TB1_SOURCE, "monster/goblin")?.replaces).toEqual(["srd-5.1:monster/goblin"]);
    expect(row(TB1_SOURCE, "monster/goblin")?.artPath).toBe("img/bestiary/tokens/TB1/Goblin.webp");
    expect(row(TB1_SOURCE, "spell/emberlash")?.replaces).toEqual([]);
    expect(row(TB1_SOURCE, "spell/emberlash")?.artPath).toBeNull();
  });

  test("FR-CMPX-13 a changed replaces (or art path) → updated; order alone → existing; removed → updated", () => {
    const { book, row } = fresh();
    const key = "spell/test-refs";
    expect(book([spell("Test Refs", key)]).counts.spell.created).toBe(1);
    const a = { replaces: ["srd-5.1:spell/a", "srd-5.1:spell/b"] };
    expect(book([spell("Test Refs", key, a)]).counts.spell.updated).toBe(1);
    expect(row(TB1_SOURCE, key)?.replaces).toEqual(a.replaces);
    const swapped = { replaces: [...a.replaces].reverse() };
    const same = book([spell("Test Refs", key, swapped)]);
    expect(same.counts.spell.existing).toBe(1);
    expect(same.changed).toBe(false);
    expect(book([spell("Test Refs", key)]).counts.spell.updated).toBe(1);
    expect(row(TB1_SOURCE, key)?.replaces).toEqual([]);
  });

  test("FR-CMPX-23 a changed art path → updated, the definition untouched", () => {
    const { book, row, s } = fresh();
    const monster = {
      kind: "monster",
      sourceKey: "monster/test-art",
      data: {
        kind: "monster",
        name: "Test Art",
        facets: { cr: "1", type: "fiend", size: "small" },
        body: { meta: {}, traits: [], actions: [], bonusActions: [], reactions: [] },
      },
      definition: {
        name: "Test Art",
        statBlock: { size: "small", ac: 10, hpMax: 5, initBonus: 0, attacks: [], cr: "1" },
      },
    };
    expect(book([monster]).counts.monster.created).toBe(1);
    const defOf = () => s.db.select().from(entity).where(eq(entity.sourceKey, monster.sourceKey));
    const before = defOf().get()?.updatedAt;
    const art = { ...monster, artPath: "img/bestiary/tokens/TB1/Test Art.webp" };
    expect(book([art]).counts.monster.updated).toBe(1);
    expect(row(TB1_SOURCE, monster.sourceKey)?.artPath).toBe(art.artPath);
    expect(defOf().get()?.updatedAt).toBe(before);
    expect(book([art]).changed).toBe(false);
    expect(book([monster]).counts.monster.updated).toBe(1);
    expect(row(TB1_SOURCE, monster.sourceKey)?.artPath).toBeNull();
  });

  test("FR-CMPX-23 isValidArtPath: relative under img/, ≤ 200, no `..`, backslash, drive or leading /", () => {
    for (const ok of [
      "img/bestiary/tokens/MM/Some Beast.webp",
      "img/x.webp",
      `img/${"a".repeat(196)}`,
    ]) {
      expect({ ok, valid: isValidArtPath(ok) }).toEqual({ ok, valid: true });
    }
    for (const bad of [
      "",
      "bestiary/x.webp",
      "/img/x.webp",
      "C:/img/x.webp",
      "C:\\img\\x.webp",
      "img/../secret",
      "img/a/../../b",
      "img\\x.webp",
      "img/a\\b.webp",
      `img/${"a".repeat(197)}`,
    ]) {
      expect({ bad, valid: isValidArtPath(bad) }).toEqual({ bad, valid: false });
    }
  });

  test("FR-CMPX-13 FR-CMPX-23 invalid refs or art path: every record's issue, nothing written", () => {
    const { book, row } = fresh();
    const monsterKey = "spell/test-bad-ref";
    const err = (() => {
      try {
        book([
          spell("Bad Ref", monsterKey, { replaces: ["no-colon"] }),
          spell("Bad Key", "spell/test-bad-key", { replaces: ["srd-5.1:not a key"] }),
          {
            kind: "monster",
            sourceKey: "monster/test-bad-art",
            definition: {
              name: "Bad Art",
              statBlock: { size: "small", ac: 10, hpMax: 5, initBonus: 0, attacks: [], cr: "1" },
            },
            artPath: "../outside.webp",
            data: {
              kind: "monster",
              name: "Bad Art",
              facets: { cr: "1", type: "fiend", size: "small" },
              body: { meta: {}, traits: [], actions: [], bonusActions: [], reactions: [] },
            },
          },
        ]);
      } catch (e) {
        return e as CommandError;
      }
      throw new Error("expected a rejection");
    })();
    expect(err).toBeInstanceOf(CommandError);
    expect(err.code).toBe("invalid");
    const paths = (err.issues ?? []).map((i) => i.path.join("."));
    expect(paths).toEqual(
      expect.arrayContaining([
        `${monsterKey}.data.replaces.0`,
        "spell/test-bad-key.data.replaces.0",
        "monster/test-bad-art.data.artPath",
      ]),
    );
    expect(row(TB1_SOURCE, monsterKey)).toBeUndefined();
    expect(row(TB1_SOURCE, "monster/test-bad-art")).toBeUndefined();
  });

  test("FR-CMP-07 the SRD set keeps its stored hashes: no links → re-import writes nothing", async () => {
    const { s, dmActor } = fresh();
    const { srdMini } = await import("@fixtures/srd/open5e");
    const { SRD_51_SOURCE } = await import("./sources/srd-5.1/source");
    const again = s.commands.run(
      IMPORT_RECORDED,
      { source: { ...SRD_51_SOURCE }, version: "mini", responses: srdMini },
      { actor: dmActor },
    ) as ImportResult;
    expect(adaptOpen5e(srdMini).records.some((r) => r.replaces !== undefined)).toBe(false);
    // Every entry but the monsters' (the s3 unit strips `type`) is `existing`: same hash.
    expect(again.counts.spell.created + again.counts.spell.updated).toBe(0);
    expect(again.counts.item.created + again.counts.item.updated).toBe(0);
  });
});

describe("FR-CMPX-14 hidden, not gone", () => {
  test("FR-CMPX-14 search: 'goblin' gives the book's Goblin only, for the DM; 'gnasher' the newest book's only", () => {
    const { find } = fresh();
    const goblin = find({ q: "goblin", kind: "monster" }).filter((r) => r.name === "Goblin");
    expect(names(goblin)).toEqual(["Goblin · Test Book One"]);
    expect(names(find({ q: "gnasher" }))).toEqual(["Gnasher · Test Book Two"]);
  });

  test("FR-CMPX-14 players: the hidden SRD spell is out of search and the default list; the book's is in", () => {
    const { find, pl } = fresh();
    expect(names(find({ q: "hunter's mark" }, pl))).toEqual(["Hunter's Mark · Test Book One"]);
    const all = names(find({}, pl));
    expect(all).toContain("Hunter's Mark · Test Book One");
    expect(all).not.toContain("Hunter's Mark · SRD 5.1");
    expect(find({ q: "goblin", kind: "monster" }, pl)).toEqual([]);
  });

  test("FR-CMPX-14 default list (Creatures window, lookups): hidden monsters absent for the DM", () => {
    const { find } = fresh();
    const monsters = names(find({ kind: "monster" }));
    expect(monsters).toContain("Goblin · Test Book One");
    expect(monsters).not.toContain("Goblin · SRD 5.1");
    expect(monsters).toContain("Gnasher · Test Book Two");
    expect(monsters).not.toContain("Gnasher · Test Book One");
  });

  test("FR-CMPX-14 groups and sameAs: a hidden member isn't counted; a hidden id → an empty page", () => {
    const { s, dm, row, book, find } = fresh();
    const srd = row("srd-5.1", "monster/goblin");
    expect(
      searchEntries(s.db, dm, SearchQuery.parse({ sameAs: srd?.id as string })).results,
    ).toEqual([]);
    // Two same-named entries in one source group; hiding one leaves a plain row.
    book([spell("Twin", "spell/twin-a"), spell("Twin", "spell/twin-b")]);
    const grouped = find({ q: "twin" });
    expect(grouped[0]?.group).toEqual({ count: 2 });
    book([spell("Twin", "spell/twin-c", { replaces: [`${TB1_SOURCE}:spell/twin-a`] })], TB2_SOURCE);
    const rows = find({ q: "twin" });
    expect(rows.filter((r) => r.group !== undefined)).toEqual([]);
    expect(names(rows).sort()).toEqual(["Twin · Test Book One", "Twin · Test Book One"].sort());
  });

  test("FR-CMPX-14 GET by id and the definition still resolve a hidden entry; a token's entry is found by its definition", () => {
    const { s, dm, pl, row, find } = fresh();
    const goblin = row("srd-5.1", "monster/goblin");
    const read = readEntry(s.db, goblin?.id as string, dm);
    expect(read?.body.entry.name).toBe("Goblin");
    expect(read?.body.definition?.id).toBe(goblin?.definitionId as string);
    const spellRow = row("srd-5.1", "spell/hunters-mark");
    expect(readEntry(s.db, spellRow?.id as string, pl)?.body.entry.source).toBe("srd-5.1");
    // FR-CMP-22: a token of the hidden definition still opens its entry.
    const definitionId = goblin?.definitionId as string;
    const hit = find({ q: "Goblin", kind: "monster", definitionId }).filter(
      (r) => r.definitionId === definitionId,
    );
    expect(hit.map((r) => r.id)).toEqual([goblin?.id as string]);
  });

  test("FR-CMPX-14 the hidden set is derived: import order doesn't matter; a ref to nothing hides nothing", () => {
    const { book, find } = fresh();
    book(
      [spell("Latecomer", "spell/latecomer", { replaces: [`${TB1_SOURCE}:spell/zephyrine`] })],
      TB2_SOURCE,
    );
    expect(find({ q: "latecomer" })).toHaveLength(1);
    book([spell("Zephyrine", "spell/zephyrine")]);
    expect(find({ q: "zephyrine" })).toEqual([]);
    book(
      [spell("Latecomer", "spell/latecomer", { replaces: ["srd-5.1:spell/never-imported"] })],
      TB2_SOURCE,
    );
    expect(find({ q: "zephyrine" })).toHaveLength(1);
  });

  test("FR-CMPX-14 malformed refs: a self-ref or two books replacing each other stay visible", () => {
    const { book, find } = fresh();
    book([spell("Selfie", "spell/selfie", { replaces: [`${TB1_SOURCE}:spell/selfie`] })]);
    expect(find({ q: "selfie" })).toHaveLength(1);
    book([spell("Mutual", "spell/mutual", { replaces: [`${TB2_SOURCE}:spell/mutual`] })]);
    book(
      [spell("Mutual", "spell/mutual", { replaces: [`${TB1_SOURCE}:spell/mutual`] })],
      TB2_SOURCE,
    );
    expect(find({ q: "mutual" })).toHaveLength(2);
  });

  test("FR-CMPX-14 `definitionId` is a monster query's only; rules pages use the index's rows unfiltered", () => {
    const { s } = fresh();
    expect(SearchQuery.safeParse({ kind: "spell", definitionId: "x" }).success).toBe(false);
    expect(SearchQuery.safeParse({ definitionId: "x" }).success).toBe(false);
    const idx = searchIndex(s.db);
    expect(
      idx.rows
        .filter((r) => r.hidden)
        .map((r) => `${r.source}:${r.sourceKey}`)
        .sort(),
    ).toEqual(
      [
        `${TB1_SOURCE}:monster/gnasher`,
        "srd-5.1:monster/goblin",
        "srd-5.1:spell/hunters-mark",
      ].sort(),
    );
  });
});

describe("FR-CMPX-15 presets follow", () => {
  const addToSheet = (f: Fresh, entryId: string, characterId: string) =>
    f.s.commands.run(CMP_INTENTS.addToSheet, { entryId, characterId }, { actor: f.dmActor }) as {
      triggerId?: string;
      rowId: string;
    };
  const mira = (f: Fresh) =>
    f.s.db.select().from(entity).where(eq(entity.name, "Mira")).get()?.id as string;

  test("FR-CMPX-15 Add to sheet: the book's Hunter's Mark adds the SRD entry's trigger", () => {
    const f = fresh();
    const entry = f.row(TB1_SOURCE, "spell/hunters-mark");
    const r = addToSheet(f, entry?.id as string, mira(f));
    expect(r.triggerId).toBeDefined();
    const trigger = f.s.db
      .select()
      .from(ruleTrigger)
      .where(eq(ruleTrigger.id, r.triggerId as string))
      .get();
    expect(trigger?.name).toBe("Hunter's Mark");
  });

  test("FR-CMPX-15 a spell with nothing to inherit adds no trigger", () => {
    const f = fresh();
    const entry = f.row(TB1_SOURCE, "spell/emberlash");
    expect(addToSheet(f, entry?.id as string, mira(f)).triggerId).toBeUndefined();
  });

  test("FR-CMPX-15 the view's Preset line: GET carries the inherited name, its own preset wins, others none", async () => {
    const f = fresh();
    const entry = f.row(TB1_SOURCE, "spell/hunters-mark");
    const dmRead = readEntry(f.s.db, entry?.id as string, f.dm)?.body as EntryResponse;
    expect(dmRead.inheritedPreset).toBe("Hunter's Mark");
    const plRead = readEntry(f.s.db, entry?.id as string, f.pl)?.body as EntryResponse;
    expect(plRead.inheritedPreset).toBe("Hunter's Mark");
    const srd = f.row("srd-5.1", "spell/hunters-mark");
    const own = readEntry(f.s.db, srd?.id as string, f.dm)?.body as EntryResponse;
    expect(own.inheritedPreset).toBeUndefined();
    const none = f.row(TB1_SOURCE, "spell/emberlash");
    const plain = readEntry(f.s.db, none?.id as string, f.dm)?.body as EntryResponse;
    expect(plain.inheritedPreset).toBeUndefined();
  });

  test("FR-CMPX-15 chains and missing entries: a two-step chain inherits; a ref with no entry still finds the built-in; a cycle ends", () => {
    const f = fresh();
    f.book(
      [spell("Chain", "spell/chain", { replaces: [`${TB1_SOURCE}:spell/hunters-mark`] })],
      TB2_SOURCE,
    );
    const chain = f.row(TB2_SOURCE, "spell/chain");
    expect(readEntry(f.s.db, chain?.id as string, f.dm)?.body.inheritedPreset).toBe(
      "Hunter's Mark",
    );
    f.s.db
      .delete(compendiumEntry)
      .where(
        and(
          eq(compendiumEntry.source, "srd-5.1"),
          eq(compendiumEntry.sourceKey, "spell/hunters-mark"),
        ),
      )
      .run();
    const tb1 = f.row(TB1_SOURCE, "spell/hunters-mark");
    expect(readEntry(f.s.db, tb1?.id as string, f.dm)?.body.inheritedPreset).toBe("Hunter's Mark");
    f.book([spell("Loop A", "spell/loop-a", { replaces: [`${TB2_SOURCE}:spell/loop-b`] })]);
    f.book(
      [spell("Loop B", "spell/loop-b", { replaces: [`${TB1_SOURCE}:spell/loop-a`] })],
      TB2_SOURCE,
    );
    const loop = f.row(TB1_SOURCE, "spell/loop-a");
    expect(readEntry(f.s.db, loop?.id as string, f.dm)?.body.inheritedPreset).toBeUndefined();
  });

  test("FR-CMPX-15 the ETag changes when the inherited preset appears", () => {
    const f = fresh();
    f.book([spell("Later", "spell/later")]);
    const id = f.row(TB1_SOURCE, "spell/later")?.id as string;
    const before = readEntry(f.s.db, id, f.dm)?.etag;
    f.s.db
      .update(compendiumEntry)
      .set({ replaces: ["srd-5.1:spell/hunters-mark"] })
      .where(eq(compendiumEntry.id, id))
      .run();
    expect(readEntry(f.s.db, id, f.dm)?.etag).not.toBe(before);
  });
});

describe("FR-CMPX-16 rank and labels", () => {
  test("FR-CMPX-16 book sources rank 2: the SRD's row sorts first on equal tiers; sourceLabel = book name", () => {
    const { s, find, book } = fresh();
    const idx = searchIndex(s.db);
    expect(idx.rows.find((r) => r.source === TB1_SOURCE)?.rank).toBe(2);
    expect(idx.rows.find((r) => r.source === "srd-5.1")?.rank).toBe(1);
    book([spell("Fireball", "spell/fireball")]);
    expect(names(find({ q: "fireball", kind: "spell" }))).toEqual([
      "Fireball · SRD 5.1",
      "Fireball · Test Book One",
    ]);
  });

  test("FR-CMPX-16 Derive's copied rows use the book's abbreviation", () => {
    const { s, row, dmActor } = fresh();
    const goblin = row(TB1_SOURCE, "monster/goblin");
    const { entity: created } = s.commands.run(
      DERIVE_MONSTER,
      {
        entryId: goblin?.id as string,
        copyText: true,
        entity: {
          kind: "monster",
          name: "Derived Goblin",
          statBlock: { size: "small", ac: 12, hpMax: 9, initBonus: 1, attacks: [], cr: "1" },
        },
      },
      { actor: dmActor },
    ) as { entity: { id: string } };
    const sheet = s.db.$client
      .query<{ features: string }, [string]>(
        "SELECT features FROM creature_sheet WHERE entity_id = ?",
      )
      .get(created.id);
    const rows = JSON.parse(sheet?.features ?? "[]") as { name: string; source: string }[];
    expect(rows.map((r) => [r.name, r.source])).toEqual([["Bite", "TB1"]]);
  });
});

describe("FR-CMPX-21 CON-44", () => {
  test("FR-CMPX-21 CON-44 importing the books adds 0 B to every viewer's snapshot", async () => {
    const b = await servicesFromBundle(
      await loadBundle("cmpx-core", { dmSecret: TEST_SECRET, testMode: true }),
    );
    try {
      const before = snapshotSizes(b.s);
      const cid = b.s.db.select().from(campaign).where(eq(campaign.active, true)).get()?.id;
      const r = b.s.commands.run(
        IMPORT_RECORDED,
        {
          source: { ...BOOK, key: "5et-tb3" },
          version: "1",
          records: Array.from({ length: 50 }, (_, i) =>
            spell(`Con Spell ${i}`, `spell/con-${i}`, {
              replaces: [`${TB1_SOURCE}:spell/emberlash`],
            }),
          ),
        },
        { actor: { role: "dm", playerId: null, campaignId: cid ?? null } },
      ) as ImportResult;
      expect(r.changed).toBe(true);
      const after = snapshotSizes(b.s);
      expect(after.map((v) => v.label)).toEqual(before.map((v) => v.label));
      for (const [i, v] of after.entries()) {
        expect({ viewer: v.label, growth: v.bytes - (before[i]?.bytes ?? 0) }).toEqual({
          viewer: v.label,
          growth: 0,
        });
      }
    } finally {
      b.cleanup();
    }
  }, 60_000);
});

describe("imported_art table (compendium-expansion §8)", () => {
  test("FR-CMPX-24 schema: one row per (campaign, source, key); an asset's delete takes its row", () => {
    const { s, cid } = fresh();
    const AT = "2026-01-01T00:00:00.000Z";
    const assetId = "asset-1";
    s.db
      .insert(asset)
      .values({
        id: assetId,
        campaignId: cid,
        seq: 1,
        name: "Goblin",
        hash: "h",
        mime: "image/webp",
        bytes: 1,
        width: 1,
        height: 1,
        displayWidth: 1,
        displayHeight: 1,
        createdAt: AT,
      })
      .run();
    const row = { campaignId: cid, source: TB1_SOURCE, sourceKey: "monster/goblin", assetId };
    s.db
      .insert(importedArt)
      .values({ ...row, createdAt: AT })
      .run();
    expect(() =>
      s.db
        .insert(importedArt)
        .values({ ...row, createdAt: AT })
        .run(),
    ).toThrow(/UNIQUE|PRIMARY/);
    s.db.delete(asset).where(eq(asset.id, assetId)).run();
    expect(s.db.select().from(importedArt).all()).toEqual([]);
  });
});
