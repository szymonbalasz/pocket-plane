// ASSET §13.1 `FR-ASSET-49 backfill guesses` (OQ-ASSET-26 A, review #10): `image-search` with
// every asset's `tags` nulled by the test, as a pre-IM-1 DB. The start hook guesses tags from
// current use, once per DB (marker in the same transaction); a second start changes nothing; a DB
// with no null row gets no write and no marker; a throw mid-backfill commits nothing.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { asc, eq, isNull } from "drizzle-orm";
import { realContext } from "../../commands/context";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { stateDigest } from "../../db/digest";
import { asset, campaign, dbMeta, entity, prop, scene } from "../../db/schema";
import { startTestServer } from "../../testing/harness";
import { backfillAssetTags, TAGS_BACKFILL_KEY } from "./backfill";

const dirs: string[] = [];
const dbs: Db[] = [];
afterAll(() => {
  for (const db of dbs) closeDb(db);
  Bun.gc(true);
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // Windows may hold the WAL briefly; a leftover temp dir is harmless.
    }
  }
});

async function open(bundle: string) {
  const r = await loadBundle(bundle, { testMode: true });
  dirs.push(r.dir);
  const db = openFileDb(r.config.dbPath);
  dbs.push(db);
  return db;
}

const tagsByName = (db: Db) =>
  Object.fromEntries(
    db
      .select({ name: asset.name, tags: asset.tags })
      .from(asset)
      .orderBy(asc(asset.seq))
      .all()
      .map((r) => [r.name, r.tags]),
  );
const marker = (db: Db) =>
  db.select().from(dbMeta).where(eq(dbMeta.key, TAGS_BACKFILL_KEY)).get()?.value;

describe("tag backfill (FR-ASSET-49)", () => {
  let db: Db;
  beforeAll(async () => {
    db = await open("image-search");
  }, 60_000);

  test("FR-ASSET-49 backfill guesses: maps → Maps, token art → Tokens, h6's attachment → Handouts, Moonlit Lantern's images → Items, portrait + prop → both, unused → []; marker in the same transaction; second start identical; a throw mid-backfill commits nothing", async () => {
    const id = (name: string) =>
      db.select().from(asset).where(eq(asset.name, name)).get()?.id as string;
    const cid = db.select().from(campaign).where(eq(campaign.active, true)).get()?.id as string;
    // Uses the fixtures lack: a portrait (Mira Portrait), and Elite Goblin as a portrait and a prop.
    const [first, second] = db.select().from(entity).where(eq(entity.campaignId, cid)).all();
    db.update(entity)
      .set({ portraitAssetId: id("Mira Portrait") })
      .where(eq(entity.id, first?.id as string))
      .run();
    db.update(entity)
      .set({ portraitAssetId: id("Elite Goblin") })
      .where(eq(entity.id, second?.id as string))
      .run();
    const sceneId = db.select().from(scene).where(eq(scene.campaignId, cid)).get()?.id as string;
    db.insert(prop)
      .values({
        id: "backfill-prop",
        campaignId: cid,
        sceneId,
        seq: 9_999,
        assetId: id("Elite Goblin"),
        col: 0,
        row: 0,
        w: 1,
        h: 1,
        seenBy: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      })
      .run();
    // A pre-IM-1 DB: every row null, no marker.
    db.update(asset).set({ tags: null }).run();
    expect(marker(db)).toBeUndefined();

    // Injected throw mid-backfill: nothing committed (rows still null, no marker).
    let n = 0;
    expect(() =>
      backfillAssetTags(db, realContext(), {
        afterRow: () => {
          if (++n === 5) throw new Error("crash mid-backfill");
        },
      }),
    ).toThrow("crash mid-backfill");
    expect(db.select().from(asset).where(isNull(asset.tags)).all().length).toBe(
      db.select().from(asset).all().length,
    );
    expect(marker(db)).toBeUndefined();

    // The next start completes it (start hook, before listening).
    const h = await startTestServer({ db });
    try {
      const t = tagsByName(db);
      expect([t.town, t.battlemap]).toEqual([["Maps"], ["Maps"]]);
      for (const name of ["token-mira", "token-goblin", "token-wolf", "token-elite", "token-thorn"])
        expect([name, t[name]]).toEqual([name, ["Tokens"]]);
      // h6's attachment (handout-attachment) and the shared handout's image → Handouts.
      expect([t["ransom-note"], t["thieves-map"]]).toEqual([["Handouts"], ["Handouts"]]);
      // Moonlit Lantern's two images + CMP-IMG-SECRET's (all item entries) → Items.
      expect([t.lantern, t["lantern-lit"], t.relic]).toEqual([["Items"], ["Items"], ["Items"]]);
      expect(t["Mira Portrait"]).toEqual(["Portraits"]);
      expect(t["Elite Goblin"]).toEqual(["Portraits", "Props"]);
      // Unused → Untagged.
      expect([t["Misc Sketch"], t["wanted-poster"], t["Pasted image 2026-10-19 20:15"]]).toEqual([
        [],
        [],
        [],
      ]);
      expect(db.select().from(asset).where(isNull(asset.tags)).all()).toEqual([]);
      expect(marker(db)).toBe(h.clock.iso());

      // Second start: nothing changes.
      const digest = stateDigest(db.$client);
      await h.restart();
      expect(stateDigest(db.$client)).toEqual(digest);
      expect(marker(db)).toBe(h.clock.iso());
      // Marker set → even a null row (none should exist) is left alone.
      expect(backfillAssetTags(db, realContext())).toBe(0);
    } finally {
      await h.stop();
    }
  }, 60_000);

  test("FR-ASSET-49 no null row (fresh / fixture DB): start writes nothing and no marker", async () => {
    const fresh = await open("asset-library");
    expect(fresh.select().from(asset).where(isNull(asset.tags)).all()).toEqual([]);
    const before = stateDigest(fresh.$client);
    const h = await startTestServer({ db: fresh });
    try {
      expect(stateDigest(fresh.$client)).toEqual(before);
      expect(marker(fresh)).toBeUndefined();
    } finally {
      await h.stop();
    }
  }, 60_000);
});
