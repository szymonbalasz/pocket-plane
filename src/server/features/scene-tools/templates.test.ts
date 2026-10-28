// AoE templates (SCN FR-SCN-20–27, -35; §9, §11, §13): kept-template commands (rows + log + one
// event, IDs from ctx, caps, who may edit, player-only refusals, rollback / crash) and the
// `scn.template` audience (FR-SCN-24, ADR-0033), incl. the fog seam (FR-FOG-15). Fog's real line
// is lifted out per case so only the test fog acts (fog's own tests cover its line).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { seenByNobody } from "@shared/fog-of-war/visibility";
import { templateCells } from "@shared/scene-tools/geometry";
import {
  AOE_TEMPLATE_TYPE,
  type AoeTemplateRecord,
  PlayerAoeTemplateRecord,
  SCN_INTENTS as S,
  TEMPLATES_PER_SCENE_MAX,
  type TemplateSignalData,
} from "@shared/scene-tools/schemas";
import { MAP_INTENTS as I } from "@shared/scenes-map/schemas";
import { seededContext } from "../../commands/context";
import { armCrashHook } from "../../commands/crash";
import { stateDigest } from "../../db/digest";
import { readEventLog } from "../../events/log";
import type { SignalSender } from "../../ws/signals";
import { fogVisibilityHook } from "../fog-of-war/hooks";
import { type SceneObject, visibilityHooks } from "../scenes-map/visibility-hooks";
import { readTemplate } from "./rows";
import { templateAudience } from "./templates";
import { scnSetup } from "./testing";

beforeEach(() => {
  visibilityHooks.unregister(fogVisibilityHook.name);
});

afterEach(() => {
  visibilityHooks.unregister("test.fog");
  visibilityHooks.register(fogVisibilityHook);
  armCrashHook(null);
});

const sphere = (sceneId: string, extra: Record<string, unknown> = {}) => ({
  sceneId,
  shape: "sphere",
  x: 3,
  y: 8,
  size: 15,
  angle: 0,
  ...extra,
});

function setup() {
  const t = scnSetup();
  t.run(I.activateScene, { sceneId: t.ambush.id });
  const p1 = t.player(t.h.p1);
  const p2 = t.player(t.h.p2);
  const place = (input: Record<string, unknown>, actor = t.h.dm) =>
    t.run<{ templateId: string }>(S.placeTemplate, input, actor).templateId;
  const tpl = (id: string) => readTemplate(t.s.db, id);
  const ids = (v: ReturnType<typeof t.h.viewer>) =>
    ((t.h.snapshot(v)[AOE_TEMPLATE_TYPE] ?? []) as { id: string }[]).map((r) => r.id);
  return { ...t, p1, p2, place, tpl, ids };
}

/** Test fog: every cell with col ≥ 15 is fogged; `hides` = FOG's pure rule (opt-in). */
const derived: SceneObject[] = [];
const players: string[] = [];
function registerFog(withHides: boolean) {
  derived.length = 0;
  visibilityHooks.register({
    name: "test.fog",
    derive(_read, obj) {
      derived.push(obj);
      const cells = obj.cells as readonly (readonly [number, number])[];
      const fogged = cells.length > 0 && cells.every(([c]) => c >= 15);
      // ADR-0042: with `hides`, the test fog also writes per-player `seenBy` (nobody when fogged).
      return withHides ? { fogged, seenBy: fogged ? [] : [...players] } : { fogged };
    },
    ...(withHides ? { hides: (type: string, r: object) => seenByNobody(type, r) } : {}),
  });
}

