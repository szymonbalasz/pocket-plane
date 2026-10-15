// FR-MAP-50: the token's `characterId` display copy: place, duplicate, scene copy, definition
// edits and the boot backfill. Visibility (FR-MAP-26) is in visibility.test.ts / sync.test.ts.

import { describe, expect, test } from "bun:test";
import { FOG_INTENTS } from "@shared/fog-of-war/schemas";
import type { SceneRecord, TokenRecord } from "@shared/scenes-map/schemas";
import { MAP_INTENTS as I } from "@shared/scenes-map/schemas";
import { eq } from "drizzle-orm";
import { token } from "../../db/schema";
import { UPDATE } from "../entities/commands";
import { miraBlock } from "../entities/testing";
import { backfillCharacterIds } from "./character-copy";
import { MAP_REST as R } from "./commands";
import { scenesSetup } from "./testing";

function setup() {
  const t = scenesSetup();
  const scene = t.run<SceneRecord>(R.createScene, {
    name: "Goblin Ambush",
    mapAssetId: "map-battle",
  });
  t.run(FOG_INTENTS.setAll, { sceneId: scene.id, fogged: false }); // FR-FOG-25 ripple
  const tokenRow = (id: string) =>
    t.s.db.select().from(token).where(eq(token.id, id)).get() as TokenRecord;
  const place = (definitionId: string, col: number, row: number) =>
    tokenRow(
      t.run<{ tokenId: string }>(I.placeToken, { sceneId: scene.id, definitionId, col, row })
        .tokenId,
    );
  return { ...t, scene, tokenRow, place };
}

describe("FR-MAP-50 token characterId copy", () => {
  test("place: character token → its definition id; monster token → null", () => {
    const t = setup();
    expect(t.place(t.miraId, 1, 1).characterId).toBe(t.miraId);
    expect(t.place(t.h.goblinId, 3, 3).characterId).toBeNull();
    const ev = t.events.at(-1)?.event;
    expect(ev?.changes[0]?.after).toMatchObject({ characterId: null });
  });

  test("never in an intent schema: sending characterId → invalid", () => {
    const t = setup();
    const placed = t.place(t.h.goblinId, 1, 1);
    const place = { sceneId: t.scene.id, definitionId: t.h.goblinId, col: 2, row: 2 };
    expect(t.err(() => t.run(I.placeToken, { ...place, characterId: t.miraId })).code).toBe(
      "invalid",
    );
    expect(
      t.err(() => t.run(I.updateToken, { tokenId: placed.id, characterId: t.miraId })).code,
    ).toBe("invalid");
  });

  test("duplicate token and scene copy keep the copy", () => {
    const t = setup();
    const mira = t.place(t.miraId, 1, 1);
    const goblin = t.place(t.h.goblinId, 5, 5);
    const dup = t.run<{ tokenId: string }>(I.duplicateToken, { tokenId: mira.id });
    expect(t.tokenRow(dup.tokenId).characterId).toBe(t.miraId);
    const copy = t.run<SceneRecord>(R.duplicateScene, { id: t.scene.id });
    const copied = t.s.db.select().from(token).where(eq(token.sceneId, copy.id)).all();
    expect(copied.map((c) => [c.name, c.characterId])).toEqual([
      [mira.name, t.miraId],
      [goblin.name, null],
      [t.tokenRow(dup.tokenId).name, t.miraId],
    ]);
  });

  test("definition edit re-asserts it (FR-MAP-20 path), listed in EntityUpdated.changes", () => {
    const t = setup();
    const mira = t.place(t.miraId, 1, 1);
    const miraEdit = { id: t.miraId, name: "Mira", ownerPlayerId: t.h.p1.id };
    t.s.db.update(token).set({ characterId: null }).where(eq(token.id, mira.id)).run();
    t.run(UPDATE, { ...miraEdit, statBlock: { ...miraBlock, ac: 15 } });
    expect(t.tokenRow(mira.id).characterId).toBe(t.miraId);
    const ev = t.events.at(-1)?.event;
    expect(ev?.type).toBe("EntityUpdated");
    expect(ev?.changes.find((c) => c.type === "token")?.after).toMatchObject({
      characterId: t.miraId,
    });
    // Already right → no token change.
    t.run(UPDATE, { ...miraEdit, statBlock: { ...miraBlock, ac: 16 } });
    expect(t.events.at(-1)?.event.changes.map((c) => c.type)).toEqual(["entity"]);
  });

  test("boot backfill: null copies of character tokens filled, monsters untouched, idempotent", () => {
    const t = setup();
    const mira = t.place(t.miraId, 1, 1);
    const thorn = t.place(t.thornId, 3, 1);
    const goblin = t.place(t.h.goblinId, 5, 5);
    t.s.db.update(token).set({ characterId: null }).run();
    backfillCharacterIds(t.s.db);
    expect(t.tokenRow(mira.id).characterId).toBe(t.miraId);
    expect(t.tokenRow(thorn.id).characterId).toBe(t.thornId);
    expect(t.tokenRow(goblin.id).characterId).toBeNull();
    const before = t.s.db.select().from(token).all();
    backfillCharacterIds(t.s.db);
    expect(t.s.db.select().from(token).all()).toEqual(before);
    // Registered as a server start hook.
    expect(t.s.startHooks.map((h) => h.name)).toContain("scenes-map.character-backfill");
  });
});
