// Prop commands (FR-SCN-16–19, -33, -35): each writes its row + one log entry + one event with IDs
// and time from ctx; caps and a locked footprint → `conflict`; other campaigns → `not_found`;
// players refused; `fogged` derived before the write; player frames per FR-SCN-19 through the
// commands' own changes; a crash is all or nothing.
import { afterEach, describe, expect, test } from "bun:test";
import { seenByNobody } from "@shared/fog-of-war/visibility";
import {
  PROPS_PER_CAMPAIGN_MAX,
  PROPS_PER_SCENE_MAX,
  SCN_INTENTS as S,
  SCENE_PROP_TYPE,
  type ScenePropRecord,
} from "@shared/scene-tools/schemas";
import { MAP_INTENTS as I } from "@shared/scenes-map/schemas";
import { seededContext } from "../../commands/context";
import { armCrashHook } from "../../commands/crash";
import { stateDigest } from "../../db/digest";
import { readEventLog } from "../../events/log";
import type { RecordChange } from "../../events/types";
import { type SceneObject, visibilityHooks } from "../scenes-map/visibility-hooks";
import { PROP_LOCKED, PROP_OFF_MAP } from "./props";
import { readProp, sceneProps } from "./rows";
import { scnSetup } from "./testing";

afterEach(() => {
  visibilityHooks.unregister("test.fog");
  armCrashHook(null);
});

function setup() {
  const t = scnSetup();
  const place = (input: Record<string, unknown> = {}, key?: string) =>
    t.run<{ propId: string }>(
      S.placeProp,
      { sceneId: t.ambush.id, assetId: "prop-barrel", col: 5, row: 3, ...input },
      t.h.dm,
      key,
    ).propId;
  const get = (id: string) => readProp(t.s.db, id) as ScenePropRecord;
  const lastEvent = () => t.events.at(-1)?.event;
  const p1 = t.h.viewer("player", t.h.p1.id);
  const dm = t.h.viewer("dm");
  /** The last event's prop change as `viewer` receives it. */
  const seen = (v: typeof p1) => {
    const [c] = lastEvent()?.changes ?? [];
    return t.s.records.filterChange(c as RecordChange, v);
  };
  /** Rows of `prop` beyond `n`, as filler, on `sceneId`. */
  const fill = (n: number, sceneId: string) => {
    const q = t.s.db.$client.query(
      "INSERT INTO prop (id, campaign_id, scene_id, seq, asset_id, col, row, w, h, created_at, updated_at) VALUES (?, ?, ?, ?, 'prop-barrel', 0, 0, 1, 1, '', '')",
    );
    const seq0 = 10_000 * (1 + t.count("prop"));
    for (let i = 0; i < n; i++) q.run(`f${sceneId}${i}`, t.h.campaignId, sceneId, seq0 + i);
  };
  return { ...t, place, get, lastEvent, p1, dm, seen, fill };
}

