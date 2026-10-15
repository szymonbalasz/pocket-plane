// FOG §13 client unit rows: FR-FOG-20/21 render (row rects; DM vs player alpha; layer order) and the
// FR-FOG-20 overlay badge.
import { describe, expect, test } from "bun:test";
import type { FogBox } from "@shared/fog-of-war/schemas";
import { emptyStore } from "@shared/protocol/store";
import type { TokenView } from "@shared/scenes-map/schemas";
import { canvasLayers } from "../scenes-map/canvas-layers";
import { decorateToken } from "../scenes-map/decorations";
import { LAYER_ORDER, layerSlots } from "../scenes-map/layers";
import { tokenOverlays } from "../scenes-map/token-overlays";
import { FOG_DM_OPACITY, fogOpacity, fogRuns } from "./render";
import { FOG_BADGE, fogTokenOverlay } from "./token-overlay";

/** 3 × 2 cells of 10 px. */
const map = { mapWidth: 30, mapHeight: 20, gridCellSize: 10, gridOffsetX: 0, gridOffsetY: 0 };
const box: FogBox = [0, 0, 3, 2];

describe("FR-FOG-20/21 render", () => {
  test("FR-FOG-20 no fog row → no fog; Fog all → one rect per row", () => {
    expect(fogRuns(null, map)).toEqual({ runs: [], cells: 0 });
    expect(fogRuns({ fill: "fog", box, runs: "" }, map)).toEqual({
      runs: [
        [0, 0, 30, 10],
        [0, 10, 30, 10],
      ],
      cells: 6,
    });
    expect(fogRuns({ fill: "clear", box, runs: "" }, map)).toEqual({ runs: [], cells: 0 });
  });

  test("FR-FOG-20 runs decode to row runs of fogged cells, in map px", () => {
    // Row-major [1 1 0 / 0 1 1] = runs fogged 2, clear 2, fogged 2.
    expect(fogRuns({ fill: "clear", box, runs: "2,2,2" }, map)).toEqual({
      runs: [
        [0, 0, 20, 10],
        [10, 10, 20, 10],
      ],
      cells: 4,
    });
  });

  test("FR-FOG-03 the render re-bases to the current box: cells keep their index, new ones take fill", () => {
    // Grid moved 5 px right: column −1 now overlaps the map; it takes `fill` (clear here, fog below).
    const moved = { ...map, gridOffsetX: 5 };
    expect(fogRuns({ fill: "clear", box, runs: "2,2,2" }, moved).runs).toEqual([
      [5, 0, 20, 10],
      [15, 10, 20, 10],
    ]);
    expect(fogRuns({ fill: "fog", box, runs: "0,1,2,1,1,1" }, moved).runs).toEqual([
      [-5, 0, 10, 10],
      [15, 0, 20, 10],
      [-5, 10, 10, 10],
      [15, 10, 10, 10],
    ]);
  });

  test("FR-FOG-04 a corrupt mask draws fully fogged (fail closed)", () => {
    expect(fogRuns({ fill: "clear", box, runs: "2,2" }, map).cells).toBe(6);
    expect(fogRuns({ fill: "clear", box, runs: "x!" }, map).cells).toBe(6);
  });

  test("FR-FOG-20/21 DM ≈ 50 % (OQ-FOG-19); players opaque", () => {
    expect(fogOpacity("dm")).toBe(FOG_DM_OPACITY);
    expect(FOG_DM_OPACITY).toBe(0.5);
    expect(fogOpacity("player")).toBe(1);
  });

  test("FR-FOG-20/21 layer `fog` at 30 on both clients: above props + structure, below templates, tokens and labels", () => {
    const fog = canvasLayers.find((l) => l.id === "fog");
    expect(fog?.order).toBe(LAYER_ORDER.fog);
    const dm = layerSlots(canvasLayers, "dm").map((s) => s.key);
    expect(dm.indexOf("fog")).toBe(dm.indexOf("scn-objects:scn-props") + 1);
    expect(dm.indexOf("fog")).toBe(dm.indexOf("scn-templates") - 1);
    expect(dm.indexOf("fog")).toBeLessThan(dm.indexOf("tokens"));
    // FR-FOG-21: the player client draws it in the same slot, so party tokens and own templates
    // stay visible over the opaque fog.
    const player = layerSlots(canvasLayers, "player").map((s) => s.key);
    expect(player.indexOf("fog")).toBe(player.indexOf("scn-templates") - 1);
    expect(player.indexOf("fog")).toBeLessThan(player.indexOf("tokens"));
    expect(player.indexOf("fog")).toBeLessThan(player.indexOf("labels"));
    expect(player.indexOf("fog")).toBeGreaterThan(player.indexOf("scn-objects:scn-props"));
  });
});

describe("FR-FOG-20 Fog badge", () => {
  const token = (t: Partial<TokenView>) =>
    ({
      id: "t1",
      col: 1,
      row: 1,
      size: "medium",
      ownerPlayerId: null,
      hidden: false,
      ...t,
    }) as TokenView;
  const dm = { client: "dm", selected: false, targeting: false } as const;
  const player = { client: "player", selected: false, targeting: false } as const;
  const store = emptyStore();

  test("FR-FOG-20 DM: badge on fog-hidden tokens only (ownerless, fogged, not `hidden`)", () => {
    expect(fogTokenOverlay.decorate?.(token({ fogged: true }), store, dm)).toEqual({
      badges: [FOG_BADGE],
    });
    expect(FOG_BADGE).toMatchObject({ id: "fog-token-fogged", label: "Fog", icon: "cloud-fog" });
    expect(fogTokenOverlay.decorate?.(token({}), store, dm)).toBeNull();
    // Owned tokens stay visible to players (OQ-FOG-03): not fog-hidden, no badge.
    expect(
      fogTokenOverlay.decorate?.(token({ fogged: true, ownerPlayerId: "p1" }), store, dm),
    ).toBeNull();
    // `hidden` tokens keep their own styling (FOG §13 step 1: Wolf, Elite carry no badge).
    expect(fogTokenOverlay.decorate?.(token({ fogged: true, hidden: true }), store, dm)).toBeNull();
  });

  test("FR-FOG-20 players never get the badge; the registry carries the line", () => {
    expect(fogTokenOverlay.decorate?.(token({ fogged: true }), store, player)).toBeNull();
    expect(tokenOverlays).toContain(fogTokenOverlay);
    const merged = decorateToken(tokenOverlays, token({ fogged: true }), store, dm);
    expect(merged.badges.map((b) => b.id)).toContain("fog-token-fogged");
  });
});