describe("FR-SCN-25 Keep: scn.placeTemplate", () => {
  test("FR-SCN-25 DM places: one row + one log entry + TemplatePlaced; ID and time from ctx", () => {
    const t = setup();
    const log = t.logTypes().length;
    const events = t.events.length;
    const r = t.run<{ templateId: string }>(
      S.placeTemplate,
      sphere(t.ambush.id, { label: "Fireball", hidden: true }),
      t.h.dm,
      "tpl-key",
    );
    expect(r.templateId).toBe(seededContext({ disposable: true, key: "tpl-key" }).ids.next());
    expect(t.tpl(r.templateId)).toEqual({
      id: r.templateId,
      campaignId: t.h.campaignId,
      sceneId: t.ambush.id,
      shape: "sphere",
      x: 3,
      y: 8,
      size: 15,
      width: null,
      angle: 0,
      label: "Fireball",
      placedByPlayerId: null,
      hidden: true,
      seenBy: null, // fog's line is lifted here (no per-player copies)
    });
    expect(t.logTypes().slice(log)).toEqual(["TemplatePlaced"]);
    const e = t.events.slice(events);
    expect(e).toHaveLength(1);
    expect(e[0]?.event).toMatchObject({
      type: "TemplatePlaced",
      payload: { templateId: r.templateId },
      changes: [{ type: AOE_TEMPLATE_TYPE, id: r.templateId, before: null }],
    });
    const row = t.s.db.$client
      .query<{ created_at: string }, [string]>("SELECT created_at FROM aoe_template WHERE id = ?")
      .get(r.templateId);
    expect(row?.created_at).toBe(seededContext({ disposable: true, key: "x" }).clock.iso());
  });

  test("FR-SCN-20 width: lines store it (default 5 ft), other shapes null", () => {
    const t = setup();
    const line = t.place({ ...sphere(t.ambush.id), shape: "line", size: 30, angle: 90 });
    const wide = t.place({ ...sphere(t.ambush.id), shape: "line", width: 10, angle: 45 });
    const cone = t.place({ ...sphere(t.ambush.id), shape: "cone", width: 10, angle: 15 });
    expect(t.tpl(line)?.width).toBe(5);
    expect(t.tpl(wide)?.width).toBe(10);
    expect(t.tpl(cone)?.width).toBeNull();
    // FR-SCN-20 ranges come from the schema.
    for (const bad of [
      { size: 0 },
      { size: 7 },
      { size: 305 },
      { angle: 12.25 },
      { angle: 360 },
      { x: 3.375 },
      { width: 65 },
    ]) {
      expect(t.err(() => t.place({ ...sphere(t.ambush.id), ...bad })).code).toBe("invalid");
    }
  });

  test("FR-SCN-25 player places on the active scene as themselves; hidden / placedByPlayerId → invalid; other scene → invalid", () => {
    const t = setup();
    const id = t.place(sphere(t.ambush.id, { label: "Fireball" }), t.p1);
    expect(t.tpl(id)).toMatchObject({ placedByPlayerId: t.h.p1.id, hidden: false });
    for (const extra of [{ hidden: false }, { placedByPlayerId: t.h.p1.id }]) {
      const e = t.err(() => t.place(sphere(t.ambush.id, extra), t.p1));
      expect(e.code).toBe("invalid");
      expect(e.issues?.[0]?.path).toEqual([Object.keys(extra)[0] as string]);
    }
    expect(t.err(() => t.place(sphere(t.cellar.id), t.p1)).code).toBe("invalid");
    expect(t.err(() => t.place(sphere("no-such-scene"), t.p1)).code).toBe("invalid");
    // The DM places on any scene of the campaign; another campaign's looks unknown.
    expect(t.tpl(t.place(sphere(t.cellar.id)))?.sceneId).toBe(t.cellar.id);
    expect(t.err(() => t.place(sphere("no-such-scene"))).code).toBe("not_found");
  });

  test("FR-SCN-25 DM placedByPlayerId (fixtures): a player of the campaign, else invalid", () => {
    const t = setup();
    const id = t.place(sphere(t.ambush.id, { placedByPlayerId: t.h.p2.id }));
    expect(t.tpl(id)?.placedByPlayerId).toBe(t.h.p2.id);
    const e = t.err(() => t.place(sphere(t.ambush.id, { placedByPlayerId: t.h.p3.id })));
    expect(e.code).toBe("invalid");
    expect(e.issues?.[0]?.path).toEqual(["placedByPlayerId"]);
  });

  test("FR-SCN-25 caps: ≤ 3 per player per scene, ≤ 20 per scene → conflict, nothing written", () => {
    const t = setup();
    // prep's Spirit Guardians is not on Ambush here: scnSetup writes no rows by itself.
    for (let i = 0; i < 3; i++) t.place(sphere(t.ambush.id), t.p1);
    const before = t.count("aoe_template");
    expect(t.err(() => t.place(sphere(t.ambush.id), t.p1)).code).toBe("conflict");
    // The DM setting player-1 as placer counts against the same cap.
    expect(t.err(() => t.place(sphere(t.ambush.id, { placedByPlayerId: t.h.p1.id }))).code).toBe(
      "conflict",
    );
    expect(t.count("aoe_template")).toBe(before);
    // Another scene is a fresh count for the player (the DM places there).
    t.place(sphere(t.cellar.id, { placedByPlayerId: t.h.p1.id }));
    for (let i = 3; i < TEMPLATES_PER_SCENE_MAX; i++) t.place(sphere(t.ambush.id));
    expect(t.err(() => t.place(sphere(t.ambush.id))).code).toBe("conflict");
    expect(t.err(() => t.place(sphere(t.ambush.id), t.p2)).code).toBe("conflict");
  });

  test("FR-SCN-35 fogged is derived over the uncut cells before the write", () => {
    const t = setup();
    registerFog(false);
    const geo = { shape: "sphere" as const, x: 20, y: 0, size: 15, angle: 0 };
    const id = t.place({ ...geo, sceneId: t.ambush.id });
    expect(t.tpl(id)?.fogged).toBe(true);
    expect(derived.at(-1)).toEqual({
      type: AOE_TEMPLATE_TYPE,
      sceneId: t.ambush.id,
      cells: templateCells(geo, t.ambush, { cut: false }),
      placedByPlayerId: null,
    });
    expect(t.tpl(t.place(sphere(t.ambush.id)))?.fogged).toBeUndefined();
    // Moving it out of fog re-derives.
    t.run(S.updateTemplate, { templateId: id, x: 3 });
    expect(t.tpl(id)?.fogged).toBeUndefined();
  });
});