describe("FR-SCN-16 scn.placeProp", () => {
  test("FR-SCN-16 places 1 × 1 by default: row + one PropPlaced logged, IDs and time from ctx", () => {
    const t = setup();
    const logBefore = readEventLog(t.s.db).length;
    const id = t.place({}, "k1");
    expect(id).toBe(seededContext({ disposable: true, key: "k1" }).ids.next());
    expect(t.get(id)).toEqual({
      id,
      campaignId: t.h.campaignId,
      sceneId: t.ambush.id,
      seq: 1,
      assetId: "prop-barrel",
      col: 5,
      row: 3,
      w: 1,
      h: 1,
      rotation: 0,
      z: 0,
      hidden: false,
      locked: false,
      seenBy: [t.h.p1.id, t.h.p2.id], // FR-FOG-10: every player (revealed scene)
    });
    const row = t.s.db.$client
      .query<{ created_at: string }, []>("SELECT created_at FROM prop")
      .get();
    expect(row?.created_at).toBe(seededContext({ disposable: true, key: "k1" }).clock.iso());
    const log = readEventLog(t.s.db).slice(logBefore);
    expect(log.map((l) => l.type)).toEqual(["PropPlaced"]);
    expect(t.lastEvent()).toMatchObject({ type: "PropPlaced", payload: { propId: id } });
    expect(t.lastEvent()?.changes).toEqual([
      { type: SCENE_PROP_TYPE, id, before: null, after: t.get(id) },
    ]);
    // Size and hidden given; works on a non-active scene (prep).
    const big = t.place({ sceneId: t.cellar.id, w: 3, h: 2, hidden: true });
    expect(t.get(big)).toMatchObject({ sceneId: t.cellar.id, w: 3, h: 2, hidden: true });
    expect(t.s.intents.has(S.placeProp)).toBe(true);
  });

  test("FR-SCN-16 / FR-ASSET-15 other campaign's asset or scene → not_found; off the map, bad sides → invalid", () => {
    const t = setup();
    expect(t.err(() => t.place({ assetId: "art-other" })).code).toBe("not_found");
    expect(t.err(() => t.place({ assetId: "nope" })).code).toBe("not_found");
    expect(t.err(() => t.place({ sceneId: "nope" })).code).toBe("not_found");
    // Goblin Ambush is 20 × 14: (20, 0) is off; (-1, -1) at 2 × 2 still overlaps.
    const off = t.err(() => t.place({ col: 20 }));
    expect(off).toMatchObject({ code: "invalid", message: PROP_OFF_MAP });
    expect(t.err(() => t.place({ row: -3, h: 3 })).code).toBe("invalid");
    expect(t.place({ col: -1, row: -1, w: 2, h: 2 })).toBeString();
    for (const bad of [{ w: 0 }, { h: 21 }, { w: 1.5 }, { fogged: true }, { locked: true }]) {
      expect(t.err(() => t.place(bad)).code).toBe("invalid");
    }
    expect(t.count("prop")).toBe(1);
  });

  test("FR-SCN-16 caps: 200 per scene, 2,000 per campaign → conflict, nothing written", () => {
    const t = setup();
    t.fill(PROPS_PER_SCENE_MAX, t.ambush.id);
    const events = t.events.length;
    expect(t.err(() => t.place()).code).toBe("conflict");
    expect(t.place({ sceneId: t.cellar.id })).toBeString();
    t.fill(PROPS_PER_CAMPAIGN_MAX - PROPS_PER_SCENE_MAX - 1, t.cellar.id);
    expect(t.count("prop")).toBe(PROPS_PER_CAMPAIGN_MAX);
    const third = t.newScene("Third");
    const events2 = t.events.length;
    const err = t.err(() => t.place({ sceneId: third.id }));
    expect(err).toMatchObject({ code: "conflict" });
    expect(err.message).toContain("campaign");
    expect(t.count("prop")).toBe(PROPS_PER_CAMPAIGN_MAX);
    expect(t.events.length).toBe(events2);
    // The Cellar prop + the new scene + its reveal (FR-FOG-25 ripple).
    expect(events2).toBe(events + 3);
  });

  test("FR-SCN-16 players are refused every prop intent", () => {
    const t = setup();
    const id = t.place();
    const p = t.player(t.h.p1);
    for (const [name, input] of [
      [S.placeProp, { sceneId: t.ambush.id, assetId: "prop-barrel", col: 1, row: 1 }],
      [S.updateProp, { propId: id, col: 1 }],
      [S.setPropHidden, { propId: id, hidden: true }],
      [S.duplicateProp, { propId: id }],
      [S.deleteProp, { propId: id }],
    ] as const) {
      expect(t.err(() => t.run(name, input, p)).code).toBe("forbidden");
    }
    expect(t.count("prop")).toBe(1);
  });
});

