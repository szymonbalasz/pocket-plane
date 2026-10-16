// FOG §13 client unit rows, V3: the player render from the server's `vision` record (FR-FOG-21:
// sight, darkvision ring, explored memory, darkness both ways and never over Fog / Explored, the
// blind screen), the blind client rules (FR-FOG-36), the "No vision set" hint (FR-FOG-17), View
// as (FR-FOG-20 / -43: the shown pair, P's rows, dimming by FR-FOG-34 on P's polygons) and the
// Invisible render (FR-FOG-47: faded + badge, View as dims by `vision.inv`).
import { afterEach, describe, expect, test } from "bun:test";
import { encodeRuns } from "@shared/fog-of-war/mask";
import type { FogRecord, VisionRecord } from "@shared/fog-of-war/schemas";
import type { FogLayerShape } from "@shared/fog-of-war/shapes";
import { emptyStore, type RecordStore } from "@shared/protocol/store";
import type { TokenView } from "@shared/scenes-map/schemas";
import { decorateToken } from "../scenes-map/decorations";
import { tokenOverlays } from "../scenes-map/token-overlays";
import { BLIND_TEXT, blindStore, canvasBlind, isBlind } from "./blind";
import { NO_VISION_PREFIX, noVisionNames } from "./no-vision";
import { Raster } from "./paint-raster";
import { FOG_ALPHA, type PaintCtx } from "./render";
import { FOG_BADGE, fogTokenOverlay, INVISIBLE_BADGE } from "./token-overlay";
import { pairRows, shownPair, useViewAs, viewAsSees, visionOf } from "./view-as";
import {
  BLIND_GRID_MIN_CONTRAST,
  blindGridColor,
  luminance,
  memoryRuns,
  paintPlayerView,
  polygonPath,
  VIEW_AS_OPACITY,
  VISION_ALPHA,
  type ViewPaints,
  type VisionLike,
} from "./vision-render";

/** 10 × 6 cells of 10 px. */
const map = { mapWidth: 100, mapHeight: 60, gridCellSize: 10, gridOffsetX: 0, gridOffsetY: 0 };
const paints: ViewPaints = {
  fog: { color: "F", alpha: FOG_ALPHA.player.fog },
  explored: { color: "E", alpha: FOG_ALPHA.player.explored },
  darkness: { color: "D", alpha: FOG_ALPHA.player.darkness },
  darkvision: { color: "V", alpha: VISION_ALPHA.darkvision },
  darknessSeen: { color: "S", alpha: VISION_ALPHA.darknessSeen },
};
const label = (r: Raster, c: number, row: number) => r.at(c * 10 + 5, row * 10 + 5).label;
const px = (r: Raster, c: number, row: number) => r.at(c * 10 + 5, row * 10 + 5);

const fogAll = { fill: "fog" as const, box: [0, 0, 10, 6] as [number, number, number, number] };
const rect = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, x1, y0, x1, y1, x0, y1];
const vision = (v: Partial<VisionLike>): VisionLike => ({ blind: false, see: [], dark: [], ...v });

function view(
  fog: Parameters<typeof paintPlayerView>[1]["fog"],
  v: VisionLike | null,
  memory: Parameters<typeof paintPlayerView>[1]["memory"] = [],
) {
  const r = new Raster(100, 60);
  paintPlayerView(r, { fog, memory, vision: v }, map, paints, {
    visible: true,
    color: "G",
    opacity: 0.3,
    width: 1,
  });
  return r;
}

/** A `fog-explored` row over the 10 × 6 box with the given cells explored. */
function memoryRow(cells: [number, number][]) {
  const m = new Uint8Array(60);
  for (const [c, r] of cells) m[r * 10 + c] = 1;
  return { box: [0, 0, 10, 6] as [number, number, number, number], runs: encodeRuns(m, "clear") };
}