describe("FR-SCN-26 persistent edits", () => {
  test("FR-SCN-26 the placer moves, rotates, resizes, relabels and deletes their own; others → forbidden", () => {
    const t = setup();
    const id = t.place({ ...sphere(t.ambush.id), shape: "line", size: 30 }, t.p1);
    const log = t.logTypes().length;
    t.run(S.updateTemplate, { templateId: id, x: 4, y: 9, angle: 30, size: 60, width: 10 }, t.p1);
    t.run(S.updateTemplate, { templateId: id, label: "Lightning Bolt" }, t.p1);
    expect(t.tpl(id)).toMatchObject({
      x: 4,
      y: 9,
      angle: 30,
      size: 60,
      width: 10,
      label: "Lightning Bolt",
    });
    expect(t.logTypes().slice(log)).toEqual(["TemplateUpdated", "TemplateUpdated"]);
    expect(t.err(() => t.run(S.updateTemplate, { templateId: id, x: 1 }, t.p2)).code).toBe(
      "forbidden",
    );
    expect(t.err(() => t.run(S.deleteTemplate, { templateId: id }, t.p2)).code).toBe("forbidden");
    // `hidden` is DM only.
    expect(t.err(() => t.run(S.updateTemplate, { templateId: id, hidden: true }, t.p1)).code).toBe(
      "invalid",
    );
    t.run(S.deleteTemplate, { templateId: id }, t.p1);
    expect(t.tpl(id)).toBeNull();
    expect(t.logTypes().slice(log)).toEqual([
      "TemplateUpdated",
      "TemplateUpdated",
      "TemplateDeleted",
    ]);
  });

  test("FR-SCN-26 players: hidden, other-scene and unknown templates → not_found; a DM template → forbidden", () => {
    const t = setup();
    const glyph = t.place(sphere(t.ambush.id, { hidden: true, label: "Glyph" }));
    const cellar = t.place(sphere(t.cellar.id, { placedByPlayerId: t.h.p1.id }));
    const dmOpen = t.place(sphere(t.ambush.id));
    for (const templateId of [glyph, cellar, "no-such-template"]) {
      expect(t.err(() => t.run(S.updateTemplate, { templateId, x: 1 }, t.p1)).code).toBe(
        "not_found",
      );
      expect(t.err(() => t.run(S.deleteTemplate, { templateId }, t.p1)).code).toBe("not_found");
    }
    expect(t.err(() => t.run(S.deleteTemplate, { templateId: dmOpen }, t.p1)).code).toBe(
      "forbidden",
    );
    // Another campaign's DM sees this one's templates as unknown.
    expect(t.err(() => t.run(S.deleteTemplate, { templateId: dmOpen }, t.h.dmSecond)).code).toBe(
      "not_found",
    );
  });

  test("FR-SCN-26 the DM edits any template, hides / reveals; unchanged → no event", () => {
    const t = setup();
    const mine = t.place(sphere(t.ambush.id), t.p1);
    const events = t.events.length;
    t.run(S.updateTemplate, { templateId: mine, hidden: true });
    expect(t.tpl(mine)?.hidden).toBe(true);
    expect(t.ids(t.h.viewer("player", t.h.p1.id))).toEqual([]);
    t.run(S.updateTemplate, { templateId: mine, hidden: false, size: 20 });
    expect(t.tpl(mine)).toMatchObject({ hidden: false, size: 20 });
    t.run(S.updateTemplate, { templateId: mine, size: 20, x: 3 });
    expect(t.events.slice(events).map((e) => e.event.type)).toEqual([
      "TemplateUpdated",
      "TemplateUpdated",
    ]);
    // Hide → players get a delete; reveal → an upsert (FR-SYNC-19).
    const [hide, reveal] = t.events.slice(events).map((e) => e.event.changes?.[0]);
    const p2 = t.h.viewer("player", t.h.p2.id);
    expect(hide && t.s.records.filterChange(hide, p2)?.op).toBe("delete");
    expect(reveal && t.s.records.filterChange(reveal, p2)).toMatchObject({
      op: "upsert",
      data: { placedByPlayerId: t.h.p1.id },
    });
    t.run(S.deleteTemplate, { templateId: mine });
    expect(t.tpl(mine)).toBeNull();
  });

  test("FR-SCN-44 Clear templates scope: DM-placed only unless players; none → no event", () => {
    const t = setup();
    const mine = t.place(sphere(t.ambush.id), t.p1);
    const glyph = t.place(sphere(t.ambush.id, { hidden: true }));
    const web = t.place(sphere(t.ambush.id, { x: 0.5, y: 6.25, angle: 37.5 }));
    const cellar = t.place(sphere(t.cellar.id));
    for (const input of [{ sceneId: t.ambush.id }, { sceneId: t.ambush.id, players: true }]) {
      expect(t.err(() => t.run(S.clearTemplates, input, t.p1)).code).toBe("forbidden");
    }
    const events = t.events.length;
    const log = t.logTypes().length;
    t.run(S.clearTemplates, { sceneId: t.ambush.id });
    expect([t.tpl(mine)?.id, t.tpl(glyph), t.tpl(web), t.tpl(cellar)?.id]).toEqual([
      mine,
      null,
      null,
      cellar,
    ]);
    let e = t.events.slice(events);
    expect(e.map((x) => x.event.type)).toEqual(["TemplatesCleared"]);
    expect(t.logTypes().slice(log)).toEqual(["TemplatesCleared"]);
    expect(e[0]?.event.payload).toEqual({
      sceneId: t.ambush.id,
      templateIds: [glyph, web],
      players: false,
    });
    // Players get a delete for the visible one only (Glyph was never theirs), and none for
    // their own template, which stays.
    for (const pid of [t.h.p1.id, t.h.p2.id]) {
      const v = t.h.viewer("player", pid);
      expect(
        (e[0]?.event.changes ?? []).map((ch) => t.s.records.filterChange(ch, v)?.op ?? null),
      ).toEqual([null, "delete"]);
      expect(t.ids(v)).toEqual([mine]);
    }
    // Nothing DM-placed left → no write, no event.
    t.run(S.clearTemplates, { sceneId: t.ambush.id, players: false });
    expect(t.events.length).toBe(events + 1);
    t.run(S.clearTemplates, { sceneId: t.ambush.id, players: true });
    e = t.events.slice(events + 1);
    expect(e[0]?.event.payload).toEqual({
      sceneId: t.ambush.id,
      templateIds: [mine],
      players: true,
    });
    expect(t.tpl(mine)).toBeNull();
    expect(t.tpl(cellar)?.id).toBe(cellar);
    t.run(S.clearTemplates, { sceneId: t.ambush.id, players: true });
    expect(t.events.length).toBe(events + 2);
    expect(t.err(() => t.run(S.clearTemplates, { sceneId: "no-such-scene" })).code).toBe(
      "not_found",
    );
  });
});

