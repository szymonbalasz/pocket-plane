// MAP §13 Unit (feedback): selection reducer, box hit, overlay merge, movement tone, shape fit.
import { describe, expect, test } from "bun:test";
import { emptyStore } from "@shared/protocol/store";
import type { TokenView } from "@shared/scenes-map/schemas";
import { decorateToken, movedFtOf } from "./decorations";
import { movementIndicator } from "./movement";
import { emptySelection, isClick, selectionReducer, tokensInBox } from "./selection-logic";
import { containRect, coverCrop, initialsBackdropOf, outlineOf } from "./shape";
import type { TokenOverlay, TokenOverlayView } from "./token-overlays";

const grid = { gridCellSize: 70, gridOffsetX: 0, gridOffsetY: 0 };
const tok = (id: string, col: number, row: number, size: TokenView["size"] = "medium") =>
  ({ id, col, row, size, name: id, shape: "round" }) as TokenView;

describe("FR-MAP-31 selection reducer", () => {
  const on = (ids: string[]) => ({ sceneId: "s1", tokenIds: ids });
  test("click selects one; Ctrl/Shift toggle; empty click / Esc clear", () => {
    let s = selectionReducer(emptySelection, { type: "scene", sceneId: "s1" });
    s = selectionReducer(s, { type: "click", id: "a" });
    expect(s).toEqual(on(["a"]));
    s = selectionReducer(s, { type: "toggle", id: "b" });
    expect(s.tokenIds).toEqual(["a", "b"]);
    s = selectionReducer(s, { type: "toggle", id: "a" });
    expect(s.tokenIds).toEqual(["b"]);
    s = selectionReducer(s, { type: "click", id: "c" });
    expect(s.tokenIds).toEqual(["c"]);
    s = selectionReducer(s, { type: "clear" });
    expect(s).toEqual(on([]));
    expect(selectionReducer(s, { type: "clear" })).toBe(s);
  });

  test("scene change clears; ids that leave the store drop out; set dedupes", () => {
    const s = on(["a", "b", "c"]);
    expect(selectionReducer(s, { type: "scene", sceneId: "s1" })).toBe(s);
    expect(selectionReducer(s, { type: "scene", sceneId: "s2" })).toEqual({
      sceneId: "s2",
      tokenIds: [],
    });
    expect(
      selectionReducer(s, { type: "prune", present: new Set(["a", "c", "x"]) }).tokenIds,
    ).toEqual(["a", "c"]);
    expect(selectionReducer(s, { type: "prune", present: new Set(["a", "b", "c"]) })).toBe(s);
    expect(selectionReducer(s, { type: "set", ids: ["x", "x", "y"] }).tokenIds).toEqual(["x", "y"]);
  });
});

describe("FR-MAP-32 box select", () => {
  const tokens = [tok("goblin", 12, 6, "small"), tok("ogre", 9, 10, "large"), tok("mira", 2, 7)];
  test("footprint centre inside (any drag direction); adds to the selection", () => {
    // Goblin centre (875, 455); Ogre (2×2) centre (700, 770): both inside; Mira (175, 525) not.
    const box = { x0: 950, y0: 800, x1: 600, y1: 400 };
    expect(tokensInBox(tokens, grid, box)).toEqual(["goblin", "ogre"]);
    // Covers part of the Ogre's footprint but not its centre.
    expect(tokensInBox(tokens, grid, { x0: 630, y0: 700, x1: 690, y1: 760 })).toEqual([]);
    const s = selectionReducer(
      { sceneId: "s1", tokenIds: ["mira"] },
      { type: "add", ids: ["goblin", "ogre", "mira"] },
    );
    expect(s.tokenIds).toEqual(["mira", "goblin", "ogre"]);
  });
  test("< 4 px pointer travel = a click", () => {
    expect(isClick(0, 0)).toBe(true);
    expect(isClick(2, 3)).toBe(true);
    expect(isClick(4, 0)).toBe(false);
    expect(isClick(3, 3)).toBe(false);
  });
});