describe("FR-FOG-21 player render (V3)", () => {
  test("FR-FOG-21 in sight: clear; unseen Fog opaque; no vision record = the static fog", () => {
    const fog = { ...fogAll, runs: "" };
    const r = view(fog, vision({ see: [rect(1, 1, 4, 4)] }));
    expect(label(r, 2, 2)).toBeNull();
    expect(px(r, 6, 2)).toEqual({ label: "F", alpha: 1 });
    expect(label(view(fog, null), 2, 2)).toBe("F");
    // Senses all 0: a record with no polygons draws the static fog.
    expect(label(view(fog, vision({})), 2, 2)).toBe("F");
  });

  test("FR-FOG-21 darkvision ring: beyond `see`, inside `dark` → dimmed + desaturated, never over static clear", () => {
    const fog = { ...fogAll, runs: "", shapes: [{ op: "reveal", rect: [6, 0, 8, 2] }] };
    const r = view(fog as never, vision({ see: [rect(1, 1, 4, 4)], dark: [rect(0, 0, 8, 6)] }));
    expect(label(r, 2, 2)).toBeNull(); // in `see`
    expect(px(r, 5, 4)).toEqual({ label: "V", alpha: VISION_ALPHA.darkvision }); // ring over Fog
    expect(label(r, 7, 1)).toBeNull(); // ring over a revealed area: clear
    expect(label(r, 9, 4)).toBe("F"); // outside every polygon
    // Two sources: a ring under another source's `see` is clear (union).
    const two = view(
      fog as never,
      vision({ see: [rect(5, 3, 7, 5)], dark: [rect(0, 0, 8, 6), rect(4, 2, 9, 6)] }),
    );
    expect(label(two, 5, 3)).toBeNull();
    expect(label(two, 8, 5)).toBe("V");
  });

  test("FR-FOG-37 explored memory: Fog draws as Explored where remembered (setting on only), records aside", () => {
    const shapes: FogLayerShape[] = [
      { op: "reveal", rect: [0, 0, 2, 6] },
      { op: "fog", rect: [0, 4, 2, 6] },
    ];
    const fog = { ...fogAll, runs: "", shapes, explored: true };
    const mem = memoryRuns(
      memoryRow([
        [5, 1],
        [6, 1],
        [0, 2],
        [1, 5],
      ]),
      map,
    );
    expect(mem).toEqual([
      [50, 10, 20, 10],
      [0, 20, 10, 10],
      [10, 50, 10, 10],
    ]);
    const r = view(fog, null, mem);
    expect(px(r, 5, 1)).toEqual({ label: "E", alpha: FOG_ALPHA.player.explored }); // base fog
    expect(label(r, 7, 1)).toBe("F"); // not remembered
    expect(label(r, 0, 2)).toBeNull(); // remembered but revealed: clear
    expect(label(r, 1, 5)).toBe("E"); // fog shape over a remembered cell
    expect(label(r, 0, 5)).toBe("F");
    // FR-FOG-29: the setting off → memory neither draws.
    const off = view({ ...fog, explored: false }, null, mem);
    expect(label(off, 5, 1)).toBe("F");
    expect(label(off, 1, 5)).toBe("F");
    // In sight beats memory.
    expect(label(view(fog, vision({ see: [rect(4, 0, 7, 3)] }), mem), 5, 1)).toBeNull();
  });

  test("FR-FOG-21 darkness: opaque where statically clear and unseen; a darker transparent tint inside a see-through source's sight; never over Fog or Explored", () => {
    const fog = {
      ...fogAll,
      runs: "",
      shapes: [
        { op: "reveal", rect: [5, 0, 10, 4] },
        { op: "explored", rect: [0, 4, 4, 6] },
      ] as FogLayerShape[],
      darkness: [
        { id: "a", circle: [7.5, 2.5, 1] },
        { id: "b", rect: [1, 1, 3, 3] }, // in static fog
        { id: "c", rect: [1, 4, 3, 6] }, // over the Explored rect
      ],
    };
    const none = view(fog as never, null);
    expect(px(none, 7, 2)).toEqual({ label: "D", alpha: 1 });
    expect(label(none, 1, 1)).toBe("F");
    expect(label(none, 1, 4)).toBe("E");
    // A source without see-through: its polygon is cut at the darkness (FR-FOG-33).
    const cut = view(fog as never, vision({ see: [rect(5, 0, 6.5, 4)] }));
    expect(label(cut, 5, 2)).toBeNull();
    expect(label(cut, 7, 2)).toBe("D");
    // A see-through source: darkness inside its polygon → `fog.darkness-seen`, also over Fog.
    const through = view(fog as never, vision({ see: [rect(0, 0, 10, 4)] }));
    expect(px(through, 7, 2)).toEqual({ label: "S", alpha: VISION_ALPHA.darknessSeen });
    expect(label(through, 1, 1)).toBe("S");
    expect(label(through, 5, 1)).toBeNull();
    expect(label(through, 1, 4)).toBe("E"); // outside sight, over Explored: no darkness
    // Inside a darkvision ring too.
    const ring = view(fog as never, vision({ dark: [rect(0, 0, 10, 4)] }));
    expect(label(ring, 1, 1)).toBe("S");
    expect(label(ring, 4, 1)).toBe("V");
    expect(VISION_ALPHA.darknessSeen).toBeLessThan(FOG_ALPHA.player.explored);
  });

  test("FR-FOG-36 blind: the whole map dark, the grid redrawn on top, nothing else", () => {
    const fog = { fill: "clear" as const, box: fogAll.box, runs: "" };
    const r = view(fog, vision({ blind: true }));
    expect(px(r, 0, 0)).toEqual({ label: "D", alpha: 1 });
    expect(px(r, 9, 5)).toEqual({ label: "D", alpha: 1 });
    expect(r.strokes).toBe(1);
    const noGrid = new Raster(100, 60);
    paintPlayerView(noGrid, { fog, memory: [], vision: vision({ blind: true }) }, map, paints, {
      visible: false,
      color: "G",
      opacity: 1,
      width: 1,
    });
    expect(noGrid.strokes).toBe(0);
    expect(BLIND_TEXT).toBe("Magical darkness — you can't see");
  });

  test("FR-FOG-36 blind (FOG §13 step 9): grid lines stroke after the dark fill, light on black", () => {
    class Ordered extends Raster {
      ops: string[] = [];
      override fill(...a: Parameters<Raster["fill"]>) {
        this.ops.push("fill");
        super.fill(...a);
      }
      override stroke() {
        this.ops.push("stroke");
        super.stroke();
      }
    }
    const r = new Ordered(100, 60);
    const fog = { fill: "clear" as const, box: fogAll.box, runs: "" };
    const black = { ...paints, darkness: { color: "#000000", alpha: 1 } };
    // The scenes-map default grid: black at 50 %.
    paintPlayerView(r, { fog, memory: [], vision: vision({ blind: true }) }, map, black, {
      visible: true,
      color: "#000000",
      opacity: 0.5,
      width: 1,
    });
    expect(r.ops).toEqual(["fill", "stroke"]);
    expect(r.strokeLog).toEqual([{ style: "#ffffff", alpha: 0.5 }]);
    expect(px(r, 4, 3)).toEqual({ label: "#000000", alpha: 1 });
  });

  test("FR-FOG-36 blind grid colour: kept when it shows on the fill, else flipped", () => {
    expect(luminance("#000")).toBe(0);
    expect(luminance("#ffffffcc")).toBeCloseTo(1);
    expect(luminance("oklch(0 0 0)")).toBeNull();
    expect(blindGridColor("#000000", "#000000")).toBe("#ffffff");
    expect(blindGridColor("#333333", "#000000")).toBe("#ffffff");
    expect(blindGridColor("#ffffff", "#000000")).toBe("#ffffff");
    expect(blindGridColor("#ffd700", "#000000")).toBe("#ffd700");
    expect(blindGridColor("#eeeeee", "#ffffff")).toBe("#000000");
    // Unparsed fill counts as black; an unparsed grid colour is left alone.
    expect(blindGridColor("#000000", "var(--x)")).toBe("#ffffff");
    expect(blindGridColor("rebeccapurple", "#000000")).toBe("rebeccapurple");
    expect(BLIND_GRID_MIN_CONTRAST).toBe(3);
  });

  test("FR-FOG-21 sight polygons are wound one way, so overlapping polygons clip as a union", () => {
    const sign = (flat: number[]) => {
      const pts: [number, number][] = [];
      const rec = {
        moveTo: (x: number, y: number) => pts.push([x, y]),
        lineTo: (x: number, y: number) => pts.push([x, y]),
        closePath: () => {},
      } as unknown as PaintCtx;
      polygonPath(rec, flat, map);
      let a = 0;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i] as [number, number];
        const [xj, yj] = pts[j] as [number, number];
        a += xj * yi - xi * yj;
      }
      return Math.sign(a);
    };
    const cw = rect(0, 0, 2, 2);
    const ccw = [0, 0, 0, 2, 2, 2, 2, 0];
    expect(sign(cw)).toBe(sign(ccw));
    expect(VIEW_AS_OPACITY).toBe(0.7);
  });
});

