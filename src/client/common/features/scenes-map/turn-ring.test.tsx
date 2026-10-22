// FR-MAP-108–111: the `turn` decoration (merge, geometry, look) and its mark in the token group.
// react-konva's nodes are plain element names, so the token group renders to markup under bun.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { You } from "@shared/protocol/frames";
import { emptyStore, type RecordStore } from "@shared/protocol/store";
import type { TokenView } from "@shared/scenes-map/schemas";
import { SyncContext, type SyncState } from "@ui/sync/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { CanvasContext, type CanvasContextValue } from "./canvas-context";
import { decorateToken, plainDecoration } from "./decorations";
import { createPreviewStore, type PreviewState } from "./drag-preview";
import { TokenNode, TurnRingMark } from "./layers/TokensLayer";
import { CASING_EXTRA_PX } from "./mark-colors";
import {
  OUTLINE_PX,
  TOKEN_INSET,
  TURN_DASH_PX,
  TURN_GLOW_PX,
  TURN_RING_PX,
  TURN_RING_SMALL_PX,
  TURN_SMALL_CELL_PX,
  turnRingGeometry,
} from "./token-decor";
import {
  type TokenOverlay,
  type TokenOverlayView,
  type TokenTurn,
  tokenOverlays,
} from "./token-overlays";

const view: TokenOverlayView = { client: "dm", selected: false, targeting: false };
const t = {
  id: "t-mira",
  name: "Mira",
  col: 2,
  row: 3,
  size: "medium",
  shape: "round",
  imageAssetId: null,
  creatureType: null,
  hidden: false,
} as unknown as TokenView;

const dmYou: You = { campaignId: "c", role: "dm", playerId: null };
/** Mira's turn (round 1) in the DM's store; `hidden` → her combatant is hidden. */
function turnStore(hidden = false): RecordStore {
  return {
    ...emptyStore(),
    you: dmYou,
    records: {
      encounter: {
        e1: {
          id: "e1",
          status: "started",
          round: 1,
          turnCombatantId: "k-mira",
          playerTurnCombatantId: hidden ? null : "k-mira",
        },
      },
      combatant: {
        "k-mira": {
          id: "k-mira",
          encounterId: "e1",
          kind: "pc",
          entityId: "ch-mira",
          tokenId: "t-mira",
          name: "Mira",
          hidden,
          ownerHidden: false,
          active: true,
          removed: false,
          position: 1,
          playerPosition: hidden ? null : 1,
          movedFt: 0,
        },
      },
    },
  };
}

/** The token group as markup, with a stub canvas (cell 70 px, camera `scale`). */
function render(
  store: RecordStore,
  o: { scale?: number; preview?: { x: number; y: number } } = {},
) {
  // Server rendering reads a store's initial state, so the preview goes in at creation.
  const previews = o.preview
    ? createStore<PreviewState>()(() => ({
        previews: { [t.id]: { ...(o.preview as { x: number; y: number }), at: 0 } },
        local: null,
      }))
    : createPreviewStore();
  const c = {
    client: "dm",
    grid: { gridCellSize: 70, gridOffsetX: 0, gridOffsetY: 0 },
    cam: { scale: o.scale ?? 1, x: 0, y: 0 },
    colors: {
      playerAccent: "#22c55e",
      background: "#000",
      muted: "#111",
      foreground: "#fff",
      hidden: "#888",
    },
    previews,
    selected: new Set(),
    targeting: false,
    store,
    canMove: () => false,
    live: true,
    tool: "select",
    token: {},
  } as unknown as CanvasContextValue;
  const sync = createStore<SyncState>()(() => ({ state: "live", store }) as never);
  return renderToStaticMarkup(
    <SyncContext.Provider value={sync}>
      <CanvasContext.Provider value={c}>
        <TokenNode t={t} />
      </CanvasContext.Provider>
    </SyncContext.Provider>,
  );
}
/** Opening tags in order: [element, attrs]. */
const tags = (html: string) =>
  [...html.matchAll(/<([A-Za-z]+)([^>]*)>/g)].map((m) => [m[1] as string, m[2] as string] as const);