describe("FR-SCN-27 visibility of kept templates", () => {
  test("FR-SCN-27 DM full; players every field but campaignId (incl. placedByPlayerId) unless hidden; other scenes none", () => {
    const t = setup();
    const mine = t.place(sphere(t.ambush.id, { label: "Fireball" }), t.p1);
    const glyph = t.place(sphere(t.ambush.id, { hidden: true, label: "Glyph" }));
    const cellar = t.place(sphere(t.cellar.id, { label: "Cellar trap" }));
    expect(t.ids(t.h.viewer("dm"))).toEqual([mine, glyph]);
    for (const p of [t.h.p1, t.h.p2]) {
      const snap = t.h.snapshot(t.h.viewer("player", p.id));
      const { campaignId: _cid, seenBy: _s, ...wire } = t.tpl(mine) as AoeTemplateRecord;
      expect(snap[AOE_TEMPLATE_TYPE]).toEqual([wire]);
      expect(PlayerAoeTemplateRecord.strict().safeParse(wire).success).toBe(true);
      const frame = JSON.stringify(snap);
      for (const leak of ["Glyph", glyph, cellar, "Cellar trap"]) {
        expect(frame).not.toContain(leak);
      }
    }
  });
});

describe("SCN §11 crash: one transaction per command", () => {
  test("SCN §11 scn.placeTemplate: kill before commit → digest unchanged; after commit → row, log there", () => {
    class Killed extends Error {}
    const kill = () => {
      throw new Killed();
    };
    const t = setup();
    const digest = stateDigest(t.s.db.$client).sha256;
    const log = readEventLog(t.s.db).length;
    armCrashHook({ point: "before-commit", target: S.placeTemplate }, kill);
    expect(() => t.place(sphere(t.ambush.id))).toThrow();
    expect(stateDigest(t.s.db.$client).sha256).toBe(digest);
    armCrashHook({ point: "after-commit", target: S.placeTemplate }, kill);
    expect(() => t.place(sphere(t.ambush.id, { label: "Kept" }))).toThrow(Killed);
    armCrashHook(null);
    expect(t.count("aoe_template")).toBe(1);
    expect(
      readEventLog(t.s.db)
        .slice(log)
        .map((l) => l.type),
    ).toEqual(["TemplatePlaced"]);
  });

  test("FR-SCN-44 crash scn.clearTemplates: kill before commit → digest unchanged; after commit → the committed state", () => {
    class Killed extends Error {}
    const kill = () => {
      throw new Killed();
    };
    const t = setup();
    const mine = t.place(sphere(t.ambush.id, { x: 3.37, y: 7.64 }), t.p1);
    t.place(sphere(t.ambush.id, { x: 12.5, y: 0.25, angle: 37.5, hidden: true }));
    const digest = stateDigest(t.s.db.$client).sha256;
    const log = readEventLog(t.s.db).length;
    armCrashHook({ point: "before-commit", target: S.clearTemplates }, kill);
    expect(() => t.run(S.clearTemplates, { sceneId: t.ambush.id })).toThrow();
    expect(stateDigest(t.s.db.$client).sha256).toBe(digest);
    armCrashHook({ point: "after-commit", target: S.clearTemplates }, kill);
    expect(() => t.run(S.clearTemplates, { sceneId: t.ambush.id })).toThrow(Killed);
    armCrashHook(null);
    expect(t.tpl(mine)).toMatchObject({ x: 3.37, y: 7.64 });
    expect(t.count("aoe_template")).toBe(1);
    expect(
      readEventLog(t.s.db)
        .slice(log)
        .map((l) => l.type),
    ).toEqual(["TemplatesCleared"]);
  });
});