describe("FR-FOG-36 blind client", () => {
  const store = (blind: boolean): RecordStore => ({
    ...emptyStore(),
    records: {
      vision: {
        "s:p1": { id: "s:p1", sceneId: "s", playerId: "p1", blind, see: [], dark: [] },
      },
      "aoe-template": {
        own: { id: "own", sceneId: "s", placedByPlayerId: "p1" },
        other: { id: "other", sceneId: "s", placedByPlayerId: "p2" },
      },
    },
  });

  test("FR-FOG-36 blind = the player's own vision row on the shown scene says so", () => {
    expect(isBlind(store(true), "s", "p1")).toBe(true);
    expect(isBlind(store(false), "s", "p1")).toBe(false);
    expect(isBlind(store(true), "other-scene", "p1")).toBe(false);
    expect(isBlind(store(true), "s", null)).toBe(false);
  });

  test("FR-FOG-36 others' live template previews: the templates layer drops them on a blind player's canvas only", () => {
    expect(canvasBlind("player", store(true), "s", "p1")).toBe(true);
    expect(canvasBlind("player", store(false), "s", "p1")).toBe(false);
    expect(canvasBlind("dm", store(true), "s", "p1")).toBe(false);
    // The layer reads the blind store: the vision row survives the template filter.
    expect(canvasBlind("player", blindStore(store(true), "p1"), "s", "p1")).toBe(true);
  });

  test("FR-FOG-36 while blind no other placer's templates draw; own placement still does", () => {
    const full = store(true);
    const s = blindStore(full, "p1");
    expect(Object.keys(s.records["aoe-template"] ?? {})).toEqual(["own"]);
    expect(s.records.vision).toBe(full.records.vision);
    const bare = { ...emptyStore(), records: {} };
    expect(blindStore(bare, "p1")).toBe(bare);
  });
});