const attr = (attrs: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(attrs)?.[1];

/** The ring's Shape props (TurnRingMark is memo: its inner function renders one element). */
function ringProps(p: {
  turn: TokenTurn;
  side?: number;
  shape?: TokenView["shape"];
  scale?: number;
  cellPx?: number;
}) {
  const inner = (
    TurnRingMark as unknown as { type: (p: object) => { props: Record<string, unknown> } }
  ).type;
  return inner({
    tokenId: "t-mira",
    side: 70,
    shape: "round",
    scale: 1,
    cellPx: 70,
    color: "#22c55e",
    ...p,
  }).props;
}

// React DOM warns about Konva's casing / boolean props in markup; not under test here.
let restore: () => void = () => {};
beforeEach(() => {
  const err = console.error;
  console.error = () => {};
  restore = () => {
    console.error = err;
  };
});
afterEach(() => restore());

describe("FR-MAP-108 turn mark", () => {
  test("FR-MAP-108 turn mark: merge, first non-null turn wins; plain tokens have none", () => {
    const overlays: TokenOverlay[] = [
      { id: "dim", decorate: () => ({ dim: true }) },
      { id: "a", decorate: () => ({ turn: { id: "cbt-token-turn", hidden: true } }) },
      { id: "b", decorate: () => ({ turn: { id: "late-turn" } }) },
    ];
    expect(decorateToken(overlays, t, emptyStore(), view).turn).toEqual({
      id: "cbt-token-turn",
      hidden: true,
    });
    expect(decorateToken([overlays[0] as TokenOverlay], t, emptyStore(), view).turn).toBeNull();
    expect(plainDecoration.turn).toBeNull();
  });

  test("FR-MAP-108 turn mark: drawn inside the token group, before the body (after the hit area)", () => {
    const list = tags(render(turnStore()));
    expect(list[0]?.[0]).toBe("Group");
    expect(attr(list[0]?.[1] ?? "", "name")).toBe("map-token");
    const ring = list.findIndex(([, a]) => attr(a, "name") === "cbt-token-turn");
    expect(ring).toBe(2); // Group, hit-area Rect, then the ring
    expect(list[1]?.[0]).toBe("Rect");
    const r = list[ring]?.[1] ?? "";
    expect(list[ring]?.[0]).toBe("Shape");
    expect(attr(r, "id")).toBe("t-mira");
    // (`hidden` is an HTML boolean in markup: its value is checked on the props below.)
    // The body (initials backdrop + text) and the plain outline all come after it.
    expect(list.slice(ring + 1).map(([e]) => e)).toEqual(["Circle", "Text", "Circle"]);
    // Exactly one node per ringed token (FR-MAP-111).
    expect(list.filter(([, a]) => attr(a, "name") === "cbt-token-turn")).toHaveLength(1);
  });

  test("FR-MAP-108 turn mark: moves with a drag preview (the group moves; the ring keeps its group offset)", () => {
    const at = tags(render(turnStore()));
    const moved = tags(render(turnStore(), { preview: { x: 420, y: 280 } }));
    expect(attr(moved[0]?.[1] ?? "", "x")).toBe("420");
    expect(attr(moved[0]?.[1] ?? "", "y")).toBe("280");
    const ring = (l: typeof at) =>
      l.find(([, a]) => attr(a, "name") === "cbt-token-turn")?.[1] ?? "";
    expect(attr(ring(moved), "x")).toBe(attr(ring(at), "x"));
    expect(attr(ring(moved), "y")).toBe(attr(ring(at), "y"));
  });

  test("FR-MAP-108 turn mark: hidden → dashed, no glow; listening false", () => {
    // The registry's merge for a hidden turn combatant → the hidden mark.
    expect(decorateToken(tokenOverlays, t, turnStore(true), view).turn).toEqual({
      id: "cbt-token-turn",
      hidden: true,
    });
    const h = ringProps({ turn: { id: "cbt-token-turn", hidden: true } });
    expect(h.hidden).toBe("true");
    expect(h.dash).toEqual([...TURN_DASH_PX]);
    expect(h.shadowEnabled).toBe(false);
    expect(h.listening).toBe(false);
    const v = ringProps({ turn: { id: "cbt-token-turn" } });
    expect(v.hidden).toBe("false");
    expect(v.dash).toBeUndefined();
    expect(v.shadowEnabled).toBe(true);
    expect(v.shadowBlur).toBe(TURN_GLOW_PX);
    expect(v.shadowColor).toBe("#22c55e");
    expect(v.stroke).toBe("#22c55e");
    expect(v.listening).toBe(false);
    // No turn → no node at all.
    expect(render(emptyStore())).not.toContain("cbt-token-turn");
  });

  test("FR-MAP-108 turn mark: hugs the shape just outside the selection / target outline", () => {
    const outer = (35 * TOKEN_INSET + OUTLINE_PX / 2) / 1; // outline's outer edge, scale 1
    const c = turnRingGeometry({ side: 70, shape: "round", hidden: false, scale: 1, cellPx: 70 });
    expect(c.kind).toBe("circle");
    expect(c.radius - c.strokeWidth / 2).toBeGreaterThan(outer);
    expect(c.x + c.width / 2).toBeCloseTo(35);
    expect(c.strokeWidth).toBe(TURN_RING_PX);
    expect(c.casingWidth).toBe(TURN_RING_PX + CASING_EXTRA_PX);
    for (const shape of ["square", "none"] as const) {
      const s = turnRingGeometry({ side: 70, shape, hidden: false, scale: 1, cellPx: 70 });
      expect(s.kind).toBe("square");
      const edge = shape === "none" ? 0 : 35 * (1 - TOKEN_INSET) * 0.5;
      expect(s.x + s.strokeWidth / 2).toBeLessThan(edge - OUTLINE_PX / 2);
      expect(s.width).toBeCloseTo(70 - 2 * s.x);
    }
    // Screen-px widths: at zoom 2 the map-px stroke halves.
    expect(
      turnRingGeometry({ side: 70, shape: "round", hidden: false, scale: 2, cellPx: 140 })
        .strokeWidth,
    ).toBe(TURN_RING_PX / 2);
  });
});

describe("FR-MAP-109 small cells", () => {
  test("FR-MAP-109 small cells: < 48 px → a 2 px ring, no glow; 48 px and up → 3 px + glow", () => {
    const small = turnRingGeometry({
      side: 70,
      shape: "round",
      hidden: false,
      scale: 0.5,
      cellPx: TURN_SMALL_CELL_PX - 1,
    });
    expect(small.strokeWidth * 0.5).toBe(TURN_RING_SMALL_PX);
    expect(small.glow).toBeNull();
    const at = turnRingGeometry({
      side: 70,
      shape: "round",
      hidden: false,
      scale: 1,
      cellPx: TURN_SMALL_CELL_PX,
    });
    expect(at.strokeWidth).toBe(TURN_RING_PX);
    expect(at.glow).toBe(TURN_GLOW_PX);
    const p = ringProps({ turn: { id: "cbt-token-turn" }, scale: 0.5, cellPx: 35 });
    expect(p.shadowEnabled).toBe(false);
    expect(p.strokeWidth).toBe(TURN_RING_SMALL_PX / 0.5);
    // Hidden + small: thin and dashed.
    expect(
      turnRingGeometry({ side: 70, shape: "square", hidden: true, scale: 0.5, cellPx: 35 }).dash,
    ).toEqual(TURN_DASH_PX.map((d) => d / 0.5));
  });
});
