// AoE templates (SCN FR-SCN-20–27, -35; §9, §11, §13): kept-template commands (rows + log + one
// event, IDs from ctx, caps, who may edit, player-only refusals, rollback / crash) and the
// `scn.template` audience (FR-SCN-24, ADR-0033), incl. the fog seam (FR-FOG-15).
import { afterEach, describe, expect, test } from "bun:test";
import { fogHidden } from "@shared/fog-of-war/visibility";
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
import { type SceneObject, visibilityHooks } from "../scenes-map/visibility-hooks";
import { readTemplate } from "./rows";
import { templateAudience } from "./templates";
import { scnSetup } from "./testing";

afterEach(() => {
  visibilityHooks.unregister("test.fog");
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
function registerFog(withHides: boolean) {
  derived.length = 0;
  visibilityHooks.register({
    name: "test.fog",
    derive(_read, obj) {
      derived.push(obj);
      const cells = obj.cells as readonly (readonly [number, number])[];
      return { fogged: cells.length > 0 && cells.every(([c]) => c >= 15) };
    },
    ...(withHides ? { hides: (type: string, r: object) => fogHidden(type, r) } : {}),
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
    for (const bad of [{ size: 0 }, { size: 7 }, { size: 305 }, { angle: 10 }, { width: 65 }]) {
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

  test("FR-SCN-26 Clear templates: DM only; every kept template of the scene; none → no event", () => {
    const t = setup();
    const a = t.place(sphere(t.ambush.id), t.p1);
    const b = t.place(sphere(t.ambush.id, { hidden: true }));
    const c = t.place(sphere(t.cellar.id));
    expect(t.err(() => t.run(S.clearTemplates, { sceneId: t.ambush.id }, t.p1)).code).toBe(
      "forbidden",
    );
    const events = t.events.length;
    t.run(S.clearTemplates, { sceneId: t.ambush.id });
    expect([t.tpl(a), t.tpl(b), t.tpl(c)?.id]).toEqual([null, null, c]);
    const e = t.events.slice(events);
    expect(e.map((x) => x.event.type)).toEqual(["TemplatesCleared"]);
    expect(e[0]?.event.payload).toEqual({ sceneId: t.ambush.id, templateIds: [a, b] });
    // Players get a delete for the visible one only; the hidden one was never theirs.
    const p2 = t.h.viewer("player", t.h.p2.id);
    expect(
      (e[0]?.event.changes ?? []).map((ch) => t.s.records.filterChange(ch, p2)?.op ?? null),
    ).toEqual(["delete", null]);
    t.run(S.clearTemplates, { sceneId: t.ambush.id });
    expect(t.events.length).toBe(events + 1);
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
      const { campaignId: _cid, ...wire } = t.tpl(mine) as AoeTemplateRecord;
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
    // derive alone (fog not hiding anything yet, build/fog-server): neutral for players.
    registerFog(false);
    expect(t.route(inFog, t.dm)).toBe("all");
    expect(derived).toEqual([]);
    visibilityHooks.unregister("test.fog");
    registerFog(true);
    expect(t.route(inFog, t.dm)).toBe("dm");
    expect(derived.at(-1)).toEqual({
      type: AOE_TEMPLATE_TYPE,
      sceneId: t.ambush.id,
      cells: templateCells({ shape: "sphere", x: 18, y: 5, size: 10, angle: 0 }, t.ambush, {
        cut: false,
      }),
    });
    expect(t.route(partly, t.dm)).toBe("all");
    expect(t.route(inFog, t.p1)).toBe("all");
    expect(t.route(t.end(t.ambush.id), t.dm)).toBe("all");
  });

  test("FR-SCN-23 signals are never persisted: no row, log or event", () => {
    const t = audience();
    const digest = stateDigest(t.s.db.$client).sha256;
    t.route(t.place(t.ambush.id), t.dm);
    t.route(t.place(t.ambush.id), t.p1);
    expect(stateDigest(t.s.db.$client).sha256).toBe(digest);
  });
});