describe("FR-SCN-17 edit", () => {
  test("FR-SCN-17 scn.updateProp moves, resizes, rotates, reorders, locks, swaps the image", () => {
    const t = setup();
    const id = t.place();
    t.run(S.updateProp, { propId: id, col: 6, row: 12, w: 2, h: 2 });
    expect(t.lastEvent()).toMatchObject({ type: "PropUpdated", payload: { propId: id } });
    expect(t.get(id)).toMatchObject({ col: 6, row: 12, w: 2, h: 2 });
    t.run(S.updateProp, { propId: id, rotation: 90, z: 3, assetId: "prop-table" });
    expect(t.get(id)).toMatchObject({ rotation: 90, z: 3, assetId: "prop-table" });
    const [c] = t.lastEvent()?.changes ?? [];
    expect(c?.before).toMatchObject({ rotation: 0, z: 0, assetId: "prop-barrel" });
    // Nothing changes → no event, no log entry.
    const events = t.events.length;
    const log = readEventLog(t.s.db).length;
    t.run(S.updateProp, { propId: id, col: 6, rotation: 90 });
    t.run(S.updateProp, { propId: id });
    expect(t.events.length).toBe(events);
    expect(readEventLog(t.s.db).length).toBe(log);
    // Bad values.
    for (const bad of [{ rotation: 45 }, { w: 21 }, { hidden: true }, { fogged: true }]) {
      expect(t.err(() => t.run(S.updateProp, { propId: id, ...bad })).code).toBe("invalid");
    }
    expect(t.err(() => t.run(S.updateProp, { propId: id, col: 40 })).message).toBe(PROP_OFF_MAP);
    expect(t.err(() => t.run(S.updateProp, { propId: id, assetId: "art-other" })).code).toBe(
      "not_found",
    );
    expect(t.err(() => t.run(S.updateProp, { propId: "nope", col: 1 })).code).toBe("not_found");
  });

  test("FR-SCN-17 a locked prop can't be moved or resized; rotate, reorder, image, unlock still work", () => {
    const t = setup();
    const id = t.place();
    t.run(S.updateProp, { propId: id, locked: true });
    expect(t.get(id).locked).toBe(true);
    const events = t.events.length;
    for (const move of [{ col: 6 }, { row: 4 }, { w: 2 }, { h: 2 }, { col: 6, locked: false }]) {
      expect(t.err(() => t.run(S.updateProp, { propId: id, ...move }))).toMatchObject({
        code: "conflict",
        message: PROP_LOCKED,
      });
    }
    expect(t.events.length).toBe(events);
    // Same footprint is not a move.
    t.run(S.updateProp, { propId: id, col: 5, row: 3, rotation: 180, z: -1 });
    expect(t.get(id)).toMatchObject({ col: 5, row: 3, rotation: 180, z: -1, locked: true });
    t.run(S.updateProp, { propId: id, locked: false });
    t.run(S.updateProp, { propId: id, col: 7 });
    expect(t.get(id)).toMatchObject({ col: 7, locked: false });
  });

  test("FR-SCN-17 / -19 hide → PropHidden, reveal → PropRevealed; unchanged → nothing", () => {
    const t = setup();
    const id = t.place();
    t.run(S.setPropHidden, { propId: id, hidden: true });
    expect(t.lastEvent()).toMatchObject({ type: "PropHidden", payload: { propId: id } });
    expect(t.get(id).hidden).toBe(true);
    const events = t.events.length;
    t.run(S.setPropHidden, { propId: id, hidden: true });
    expect(t.events.length).toBe(events);
    t.run(S.setPropHidden, { propId: id, hidden: false });
    expect(t.lastEvent()).toMatchObject({ type: "PropRevealed", payload: { propId: id } });
    expect(t.err(() => t.run(S.setPropHidden, { propId: "nope", hidden: true })).code).toBe(
      "not_found",
    );
  });

  test("FR-SCN-17 duplicate: new ID, same fields, at col + w, else col − w, else the source cell", () => {
    const t = setup();
    const id = t.place({ w: 2, h: 1, hidden: true });
    t.run(S.updateProp, { propId: id, rotation: 270, z: 4, locked: true });
    const copy = t.run<{ propId: string }>(S.duplicateProp, { propId: id }, t.h.dm, "dup").propId;
    expect(copy).toBe(seededContext({ disposable: true, key: "dup" }).ids.next());
    expect(t.lastEvent()).toMatchObject({ type: "PropDuplicated", payload: { propId: copy } });
    expect(t.lastEvent()?.changes).toEqual([
      { type: SCENE_PROP_TYPE, id: copy, before: null, after: t.get(copy) },
    ]);
    const { id: _a, seq: _s, ...src } = t.get(id);
    const { id: _b, seq: _t, ...dup } = t.get(copy);
    expect(dup).toEqual({ ...src, col: 7 });
    // At the east edge: one footprint west.
    const edge = t.place({ col: 19, w: 1 });
    const west = t.run<{ propId: string }>(S.duplicateProp, { propId: edge }).propId;
    expect(t.get(west)).toMatchObject({ col: 18, row: 3 });
    // As wide as the map: the source cell.
    const wide = t.place({ col: 0, w: 20 });
    const same = t.run<{ propId: string }>(S.duplicateProp, { propId: wide }).propId;
    expect(t.get(same)).toMatchObject({ col: 0, w: 20 });
    // Scene cap.
    t.fill(PROPS_PER_SCENE_MAX - sceneProps(t.s.db, t.ambush.id).length, t.ambush.id);
    expect(t.err(() => t.run(S.duplicateProp, { propId: id })).code).toBe("conflict");
  });

  test("FR-SCN-17 delete → PropDeleted with the before row; unknown → not_found", () => {
    const t = setup();
    const id = t.place();
    const before = t.get(id);
    t.run(S.deleteProp, { propId: id });
    expect(t.lastEvent()).toMatchObject({ type: "PropDeleted", payload: { propId: id } });
    expect(t.lastEvent()?.changes).toEqual([{ type: SCENE_PROP_TYPE, id, before, after: null }]);
    expect(t.count("prop")).toBe(0);
    expect(t.err(() => t.run(S.deleteProp, { propId: id })).code).toBe("not_found");
  });

  test("FR-SCN-17 another campaign's prop looks unknown", () => {
    const t = setup();
    const id = t.place();
    const other = { ...t.h.dm, campaignId: t.h.secondCampaignId };
    for (const [name, input] of [
      [S.updateProp, { propId: id, col: 1 }],
      [S.setPropHidden, { propId: id, hidden: true }],
      [S.duplicateProp, { propId: id }],
      [S.deleteProp, { propId: id }],
    ] as const) {
      expect(t.err(() => t.run(name, input, other)).code).toBe("not_found");
    }
  });
});

