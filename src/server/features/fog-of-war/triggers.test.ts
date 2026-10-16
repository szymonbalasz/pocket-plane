// FR-FOG-35 campaign-wide triggers in V0 (static copies, ADR-0042): a new player (player-hooks
// `added`, OQ-FOG-39) joins `seenBy` / `doorSeen` on the active scene in the add transaction; the
// campaign's other scenes are marked `visionStale` and re-derive inside their activation
// (scene-hooks `activated`). Record types `fog-explored` / `vision` registered (view-as window).
import { describe, expect, test } from "bun:test";
import { FOG_INTENTS as F, FOG_EXPLORED_TYPE, VISION_TYPE } from "@shared/fog-of-war/schemas";
import { MAP_INTENTS as I, type SceneRecord } from "@shared/scenes-map/schemas";
import { eq } from "drizzle-orm";
import { sceneFog, token } from "../../db/schema";
import { readEventLog } from "../../events/log";
import { addPlayer } from "../campaign-management/commands";
import { playerHooks } from "../campaign-management/player-hooks";
import { MAP_REST as R } from "../scenes-map/commands";
import { sceneHooks } from "../scenes-map/scene-hooks";
import { scenesSetup } from "../scenes-map/testing";

function setup() {
  const t = scenesSetup();
  const scene = (name: string) => {
    const s = t.run<SceneRecord>(R.createScene, { name, mapAssetId: "map-battle" });
    t.run(F.setAll, { sceneId: s.id, fogged: false });
    return s;
  };
  const a = scene("Active");
  const b = scene("Prep");
  t.run(I.activateScene, { sceneId: a.id });
  const place = (sceneId: string, col: number, row: number) =>
    t.run<{ tokenId: string }>(I.placeToken, {
      sceneId,
      definitionId: t.h.goblinId,
      col,
      row,
    }).tokenId;
  const ga = place(a.id, 1, 1);
  const gb = place(b.id, 1, 1);
  const seenBy = (id: string) =>
    t.s.db.select({ s: token.seenBy }).from(token).where(eq(token.id, id)).get()?.s ?? null;
  const stale = (sceneId: string) =>
    t.s.db
      .select({ v: sceneFog.visionStale })
      .from(sceneFog)
      .where(eq(sceneFog.sceneId, sceneId))
      .get()?.v;
  return { ...t, a, b, ga, gb, seenBy, stale };
}

describe("FR-FOG-35 / OQ-FOG-39 player added", () => {
  test("FR-FOG-24 the registries carry fog's lines (player-hooks added, scene-hooks activated)", () => {
    expect(playerHooks.map((h) => h.name)).toEqual(["fog-of-war.player-membership"]);
    expect(sceneHooks.find((h) => h.name === "fog-of-war.fog-row")?.activated).toBeDefined();
  });

  test("FR-FOG-35 a new player joins seenBy on the active scene in PlayerAdded; other scenes visionStale", () => {
    const t = setup();
    const before = t.seenBy(t.ga);
    expect(before).toHaveLength(2);
    const log = readEventLog(t.s.db).length;
    const p3 = t.run<{ id: string }>(addPlayer.name, { name: "Player 3" });
    expect(t.seenBy(t.ga)).toEqual([...(before ?? []), p3.id]);
    // The prep scene keeps its copies until activated.
    expect(t.seenBy(t.gb)).toHaveLength(2);
    expect(t.stale(t.b.id)).toBe(true);
    expect(t.stale(t.a.id)).toBe(false);
    const ev = t.events.at(-1)?.event;
    expect(ev?.type).toBe("PlayerAdded");
    expect(ev?.changes.map((c) => [c.type, c.id])).toEqual([
      ["player", p3.id],
      ["token", t.ga],
    ]);
    expect(readEventLog(t.s.db).length).toBe(log + 1);
    // The new player sees the active scene's monster (static clear) at once.
    const v = t.h.viewer("player", p3.id);
    expect(t.s.records.view("token", ev?.changes[1]?.after, v).vis).toBe("redacted");
  });

  test("FR-FOG-35 activating a stale scene re-derives it inside SceneActivated and clears the flag", () => {
    const t = setup();
    const p3 = t.run<{ id: string }>(addPlayer.name, { name: "Player 3" });
    t.run(I.activateScene, { sceneId: t.b.id });
    expect(t.seenBy(t.gb)).toContain(p3.id);
    expect(t.stale(t.b.id)).toBe(false);
    const ev = t.events.at(-1)?.event;
    expect(ev?.type).toBe("SceneActivated");
    expect(ev?.changes.map((c) => c.type)).toEqual(["scene", "scene", "token"]);
    // A fresh scene activation (not stale) re-derives nothing.
    t.run(I.activateScene, { sceneId: t.a.id });
    expect(t.events.at(-1)?.event.changes.map((c) => c.type)).toEqual(["scene", "scene"]);
  });
});

describe("FR-FOG-39 / -37 / -43 record types registered (V0: empty)", () => {
  test("FR-FOG-43 vision and fog-explored: scene scope, view-as window; vision derived; V0 rows none", () => {
    const t = setup();
    const types = Object.fromEntries(t.s.records.all().map((d) => [d.type, d]));
    for (const type of [VISION_TYPE, FOG_EXPLORED_TYPE]) {
      expect(types[type]?.scope).toBe("scene");
      expect(types[type]?.dmWindow).toBe("view-as");
    }
    expect(types[VISION_TYPE]?.derived).toBe(true);
    expect(types.fog?.dmWindow).toBe("active-scene");
    const p1 = t.h.viewer("player", t.h.p1.id);
    expect(t.h.snapshot(p1)[VISION_TYPE]).toEqual([]);
    expect(t.h.snapshot(t.h.viewer("dm"))[FOG_EXPLORED_TYPE]).toEqual([]);
  });
});