describe("FR-FOG-17 No vision set hint", () => {
  const senses = (visionFt: number, darkvisionFt: number) => ({
    statBlock: { senses: { visionFt, darkvisionFt, seesMagicalDarkness: false } },
  });
  const tok = (
    id: string,
    name: string,
    definitionId: string,
    owner: string | null,
    sceneId = "s",
  ) => ({
    id,
    name,
    definitionId,
    ownerPlayerId: owner,
    sceneId,
  });
  const records = {
    token: {
      a: tok("a", "Mira", "mira", "p1"),
      b: tok("b", "Thorn", "thorn", "p2"),
      c: tok("c", "Brakka", "brakka", "p2"),
      d: tok("d", "Goblin", "goblin", null),
      e: tok("e", "Sela", "sela", "p1", "other"),
      f: tok("f", "Ash", "missing", "p1"),
      g: tok("g", "Brakka", "brakka", "p2"),
    },
    entity: {
      mira: senses(30, 0),
      thorn: senses(0, 60),
      brakka: { statBlock: {} },
      goblin: senses(0, 0),
      sela: senses(0, 0),
    },
  };

  test("FR-FOG-17 lists owned tokens on the viewed scene whose senses are all 0, each name once", () => {
    expect(noVisionNames(records, "s")).toEqual(["Ash", "Brakka"]);
    expect(noVisionNames(records, "other")).toEqual(["Sela"]);
    expect(noVisionNames(records, "empty")).toEqual([]);
    expect(NO_VISION_PREFIX).toBe("No vision set for: ");
  });

  test("FR-FOG-17 imported definitions are read too; none left → hidden (empty)", () => {
    const r = {
      token: { a: tok("a", "Wolf", "imp", "p1") },
      "imported-entity": { imp: senses(0, 60) },
    };
    expect(noVisionNames(r, "s")).toEqual([]);
  });
});