describe("FR-SCN-35 fogged copies", () => {
  /** Test fog: fogged = every footprint cell has col ≥ 15. */
  const derived: SceneObject[] = [];
  function registerFog() {
    derived.length = 0;
    visibilityHooks.register({
      name: "test.fog",
      derive(_read, obj) {
        derived.push(obj);
        const c = obj.cells as { col: number };
        return { fogged: c.col >= 15 };
      },
      hides: (type, r) => seenByNobody(type, r),
    });
  }

  test("FR-SCN-35 place, move, resize and duplicate derive `fogged` before the write; rotate doesn't", () => {
    const t = setup();
    registerFog();
    t.run(I.activateScene, { sceneId: t.ambush.id });
    const id = t.place({ col: 17, row: 2, w: 2 });
    expect(derived).toEqual([
      { type: SCENE_PROP_TYPE, sceneId: t.ambush.id, cells: { col: 17, row: 2, w: 2, h: 1 } },
    ]);
    expect(t.get(id).fogged).toBe(true);
    // A fogged prop never reaches a player; the DM gets it.
    expect(t.seen(t.p1)).toBeNull();
    expect(t.seen(t.dm)?.op).toBe("upsert");
    t.run(S.updateProp, { propId: id, rotation: 90 });
    expect(derived).toHaveLength(1);
    // Out of fog → players get an upsert; back in → a delete.
    t.run(S.updateProp, { propId: id, col: 3 });
    expect(t.get(id).fogged).toBeUndefined();
    expect(t.seen(t.p1)?.op).toBe("upsert");
    t.run(S.updateProp, { propId: id, col: 16 });
    expect(t.get(id).fogged).toBe(true);
    expect(t.seen(t.p1)?.op).toBe("delete");
    const copy = t.run<{ propId: string }>(S.duplicateProp, { propId: id }).propId;
    expect(t.get(copy)).toMatchObject({ col: 18, fogged: true });
    expect(derived).toHaveLength(4);
  });
});

