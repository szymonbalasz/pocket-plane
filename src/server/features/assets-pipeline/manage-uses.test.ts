// ASSET §13.1 `FR-ASSET-64 in use` (#386, OQ-ASSET-05 A) over `image-search` (session-sim-9's
// scenes, tokens, props, handouts, homebrew images and running encounter + 24 library images):
// every kind of holder blocks the delete and is named; an ended encounter's combatants don't
// count and lose the image; an unused image deletes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import {
  type AssetUse,
  inUseMessage,
  ASSET_MANAGE_INTENTS as M,
} from "@shared/assets-pipeline/manage";
import { PAUSE_INTENT, RESUME_INTENT } from "@shared/campaign-management/table-state";
import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import { CommandError } from "../../commands/errors";
import { closeDb, type Db, openFileDb } from "../../db/client";
import {
  asset,
  campaign,
  combatant,
  compendiumEntry,
  encounter,
  entity,
  handout,
  prop,
  scene,
  token,
} from "../../db/schema";
import { startTestServer, type TestServer } from "../../testing/harness";
import { DM_ACTOR } from "../../testing/services";
import { assetUses } from "./manage";

let h: TestServer;
let db: Db;
let dir: string;
let cid: string;

beforeAll(async () => {
  const loaded = await loadBundle("image-search", { testMode: true });
  dir = loaded.dir;
  db = openFileDb(loaded.config.dbPath);
  cid = db.select().from(campaign).where(eq(campaign.active, true)).get()?.id as string;
  h = await startTestServer({ db, fake: false });
}, 60_000);

afterAll(async () => {
  await h.stop();
  closeDb(db);
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows may hold the WAL briefly; a leftover temp dir is harmless.
  }
});

const actor = () => ({ ...DM_ACTOR, campaignId: cid });
const run = (name: string, input: unknown) => h.s.commands.run(name, input, { actor: actor() });
const exists = (id: string) => db.select().from(asset).where(eq(asset.id, id)).get() !== undefined;

function deleteError(id: string) {
  try {
    run(M.delete, { assetId: id });
  } catch (e) {
    if (e instanceof CommandError) return { code: e.code, message: e.message };
    throw e;
  }
  throw new Error("expected a CommandError");
}

const kinds = (uses: AssetUse[]) => uses.map((u) => u.kind);

/** An image of the campaign no holder uses. */
function unused(): string {
  const all = db
    .select({ id: asset.id })
    .from(asset)
    .where(and(eq(asset.campaignId, cid), eq(asset.kind, "image")))
    .all();
  const free = all.find((a) => assetUses(db, a.id).length === 0);
  if (!free) throw new Error("no unused image in image-search");
  return free.id;
}

describe("FR-ASSET-64 in use (image-search)", () => {
  test("FR-ASSET-64 in use: a scene map, prop, token, handout, compendium entry and running combatant each block the delete, named in the reject; nothing written", () => {
    const map = db.select().from(scene).where(eq(scene.campaignId, cid)).get();
    // The bundle has no prop: one on the first scene, holding a library image.
    db.insert(prop)
      .values({
        id: "test-prop",
        campaignId: cid,
        sceneId: map?.id as string,
        seq: 9_999,
        assetId: unused(),
        col: 0,
        row: 0,
        w: 1,
        h: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      })
      .run();
    const p = db.select().from(prop).where(eq(prop.id, "test-prop")).get();
    const t = db.select().from(token).where(isNotNull(token.imageAssetId)).get();
    const ho = db
      .select()
      .from(handout)
      .where(and(eq(handout.campaignId, cid), sql`json_array_length(${handout.imageAssetIds}) > 0`))
      .get();
    const entry = db
      .select()
      .from(compendiumEntry)
      .where(
        and(
          eq(compendiumEntry.campaignId, cid),
          sql`json_array_length(${compendiumEntry.imageAssetIds}) > 0`,
        ),
      )
      .get();
    const cb = db
      .select({ name: combatant.name, imageAssetId: combatant.imageAssetId })
      .from(combatant)
      .innerJoin(encounter, eq(combatant.encounterId, encounter.id))
      .where(and(isNotNull(combatant.imageAssetId), ne(encounter.status, "ended")))
      .get();
    const holders: [AssetUse, string | null | undefined][] = [
      [{ kind: "scene map", name: map?.name ?? "" }, map?.mapAssetId],
      [{ kind: "token", name: t?.name ?? "" }, t?.imageAssetId],
      [{ kind: "combatant", name: cb?.name ?? "" }, cb?.imageAssetId],
      [{ kind: "handout", name: ho?.title ?? "" }, ho?.imageAssetIds[0]],
      [{ kind: "compendium entry", name: entry?.name ?? "" }, entry?.imageAssetIds[0]],
    ];
    const propScene = db
      .select()
      .from(scene)
      .where(eq(scene.id, p?.sceneId ?? ""))
      .get();
    holders.push([{ kind: "prop", name: propScene?.name ?? "" }, p?.assetId]);
    for (const [use, id] of holders) {
      expect([use.kind, typeof id]).toEqual([use.kind, "string"]);
      const uses = assetUses(db, id as string);
      expect(uses).toContainEqual(use);
      const err = deleteError(id as string);
      expect(err).toEqual({ code: "conflict", message: inUseMessage(uses) });
      expect(err.message).toContain(`${use.name} (${use.kind})`);
      expect(exists(id as string)).toBe(true);
    }
  });

  test("FR-ASSET-64 in use: a portrait and the pause card block it; after resume and the portrait cleared it deletes", () => {
    const id = unused();
    const pc = db.select().from(entity).where(eq(entity.campaignId, cid)).get();
    db.update(entity)
      .set({ portraitAssetId: id })
      .where(eq(entity.id, pc?.id as string))
      .run();
    run(PAUSE_INTENT, { imageAssetId: id });
    expect(assetUses(db, id)).toEqual([
      { kind: "portrait", name: pc?.name as string },
      { kind: "pause card", name: null },
    ]);
    expect(deleteError(id).message).toBe(
      `In use: ${pc?.name} (portrait), pause card. Change those first.`,
    );
    run(RESUME_INTENT, {});
    db.update(entity)
      .set({ portraitAssetId: null })
      .where(eq(entity.id, pc?.id as string))
      .run();
    run(M.delete, { assetId: id });
    expect(exists(id)).toBe(false);
  });

  test("FR-ASSET-63 an ended encounter's combatants don't count; the delete clears their image", () => {
    const id = unused();
    const cb = db
      .select({ id: combatant.id, encounterId: combatant.encounterId })
      .from(combatant)
      .get();
    db.update(combatant)
      .set({ imageAssetId: id })
      .where(eq(combatant.id, cb?.id as string))
      .run();
    expect(kinds(assetUses(db, id))).toEqual(["combatant"]);
    const enc = db
      .select()
      .from(encounter)
      .where(eq(encounter.id, cb?.encounterId as string))
      .get();
    db.update(encounter)
      .set({ status: "ended" })
      .where(eq(encounter.id, enc?.id as string))
      .run();
    try {
      expect(assetUses(db, id)).toEqual([]);
      run(M.delete, { assetId: id });
      expect(exists(id)).toBe(false);
      const after = db
        .select()
        .from(combatant)
        .where(eq(combatant.id, cb?.id as string))
        .get();
      expect(after?.imageAssetId).toBeNull();
    } finally {
      db.update(encounter)
        .set({ status: enc?.status ?? "started" })
        .where(eq(encounter.id, enc?.id as string))
        .run();
    }
  });
});