describe("FR-FOG-20 / -43 / -47 View as and Invisible (DM)", () => {
  afterEach(() => useViewAs.setState({ playerId: null, loaded: null }));
  const dm = { client: "dm", selected: false, targeting: false } as const;
  const token = (t: Partial<TokenView> & { invisible?: true }) =>
    ({
      id: "t",
      sceneId: "s",
      col: 2,
      row: 2,
      size: "medium",
      ownerPlayerId: null,
      hidden: false,
      ...t,
    }) as TokenView;
  const fogRec = (f: Partial<FogRecord> = {}): FogRecord => ({
    id: "s",
    campaignId: "c",
    fill: "fog",
    box: [0, 0, 10, 6],
    runs: "",
    shapes: [],
    darkness: [],
    explored: false,
    undo: null,
    ...f,
  });
  const visionRec = (v: Partial<VisionRecord> = {}): VisionRecord => ({
    id: "s:p1",
    sceneId: "s",
    playerId: "p1",
    blind: false,
    see: [rect(0, 0, 4, 4)],
    dark: [],
    ...v,
  });
  const storeWith = (fog: FogRecord | null, v: VisionRecord | null): RecordStore => ({
    ...emptyStore(),
    records: {
      ...(fog ? { fog: { s: fog } } : {}),
      ...(v ? { vision: { [v.id]: v } } : {}),
    },
  });
  const viewAs = (playerId = "p1", sceneId = "s") =>
    useViewAs.setState({ playerId, loaded: { sceneId, playerId } });
  const dimOf = (t: TokenView, s: RecordStore) => decorateToken(tokenOverlays, t, s, dm).dim;

  test("FR-FOG-47 DM: an invisible token draws faded with the Invisible badge, plus Fog when seen by nobody", () => {
    const s = emptyStore();
    expect(fogTokenOverlay.decorate?.(token({ invisible: true }), s, dm)).toEqual({
      badges: [INVISIBLE_BADGE],
      dim: true,
    });
    expect(INVISIBLE_BADGE).toMatchObject({ id: "fog-token-invisible", label: "Invisible" });
    expect(
      fogTokenOverlay.decorate?.(token({ invisible: true, fogged: true }), s, dm)?.badges,
    ).toEqual([FOG_BADGE, INVISIBLE_BADGE]);
    // Players: no change (they never get the key, and draw a seen token as any other).
    const player = { client: "player", selected: false, targeting: false } as const;
    expect(fogTokenOverlay.decorate?.(token({ invisible: true }), s, player)).toBeNull();
  });

  test("FR-FOG-43 the shown pair: loaded, matching the pick and the shown scene", () => {
    const pair = { sceneId: "s", playerId: "p1" };
    expect(shownPair(pair, "p1", "s")).toEqual(pair);
    expect(shownPair(pair, "p2", "s")).toBeNull(); // another pick: the old rows never draw
    expect(shownPair(pair, "p1", "s2")).toBeNull(); // another viewed scene
    expect(shownPair(pair, null, "s")).toBeNull(); // "DM"
    expect(shownPair(null, "p1", "s")).toBeNull(); // loading
    const v = visionRec();
    const rows = pairRows(storeWith(null, v).records, pair);
    expect(rows).toEqual({ vision: v, explored: null });
    expect(pairRows(storeWith(null, v).records, { sceneId: "s", playerId: "p2" })).toEqual({
      vision: null,
      explored: null,
    });
  });

  test("FR-FOG-20 View as P dims tokens P can't see (FR-FOG-34 on P's loaded polygons)", () => {
    const s = storeWith(fogRec(), visionRec());
    expect(dimOf(token({}), s)).toBe(false); // without View as
    viewAs();
    expect(dimOf(token({}), s)).toBe(false); // (2, 2) inside P1's polygon
    expect(dimOf(token({ col: 7 }), s)).toBe(true); // in fog, outside
    expect(dimOf(token({ hidden: true }), s)).toBe(true);
    expect(dimOf(token({ col: 7, ownerPlayerId: "p1" }), s)).toBe(false); // own
    expect(dimOf(token({ col: 7, ownerPlayerId: "p2" }), s)).toBe(false); // party
    // A Large token: one footprint cell inside is enough.
    expect(dimOf(token({ col: 3, size: "large" }), s)).toBe(false);
    // Statically clear and outside darkness: visible without sight; darkness hides it.
    const clear = storeWith(
      fogRec({ fill: "clear", darkness: [{ id: "d", circle: [7.5, 2.5, 1] }] }),
      visionRec(),
    );
    expect(dimOf(token({ col: 8, row: 4 }), clear)).toBe(false);
    expect(dimOf(token({ col: 7 }), clear)).toBe(true);
    // A token on another scene is not judged.
    expect(dimOf(token({ col: 7, sceneId: "s2" }), s)).toBe(false);
  });

  test("FR-FOG-20 View as a blind P: only P's own tokens; no vision row = static fog only", () => {
    const blind = storeWith(fogRec({ fill: "clear" }), visionRec({ blind: true, see: [] }));
    viewAs();
    expect(dimOf(token({ ownerPlayerId: "p1" }), blind)).toBe(false);
    expect(dimOf(token({ ownerPlayerId: "p2" }), blind)).toBe(true);
    expect(dimOf(token({}), blind)).toBe(true);
    const none = storeWith(fogRec({ fill: "clear" }), null);
    expect(dimOf(token({}), none)).toBe(false);
    expect(dimOf(token({}), storeWith(fogRec(), null))).toBe(true);
    expect(viewAsSees(token({}), "p1", visionOf(null), null)).toBe(true); // no fog row: clear
  });

  test("FR-FOG-47 View as dims an invisible token unless a sample point is in a `vision.inv` polygon", () => {
    viewAs();
    const plain = storeWith(fogRec({ fill: "clear" }), visionRec());
    expect(dimOf(token({ invisible: true }), plain)).toBe(true); // in sight, no Sees invisible
    const inv = storeWith(
      fogRec({ fill: "clear" }),
      visionRec({ see: [rect(5, 0, 6, 1)], dark: [rect(0, 0, 4, 4)], inv: [1] }),
    );
    expect(dimOf(token({ invisible: true }), inv)).toBe(false); // the `dark` polygon (index 1)
    expect(dimOf(token({ invisible: true, col: 8, row: 4 }), inv)).toBe(true); // clear, unseen
    // Owned invisible tokens keep the owner + party rule (#210).
    expect(dimOf(token({ invisible: true, ownerPlayerId: "p2", col: 8 }), plain)).toBe(false);
    expect(fogTokenOverlay.decorate?.(token({ invisible: true }), inv, dm)).toEqual({
      badges: [INVISIBLE_BADGE],
    });
  });

  test("FR-FOG-43 a new pair re-runs the decorations (overlay subscription)", () => {
    let n = 0;
    const off = fogTokenOverlay.subscribe?.(() => n++);
    viewAs();
    useViewAs.setState({ playerId: "p2" }); // pick only: the pair is not loaded yet
    viewAs("p2");
    off?.();
    viewAs("p1");
    expect(n).toBe(2);
  });
});