describe("FR-SCN-19 player frames from the commands' changes", () => {
  test("FR-SCN-19 players: redacted upserts on the active scene; hide → delete; the chest's asset only once revealed; nothing from a non-active scene", () => {
    const t = setup();
    t.run(I.activateScene, { sceneId: t.ambush.id });
    const chest = t.place({ assetId: "prop-chest", col: 17, row: 12, hidden: true });
    expect(t.seen(t.p1)).toBeNull();
    expect(t.seen(t.dm)).toMatchObject({ op: "upsert", data: { assetId: "prop-chest" } });
    t.run(S.updateProp, { propId: chest, locked: true });
    expect(t.seen(t.p1)).toBeNull();
    t.run(S.setPropHidden, { propId: chest, hidden: false });
    const shown = t.seen(t.p1);
    expect(shown).toMatchObject({ op: "upsert", data: { id: chest, assetId: "prop-chest" } });
    expect(JSON.stringify(shown)).not.toContain('"locked"');
    expect(JSON.stringify(shown)).not.toContain(t.h.campaignId);
    t.run(S.setPropHidden, { propId: chest, hidden: true });
    expect(t.seen(t.p1)).toMatchObject({ op: "delete", id: chest });
    expect(JSON.stringify(t.seen(t.p1))).not.toContain("prop-chest");
    t.run(S.deleteProp, { propId: chest });
    // Deleting a hidden prop: players never had it.
    expect(t.seen(t.p1)).toBeNull();
    // Edits on the Cellar (not active) reach no player; the DM gets them (ADR-0041).
    const c = t.place({ sceneId: t.cellar.id });
    expect(t.seen(t.p1)).toBeNull();
    expect(t.seen(t.dm)?.op).toBe("upsert");
    t.run(S.updateProp, { propId: c, col: 9 });
    expect(t.seen(t.p1)).toBeNull();
  });
});

describe("SCN §11 crash", () => {
  test("SCN §13 crash scn.placeProp: before commit → digest unchanged; after commit → row + log", () => {
    class Killed extends Error {}
    const kill = () => {
      throw new Killed();
    };
    const t = setup();
    const log = readEventLog(t.s.db).length;
    const digest = stateDigest(t.s.db.$client).sha256;
    armCrashHook({ point: "before-commit", target: S.placeProp }, kill);
    expect(() => t.place()).toThrow();
    expect(stateDigest(t.s.db.$client).sha256).toBe(digest);
    expect(t.count("prop")).toBe(0);
    armCrashHook({ point: "after-commit", target: S.placeProp }, kill);
    expect(() => t.place()).toThrow(Killed);
    armCrashHook(null);
    expect(t.count("prop")).toBe(1);
    expect(
      readEventLog(t.s.db)
        .slice(log)
        .map((l) => l.type),
    ).toEqual(["PropPlaced"]);
    // Every prop command: a kill before commit changes nothing.
    const [p] = sceneProps(t.s.db, t.ambush.id);
    const id = p?.id as string;
    const after = stateDigest(t.s.db.$client).sha256;
    for (const [target, fn] of [
      [S.updateProp, () => t.run(S.updateProp, { propId: id, col: 9 })],
      [S.setPropHidden, () => t.run(S.setPropHidden, { propId: id, hidden: true })],
      [S.duplicateProp, () => t.run(S.duplicateProp, { propId: id })],
      [S.deleteProp, () => t.run(S.deleteProp, { propId: id })],
    ] as const) {
      armCrashHook({ point: "before-commit", target }, kill);
      expect(fn).toThrow();
      expect(stateDigest(t.s.db.$client).sha256).toBe(after);
    }
  });
});
