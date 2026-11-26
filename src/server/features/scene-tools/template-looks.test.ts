// Template looks (SCN FR-SCN-64, -65, -73; #466): the look, tint and cell opacity of a kept
// template ride `scn.placeTemplate` / `scn.updateTemplate` (null clears), keep the template's
// permissions, reach players with the row, and ride the `scn.template` signal (not its `end`).
import { describe, expect, test } from "bun:test";
import {
  AOE_TEMPLATE_TYPE,
  cellOpacityOf,
  PlaceTemplateInput,
  SCN_INTENTS as S,
  TemplateSignalData,
  UpdateTemplateInput,
} from "@shared/scene-tools/schemas";
import { MAP_INTENTS as I } from "@shared/scenes-map/schemas";
import { readTemplate } from "./rows";
import { scnSetup } from "./testing";

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
  const update = (input: Record<string, unknown>, actor = t.h.dm) =>
    t.run(S.updateTemplate, input, actor);
  const tpl = (id: string) => readTemplate(t.s.db, id);
  const seen = (v: ReturnType<typeof t.h.viewer>, id: string) =>
    ((t.h.snapshot(v)[AOE_TEMPLATE_TYPE] ?? []) as Record<string, unknown>[]).find(
      (r) => r.id === id,
    );
  return { ...t, p1, p2, place, update, tpl, seen };
}

describe("FR-SCN-64 fields", () => {
  test("FR-SCN-64 zod: seven looks, #rrggbb lower-cased, opacity 0–50 in steps of 5", () => {
    const base = sphere("s1");
    const ok = PlaceTemplateInput.parse({
      ...base,
      look: "mist",
      tint: "#7D8590",
      cellOpacity: 10,
    });
    expect(ok.tint).toBe("#7d8590");
    for (const look of ["mist", "motes", "ground", "glow", "ripple", "swirl", "hatch"]) {
      expect(PlaceTemplateInput.safeParse({ ...base, look }).success).toBe(true);
    }
    for (const bad of [
      { look: "flames" },
      { tint: "grey" },
      { tint: "#abc" },
      { cellOpacity: 3 },
      { cellOpacity: 55 },
      { cellOpacity: 12 },
      { cellOpacity: -5 },
    ]) {
      expect(PlaceTemplateInput.safeParse({ ...base, ...bad }).success).toBe(false);
    }
    expect(PlaceTemplateInput.safeParse({ ...base, cellOpacity: 0 }).success).toBe(true);
    expect(PlaceTemplateInput.safeParse({ ...base, cellOpacity: 50 }).success).toBe(true);
    expect(
      UpdateTemplateInput.parse({ templateId: "t", look: null, tint: null, cellOpacity: null }),
    ).toEqual({ templateId: "t", look: null, tint: null, cellOpacity: null });
  });

  test("FR-SCN-64 old rows: no look fields → none on the record, default 22 % (10 % with a look)", () => {
    const t = setup();
    const id = t.place(sphere(t.ambush.id));
    const rec = t.tpl(id);
    expect(rec).not.toHaveProperty("look");
    expect(rec).not.toHaveProperty("tint");
    expect(rec).not.toHaveProperty("cellOpacity");
    expect(cellOpacityOf(rec ?? {})).toBe(0.22);
    expect(cellOpacityOf({ look: "mist" })).toBe(0.1);
    expect(cellOpacityOf({ look: "mist", cellOpacity: 0 })).toBe(0);
    expect(cellOpacityOf({ cellOpacity: 40 })).toBe(0.4);
  });
});

describe("FR-SCN-65 place / update / signal", () => {
  test("FR-SCN-65 placed with a look; other players receive the fields with the row (a player template is never fog-hidden)", () => {
    const t = setup();
    const id = t.place(
      sphere(t.ambush.id, { look: "mist", tint: "#7D8590", cellOpacity: 10 }),
      t.p1,
    );
    expect(t.tpl(id)).toMatchObject({ look: "mist", tint: "#7d8590", cellOpacity: 10 });
    expect(t.seen(t.h.viewer("player", t.h.p2.id), id)).toMatchObject({
      look: "mist",
      tint: "#7d8590",
      cellOpacity: 10,
    });
  });

  test("FR-SCN-65 update sets, keeps when absent, clears with null; a no-op emits nothing", () => {
    const t = setup();
    const id = t.place(sphere(t.ambush.id, { look: "mist", tint: "#7d8590", cellOpacity: 10 }));
    t.update({ templateId: id, cellOpacity: 30 });
    expect(t.tpl(id)).toMatchObject({ look: "mist", tint: "#7d8590", cellOpacity: 30 });
    t.update({ templateId: id, tint: "#4a8a3a", look: "ground" });
    expect(t.tpl(id)).toMatchObject({ look: "ground", tint: "#4a8a3a", cellOpacity: 30 });
    const before = t.events.length;
    t.update({ templateId: id, look: "ground" });
    expect(t.events.length).toBe(before);
    t.update({ templateId: id, look: null, tint: null, cellOpacity: null });
    const rec = t.tpl(id);
    expect(rec).not.toHaveProperty("look");
    expect(rec).not.toHaveProperty("tint");
    expect(rec).not.toHaveProperty("cellOpacity");
  });

  test("FR-SCN-65 a player sets a look on their own template, not on another's; bad value → invalid", () => {
    const t = setup();
    const own = t.place(sphere(t.ambush.id, { look: "ripple" }), t.p1);
    expect(t.tpl(own)).toMatchObject({ look: "ripple", placedByPlayerId: t.h.p1.id });
    t.update({ templateId: own, cellOpacity: 20, tint: "#8fb3d9" }, t.p1);
    expect(t.tpl(own)).toMatchObject({ cellOpacity: 20, tint: "#8fb3d9" });
    expect(t.err(() => t.update({ templateId: own, look: "swirl" }, t.p2)).code).toBe("forbidden");
    expect(t.err(() => t.update({ templateId: own, look: "flames" }, t.p1)).code).toBe("invalid");
    expect(t.err(() => t.place(sphere(t.ambush.id, { cellOpacity: 7 }), t.p1)).code).toBe(
      "invalid",
    );
  });

  test("FR-SCN-73 the signal carries the look fields; an end frame carries none", () => {
    const frame = {
      sceneId: "s1",
      key: "k1",
      shape: "sphere",
      x: 3,
      y: 8,
      size: 20,
      angle: 0,
      look: "mist",
      tint: "#9AA3AD",
      cellOpacity: 15,
    };
    const parsed = TemplateSignalData.parse(frame);
    expect(parsed).toMatchObject({ look: "mist", tint: "#9aa3ad", cellOpacity: 15 });
    expect(TemplateSignalData.safeParse({ sceneId: "s1", key: "k1", end: true }).success).toBe(
      true,
    );
    expect(
      TemplateSignalData.safeParse({ sceneId: "s1", key: "k1", end: true, look: "mist" }).success,
    ).toBe(false);
  });
});