describe("FR-MAP-34 overlay merge", () => {
  const view: TokenOverlayView = { client: "dm", selected: false, targeting: false };
  const store = emptyStore();
  const t = tok("goblin", 1, 1);
  test("merged in registry order; a throw is reported once per call and ignored", () => {
    const errors: string[] = [];
    const overlays: TokenOverlay[] = [
      {
        id: "a",
        decorate: () => ({ badges: [{ id: "a-out", icon: "x", tone: "neutral", label: "Out" }] }),
      },
      {
        id: "boom",
        decorate: () => {
          throw new Error("boom");
        },
      },
      { id: "none", decorate: () => null },
      {
        id: "b",
        decorate: (_t, _s, v) => ({
          dim: true,
          ring: v.selected ? "target" : undefined,
          badges: [{ id: "b-down", icon: "skull", tone: "down", label: "Down" }],
        }),
      },
    ];
    const d = decorateToken(overlays, t, store, view, (id) => errors.push(id));
    expect(d.dim).toBe(true);
    expect(d.ring).toBeNull();
    expect(d.badges.map((b) => b.id)).toEqual(["a-out", "b-down"]);
    expect(errors).toEqual(["boom"]);
    expect(decorateToken(overlays, t, store, { ...view, selected: true }, () => {}).ring).toBe(
      "target",
    );
    expect(decorateToken([], t, store, view)).toEqual({
      dim: false,
      badges: [],
      ring: null,
      cross: null,
      bar: null,
      icons: [],
      cue: null,
    });
  });
  test("FR-MAP-37 first non-null movedFt wins; throws ignored; none → null", () => {
    const errors: string[] = [];
    const overlays: TokenOverlay[] = [
      { id: "x", movedFt: () => null },
      {
        id: "boom",
        movedFt: () => {
          throw new Error("boom");
        },
      },
      { id: "cbt", movedFt: () => 20 },
      { id: "later", movedFt: () => 99 },
    ];
    expect(movedFtOf(overlays, t, store, (id) => errors.push(id))).toBe(20);
    expect(errors).toEqual(["boom"]);
    expect(movedFtOf([{ id: "x", movedFt: () => null }], t, store)).toBeNull();
  });
});

describe("FR-MAP-37 movement indicator", () => {
  test("tone vs speed: = speed normal, +5 dash, = 2× dash, > 2× over", () => {
    expect(movementIndicator(30, null, 30)).toEqual({ tone: "normal", text: "30 / 30 ft" });
    expect(movementIndicator(35, null, 30)).toEqual({ tone: "dash", text: "35 / 30 ft" });
    expect(movementIndicator(60, null, 30).tone).toBe("dash");
    expect(movementIndicator(65, null, 30)).toEqual({ tone: "over", text: "65 / 30 ft" });
  });
  test("speed 0; no speed → none; in combat `used` adds", () => {
    expect(movementIndicator(0, null, 0).tone).toBe("normal");
    expect(movementIndicator(5, null, 0).tone).toBe("over");
    expect(movementIndicator(15, null, null)).toEqual({ tone: "none", text: "15 ft" });
    expect(movementIndicator(15, null, undefined)).toEqual({ tone: "none", text: "15 ft" });
    expect(movementIndicator(15, 20, 30)).toEqual({ tone: "dash", text: "move 15 · 35 / 30 ft" });
    expect(movementIndicator(15, 0, 30)).toEqual({ tone: "normal", text: "move 15 · 15 / 30 ft" });
    expect(movementIndicator(15, 20, null)).toEqual({ tone: "none", text: "15 ft" });
  });
});

describe("FR-MAP-35 shape fit", () => {
  test("square: cover crop; none: contain; outlines and initials per shape", () => {
    expect(coverCrop(200, 100)).toEqual({ x: 50, y: 0, width: 100, height: 100 });
    expect(coverCrop(100, 300)).toEqual({ x: 0, y: 100, width: 100, height: 100 });
    expect(containRect(200, 100, 70)).toEqual({ x: 0, y: 17.5, width: 70, height: 35 });
    expect(containRect(50, 100, 140)).toEqual({ x: 35, y: 0, width: 70, height: 140 });
    expect(outlineOf("round")).toBe("circle");
    expect(outlineOf("square")).toBe("square");
    expect(outlineOf("none")).toBe("square");
    expect(initialsBackdropOf("round")).toBe("circle");
    expect(initialsBackdropOf("none")).toBe("rounded-square");
  });
});
