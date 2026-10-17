import { afterEach, describe, expect, test } from "bun:test";
import { templateCells } from "@shared/scene-tools/geometry";
import type { TemplateSignalData } from "@shared/scene-tools/schemas";
import { canvasTools } from "../scenes-map/canvas-tools";
import type { LaserTimers } from "../scenes-map/laser";
import { activeTool, isDrawing, toolsFor } from "../scenes-map/tools";
import { cancelAoe, useAoe } from "./aoe-store";
import {
  aimAngle,
  canEditTemplate,
  createEphemeralStore,
  DEFAULT_AOE,
  EphemeralSender,
  ephemeralsOn,
  gestureTemplate,
  placeFrame,
  pruneEphemerals,
  receiveTemplate,
  resetEphemerals,
  snapSize,
  type TemplateView,
  templateCaption,
  templateOutline,
} from "./templates";

/** Fake clock: `advance` fires due timers in time order. */
function fakeTimers() {
  let t = 0;
  let nextId = 1;
  const due = new Map<number, { at: number; fn: () => void }>();
  const timers: LaserTimers = {
    now: () => t,
    setTimeout(fn, ms) {
      const id = nextId++;
      due.set(id, { at: t + ms, fn });
      return id;
    },
    clearTimeout(h) {
      due.delete(h as number);
    },
  };
  const advance = (ms: number) => {
    const end = t + ms;
    for (;;) {
      const next = [...due.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      due.delete(next[0]);
      t = next[1].at;
      next[1].fn();
    }
    t = end;
  };
  return { timers, advance, pending: () => due.size };
}

const G = { gridCellSize: 70, gridOffsetX: 0, gridOffsetY: 0 };
const MAP = { ...G, mapWidth: 1400, mapHeight: 980 };
/** Map px of vertex (x, y) plus a cell offset. */
const px = (x: number, y: number) => ({ x: x * 70, y: y * 70 });

describe("FR-SCN-22 AoE gesture", () => {
  test("FR-SCN-20 angles snap to 15° (0 = east, 90 = south); sizes to 5 ft in 5–300", () => {
    expect(aimAngle(1, 0, "cone", false)).toBe(0);
    expect(aimAngle(0, 1, "cone", false)).toBe(90);
    expect(aimAngle(-1, 0, "line", false)).toBe(180);
    expect(aimAngle(0, -1, "line", false)).toBe(270);
    expect(aimAngle(1, 0.27, "cone", false)).toBe(15);
    expect(aimAngle(1, -0.01, "cone", false)).toBe(0);
    // A cube aims its diagonal: dragging south-east = 0 (sides east and south).
    expect(aimAngle(1, 1, "cube", false)).toBe(0);
    expect(aimAngle(1, 0.27, "cone", true)).toBe(15.1);
    expect(snapSize(2)).toBe(5);
    expect(snapSize(17)).toBe(15);
    expect(snapSize(999)).toBe(300);
  });

  test("FR-SCN-22 drag sets the direction (cone, line), the diagonal (cube) or the radius (sphere, cylinder)", () => {
    const o = { x: 3, y: 7 };
    const s = { ...DEFAULT_AOE, size: 15, label: "Burning Hands" };
    expect(gestureTemplate({ ...s, shape: "cone" }, o, px(3, 10), G)).toEqual({
      shape: "cone",
      x: 3,
      y: 7,
      size: 15,
      width: null,
      angle: 90,
      label: "Burning Hands",
    });
    expect(gestureTemplate({ ...s, shape: "line", width: 10 }, o, px(6, 4), G)).toMatchObject({
      angle: 315,
      width: 10,
    });
    expect(gestureTemplate({ ...s, shape: "cube" }, o, px(1, 9), G).angle).toBe(90); // SW
    expect(gestureTemplate({ ...s, shape: "cube" }, o, px(5, 5), G).angle).toBe(270); // NE
    expect(gestureTemplate({ ...s, shape: "sphere" }, o, px(7, 7), G)).toMatchObject({
      size: 20,
      angle: 0,
    });
    // Under half a cell: the panel's size and the previous direction.
    const still = { x: 3 * 70 + 20, y: 7 * 70 };
    expect(gestureTemplate({ ...s, shape: "cone" }, o, still, G, 45)).toMatchObject({
      size: 15,
      angle: 45,
    });
    expect(gestureTemplate({ ...s, shape: "cylinder" }, o, still, G).size).toBe(15);
  });

  test("FR-SCN-21 caption: ‹label› · N squares", () => {
    expect(templateCaption("Fireball", 32)).toBe("Fireball · 32 squares");
    expect(templateCaption("", 1)).toBe("1 square");
  });

  test("FR-SCN-20 outline: circle radius = size; cone width at the end = length; line width", () => {
    const sphere = templateOutline({ shape: "sphere", x: 3, y: 8, size: 15, angle: 0 }, G);
    expect(sphere).toEqual({ kind: "circle", x: 210, y: 560, r: 210 });
    const cone = templateOutline({ shape: "cone", x: 0, y: 0, size: 20, angle: 0 }, G);
    expect(cone.kind === "poly" && cone.points.map((v) => Math.round(v))).toEqual([
      0, 0, 280, 140, 280, -140,
    ]);
    const cube = templateOutline({ shape: "cube", x: 12, y: 12, size: 10, angle: 180 }, G);
    expect(cube.kind === "poly" && cube.points).toEqual([840, 840, 700, 840, 700, 700, 840, 700]);
    const line = templateOutline({ shape: "line", x: 0, y: 0, size: 30, width: 10, angle: 90 }, G);
    expect(line.kind === "poly" && line.points.map((v) => Math.round(v) + 0)).toEqual([
      -70, 0, -70, 420, 70, 420, 70, 0,
    ]);
  });

  test("FR-SCN-26 the DM edits any kept template; a player only their own", () => {
    expect(canEditTemplate({ placedByPlayerId: null }, "dm", null)).toBe(true);
    expect(canEditTemplate({ placedByPlayerId: "p1" }, "player", "p1")).toBe(true);
    expect(canEditTemplate({ placedByPlayerId: "p1" }, "player", "p2")).toBe(false);
    expect(canEditTemplate({ placedByPlayerId: null }, "player", "p1")).toBe(false);
  });
});

const T: TemplateView = { shape: "sphere", x: 3, y: 8, size: 20, width: null, angle: 0, label: "" };

describe("FR-SCN-23 ephemeral sender", () => {
  test("FR-SCN-23 ≤ 20 sends/s while dragging, only on change; repeated every 1 s at rest; one end", () => {
    const clock = fakeTimers();
    const sent: TemplateSignalData[] = [];
    const s = new EphemeralSender((d) => sent.push(d), clock.timers);
    s.show(placeFrame("s1", "k", T, false));
    s.show(placeFrame("s1", "k", { ...T, size: 25 }, false));
    s.show(placeFrame("s1", "k", { ...T, size: 30 }, false));
    expect(sent).toHaveLength(1);
    clock.advance(50);
    expect(sent.map((d) => ("size" in d ? d.size : "end"))).toEqual([20, 30]);
    s.show(placeFrame("s1", "k", { ...T, size: 30 }, false));
    clock.advance(50);
    expect(sent).toHaveLength(2);
    clock.advance(1000);
    clock.advance(1000);
    expect(sent).toHaveLength(4);
    expect(s.shown).toBe(true);
    s.end();
    expect(sent.at(-1)).toEqual({ sceneId: "s1", key: "k", end: true });
    s.end();
    clock.advance(5000);
    expect(sent).toHaveLength(5);
    expect(clock.pending()).toBe(0);
  });

  test("FR-SCN-34 stop: no more frames and no end (receivers time out); a scene change ends the old one", () => {
    const clock = fakeTimers();
    const sent: TemplateSignalData[] = [];
    const s = new EphemeralSender((d) => sent.push(d), clock.timers);
    s.show(placeFrame("s1", "k", T, false));
    s.show(placeFrame("s2", "k", T, false));
    expect(sent).toEqual([
      placeFrame("s1", "k", T, false),
      { sceneId: "s1", key: "k", end: true },
      placeFrame("s2", "k", T, false),
    ]);
    s.stop();
    clock.advance(5000);
    expect(sent).toHaveLength(3);
  });

  test("FR-SCN-23 place frame: width for lines only, label and dmOnly only when set", () => {
    expect(placeFrame("s", "k", { ...T, label: "Glyph" }, true)).toEqual({
      sceneId: "s",
      key: "k",
      shape: "sphere",
      x: 3,
      y: 8,
      size: 20,
      angle: 0,
      label: "Glyph",
      dmOnly: true,
    });
    expect(placeFrame("s", "k", { ...T, shape: "line", width: null }, false)).toMatchObject({
      width: 5,
    });
  });
});

describe("FR-SCN-23 ephemeral receivers", () => {
  const p1 = { role: "player" as const, playerId: "p1" };
  const p2 = { role: "player" as const, playerId: "p2" };
  const place = (sceneId: string, key: string, size = 20): TemplateSignalData => ({
    ...placeFrame(sceneId, key, { ...T, size }, false),
  });

  test("FR-SCN-23 one per sender connection; replaced by a new placement; dropped on end", () => {
    const s = createEphemeralStore();
    receiveTemplate(s, p1, place("s1", "a"), 0);
    receiveTemplate(s, p1, place("s1", "a", 30), 10);
    receiveTemplate(s, p2, place("s1", "a"), 10);
    receiveTemplate(s, { role: "dm" }, { ...place("s1", "d"), dmOnly: true }, 10);
    const on = ephemeralsOn(s.getState(), "s1");
    expect(on.map((e) => [e.id, e.template.size, e.role, e.dmOnly])).toEqual([
      ["player:p1:a", 30, "player", false],
      ["player:p2:a", 20, "player", false],
      ["dm:d", 20, "dm", true],
    ]);
    // A player's `end` can't drop another sender's template with the same key.
    receiveTemplate(s, p2, { sceneId: "s1", key: "a", end: true }, 20);
    expect(ephemeralsOn(s.getState(), "s1").map((e) => e.id)).toEqual(["player:p1:a", "dm:d"]);
  });

  test("FR-SCN-23 dropped after 3 s of silence and on a snapshot; drawn only for the shown scene", () => {
    const s = createEphemeralStore();
    receiveTemplate(s, p1, place("s1", "a"), 0);
    receiveTemplate(s, p2, place("s2", "b"), 1000);
    expect(ephemeralsOn(s.getState(), "s1")).toHaveLength(1);
    expect(ephemeralsOn(s.getState(), "s2")).toHaveLength(1);
    expect(pruneEphemerals(s, 2999)).toBe(true);
    expect(Object.keys(s.getState().byId)).toHaveLength(2);
    expect(pruneEphemerals(s, 3000)).toBe(true);
    expect(Object.keys(s.getState().byId)).toEqual(["player:p2:b"]);
    resetEphemerals(s);
    expect(s.getState().byId).toEqual({});
    expect(pruneEphemerals(s, 9000)).toBe(false);
  });

  test("FR-SCN-21 the receivers' squares match the shared templateCells", () => {
    const s = createEphemeralStore();
    receiveTemplate(s, p1, place("s1", "a", 15), 0);
    const [e] = ephemeralsOn(s.getState(), "s1");
    expect(e && templateCells(e.template, MAP, { cut: true })).toHaveLength(
      templateCells({ shape: "sphere", x: 3, y: 8, size: 15, angle: 0 }, MAP, { cut: true }).length,
    );
  });
});

describe("FR-SCN-06 / -22 AoE tool registration and Esc", () => {
  afterEach(() => useAoe.setState({ own: null, gesture: null, selectedId: null }));

  test("FR-SCN-06 the AoE tool is a drawing tool on both clients", () => {
    for (const c of ["dm", "player"] as const) {
      expect(toolsFor(canvasTools, c).map((t) => t.id)).toContain("aoe");
      expect(isDrawing(activeTool(canvasTools, "aoe", c))).toBe(true);
    }
  });

  test("FR-SCN-22 Esc drops a gesture, then the ephemeral, then the selection; else falls through", () => {
    useAoe.setState({
      gesture: { kind: "move", id: "t1", press: { x: 1, y: 1 }, at: { x: 2, y: 2 } },
      own: { sceneId: "s1", template: T },
      selectedId: "t1",
    });
    expect(cancelAoe("escape")).toBe(true);
    expect(useAoe.getState()).toMatchObject({ gesture: null, selectedId: "t1" });
    expect(useAoe.getState().own).not.toBeNull();
    expect(cancelAoe("escape")).toBe(true);
    expect(useAoe.getState().own).toBeNull();
    expect(cancelAoe("escape")).toBe(true);
    expect(useAoe.getState().selectedId).toBeNull();
    expect(cancelAoe("escape")).toBe(false);
  });

  test("FR-SCN-34 a tool / scene switch or leaving live drops the ephemeral and the selection", () => {
    for (const reason of ["tool", "scene", "live", "unmount"] as const) {
      useAoe.setState({ own: { sceneId: "s1", template: T }, selectedId: "t1" });
      expect(cancelAoe(reason)).toBe(true);
      expect(useAoe.getState()).toMatchObject({ own: null, selectedId: null, gesture: null });
    }
  });
});