describe("FR-SCN-24 scn.template audience", () => {
  function audience() {
    const t = setup();
    const read = { db: t.s.db, activeSceneOf: (c: string) => t.s.records.activeSceneOf(c) };
    const dm: SignalSender = { role: "dm", campaignId: t.h.campaignId };
    const p1: SignalSender = { role: "player", playerId: t.h.p1.id, campaignId: t.h.campaignId };
    const route = (data: Record<string, unknown>, sender: SignalSender) => {
      try {
        return templateAudience(data as TemplateSignalData, sender, read);
      } catch (e) {
        return (e as { code: string }).code;
      }
    };
    const place = (sceneId: string, extra: Record<string, unknown> = {}) => ({
      ...sphere(sceneId),
      key: "k1",
      ...extra,
    });
    const end = (sceneId: string) => ({ sceneId, key: "k1", end: true });
    return { ...t, read, dm, p1, route, place, end };
  }

  test("FR-SCN-24 player: active scene → all; other scene → invalid; dmOnly → invalid", () => {
    const t = audience();
    expect(t.route(t.place(t.ambush.id), t.p1)).toBe("all");
    expect(t.route(t.end(t.ambush.id), t.p1)).toBe("all");
    expect(t.route(t.place(t.cellar.id), t.p1)).toBe("invalid");
    expect(t.route(t.end(t.cellar.id), t.p1)).toBe("invalid");
    expect(t.route(t.place(t.ambush.id, { dmOnly: true }), t.p1)).toBe("invalid");
    expect(t.route(t.place(t.ambush.id, { dmOnly: false }), t.p1)).toBe("invalid");
  });

  test("FR-SCN-24 DM: dmOnly or non-active → dm; else all; end → all on the active scene, dm elsewhere; unknown scene → not_found", () => {
    const t = audience();
    expect(t.route(t.place(t.ambush.id), t.dm)).toBe("all");
    expect(t.route(t.place(t.ambush.id, { dmOnly: true }), t.dm)).toBe("dm");
    expect(t.route(t.place(t.cellar.id), t.dm)).toBe("dm");
    expect(t.route(t.end(t.ambush.id), t.dm)).toBe("all");
    expect(t.route(t.end(t.cellar.id), t.dm)).toBe("dm");
    expect(t.route(t.place("no-such-scene"), t.dm)).toBe("not_found");
    const other: SignalSender = { role: "dm", campaignId: t.h.secondCampaignId };
    expect(t.route(t.place(t.ambush.id), other)).toBe("not_found");
  });

  test("FR-SCN-24 / FR-FOG-15 fog: a DM template wholly in fog → dm only once a hides hook hides it; partly fogged → all; player → all", () => {
    const t = audience();
    const inFog = t.place(t.ambush.id, { x: 18, y: 5, size: 10 });
    const partly = t.place(t.ambush.id, { x: 15, y: 5, size: 10 });
    // derive without `seenBy` (no per-player copies): neutral for players.
    registerFog(false);
    expect(t.route(inFog, t.dm)).toBe("all");
    visibilityHooks.unregister("test.fog");
    players.splice(0, players.length, t.h.p1.id, t.h.p2.id);
    registerFog(true);
    expect(t.route(inFog, t.dm)).toBe("dm");
    expect(derived.at(-1)).toEqual({
      type: AOE_TEMPLATE_TYPE,
      sceneId: t.ambush.id,
      cells: templateCells({ shape: "sphere", x: 18, y: 5, size: 10, angle: 0 }, t.ambush, {
        cut: false,
      }),
      placedByPlayerId: null,
    });
    // ADR-0042 (FR-FOG-15): the players who would see it.
    expect(t.route(partly, t.dm)).toEqual({ players: [t.h.p1.id, t.h.p2.id] });
    expect(t.route(inFog, t.p1)).toBe("all");
    expect(t.route(t.end(t.ambush.id), t.dm)).toBe("all");
  });

  test("FR-SCN-46 DM audience over the new uncut cells: a freeform cube reaching out of fog → its seers; a 5-ft cone covering no cell samples its origin's cell", () => {
    const t = audience();
    players.splice(0, players.length, t.h.p1.id, t.h.p2.id);
    registerFog(true);
    // Sprint 2's centre cells of this cube were all at col ≥ 15 (fogged); > 50 % reaches col 14.
    const cube = { shape: "cube", x: 15, y: 5, size: 10, angle: 45 };
    expect(t.route(t.place(t.ambush.id, cube), t.dm)).toEqual({ players: [t.h.p1.id, t.h.p2.id] });
    expect(t.route(t.place(t.ambush.id, { ...cube, x: 16.25, y: 5.5, angle: 0.5 }), t.dm)).toBe(
      "dm",
    );
    const cone = { shape: "cone", size: 5, angle: 37.5 };
    expect(t.route(t.place(t.ambush.id, { ...cone, x: 15.37, y: 3.64 }), t.dm)).toBe("dm");
    expect(derived.at(-1)?.cells).toEqual([[15, 3]]);
    expect(t.route(t.place(t.ambush.id, { ...cone, x: 14.37, y: 3.64 }), t.dm)).toEqual({
      players: [t.h.p1.id, t.h.p2.id],
    });
  });

  test("FR-SCN-23 signals are never persisted: no row, log or event", () => {
    const t = audience();
    const digest = stateDigest(t.s.db.$client).sha256;
    t.route(t.place(t.ambush.id), t.dm);
    t.route(t.place(t.ambush.id), t.p1);
    expect(stateDigest(t.s.db.$client).sha256).toBe(digest);
  });
});

describe("FR-SCN-41 #377 snapped sphere footprint", () => {
  test("FR-SCN-41 #377 footprint: stored and sent to players when set, absent otherwise; must fit a sphere / cylinder's origin", () => {
    const t = setup();
    const snapped = t.place(sphere(t.ambush.id, { x: 3.5, y: 8.5, footprint: 1 }), t.p1);
    const large = t.place(sphere(t.ambush.id, { shape: "cylinder", x: 5, y: 10, footprint: 2 }));
    const free = t.place(sphere(t.ambush.id, { x: 3.37, y: 8.5 }));
    expect(t.tpl(snapped)?.footprint).toBe(1);
    expect(t.tpl(large)?.footprint).toBe(2);
    expect(t.tpl(free)).not.toHaveProperty("footprint");
    const wire = t.h.snapshot(t.h.viewer("player", t.h.p2.id))[AOE_TEMPLATE_TYPE] as object[];
    expect(wire.find((r) => (r as { id: string }).id === snapped)).toMatchObject({ footprint: 1 });
    expect(wire.find((r) => (r as { id: string }).id === free)).not.toHaveProperty("footprint");
    for (const bad of [
      { shape: "cone", x: 3.5, y: 8.5, footprint: 1 },
      { x: 3, y: 8, footprint: 1 },
      { x: 3.5, y: 8.5, footprint: 2 },
      { x: 3.5, y: 8.5, footprint: 5 },
    ]) {
      expect(t.err(() => t.place(sphere(t.ambush.id, bad))).code).toBe("invalid");
    }
  });

  test("FR-SCN-45 #377 updates: a move keeps a fitting footprint, refuses one that no longer fits, `null` clears it", () => {
    const t = setup();
    const id = t.place(sphere(t.ambush.id, { x: 3.5, y: 8.5, footprint: 1 }), t.p1);
    t.run(S.updateTemplate, { templateId: id, x: 6.5 }, t.p1);
    expect(t.tpl(id)).toMatchObject({ x: 6.5, footprint: 1 });
    expect(t.err(() => t.run(S.updateTemplate, { templateId: id, x: 6 }, t.p1)).code).toBe(
      "invalid",
    );
    t.run(S.updateTemplate, { templateId: id, x: 6.37, footprint: null }, t.p1);
    expect(t.tpl(id)).toMatchObject({ x: 6.37 });
    expect(t.tpl(id)).not.toHaveProperty("footprint");
    t.run(S.updateTemplate, { templateId: id, x: 5, y: 9, footprint: 2 }, t.p1);
    expect(t.tpl(id)).toMatchObject({ x: 5, y: 9, footprint: 2 });
    // Only the footprint changing is a change; resending it is not.
    const log = t.logTypes().length;
    t.run(S.updateTemplate, { templateId: id, footprint: 2 }, t.p1);
    expect(t.logTypes()).toHaveLength(log);
  });

  test("FR-SCN-35 #377 fog derives over the footprint's grid-reach cells (server and signal audience use the same rule)", () => {
    const t = setup();
    registerFog(false);
    // 10 ft from the square (16, 8): exact rule → cols 15–17 (all fogged); grid reach → cols 14–18.
    const geo = { shape: "sphere" as const, x: 16.5, y: 8.5, size: 10, angle: 0 };
    expect(t.tpl(t.place({ ...geo, sceneId: t.ambush.id }))?.fogged).toBe(true);
    const id = t.place({ ...geo, footprint: 1, sceneId: t.ambush.id });
    expect(t.tpl(id)?.fogged).toBeUndefined();
    expect(derived.at(-1)?.cells).toEqual(
      templateCells({ ...geo, footprint: 1 }, t.ambush, { cut: false }),
    );
    expect(derived.at(-1)?.cells).toHaveLength(21);
  });
});
