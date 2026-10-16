// DM View as (FR-FOG-17 / -20 / -43 / -47): the picked player (client state; "DM" = null), the
// loaded `(sceneId, playerId)` pair mirrored from the sync connection (the fog layer keeps it in
// step), and the pure "would P see this token" test the DM's token dimming uses: FR-FOG-34 / -46
// on P's loaded `vision` polygons (the server's result) with the same shared fns as the server.
// The `vision` record carries no per-polygon see-through flag; only a see-through source's polygon
// reaches inside darkness (FR-FOG-33), so every polygon is treated as one that may.
import { maskOf } from "@shared/fog-of-war/mask";
import {
  FOG_EXPLORED_TYPE,
  FOG_TYPE,
  type FogExploredRecord,
  type FogRecord,
  scenePlayerId,
  VISION_TYPE,
  type VisionRecord,
} from "@shared/fog-of-war/schemas";
import {
  invisibleSeen,
  type PlayerVision,
  pointInPolygon,
  pointVisible,
  prepareStaticLayer,
  type SightPoly,
  type StaticLayer,
  samplePoint,
} from "@shared/fog-of-war/vision";
import type { ViewAsPair } from "@shared/protocol/scene-window";
import type { RecordStore } from "@shared/protocol/store";
import { footprint } from "@shared/scenes-map/geometry";
import type { TokenView } from "@shared/scenes-map/schemas";
import { create } from "zustand";

interface ViewAsState {
  /** The View as Select: a player id, or null = "DM" (off). */
  playerId: string | null;
  /** The loaded pair while it matches the pick on the shown scene, else null. */
  loaded: ViewAsPair | null;
}

export const useViewAs = create<ViewAsState>(() => ({ playerId: null, loaded: null }));

/** The Select's value for "DM" (`fog-view-as` `data-value`). */
export const VIEW_AS_DM = "dm";

export function setViewAs(playerId: string | null): void {
  useViewAs.setState({ playerId });
}

/** The loaded pair the DM draws, given the sync pair, the pick and the shown scene. */
export function shownPair(
  loaded: ViewAsPair | null,
  playerId: string | null,
  sceneId: string,
): ViewAsPair | null {
  if (!loaded || playerId === null) return null;
  return loaded.sceneId === sceneId && loaded.playerId === playerId ? loaded : null;
}

type Records = RecordStore["records"];

/** The pair's rows in the store (absent rows = P has no source / no memory there). */
export function pairRows(
  records: Records,
  pair: ViewAsPair,
): { vision: VisionRecord | null; explored: FogExploredRecord | null } {
  const id = scenePlayerId(pair.sceneId, pair.playerId);
  return {
    vision: (records[VISION_TYPE]?.[id] as VisionRecord | undefined) ?? null,
    explored: (records[FOG_EXPLORED_TYPE]?.[id] as FogExploredRecord | undefined) ?? null,
  };
}

/** A `vision` record as the shared fns' `PlayerVision` (no record = no polygons, not blind). */
export function visionOf(v: VisionRecord | null): PlayerVision {
  if (!v) return { blind: false, see: [], dark: [], inv: [], polys: [] };
  const inv = v.inv ?? [];
  const polys: SightPoly[] = [...v.see, ...v.dark].map((poly, i) => ({
    poly,
    kind: i < v.see.length ? "see" : "dark",
    seesThrough: true,
    seesInvisible: inv.includes(i),
    contains: (x, y) => pointInPolygon(poly, x, y),
  }));
  return { blind: v.blind, see: v.see, dark: v.dark, inv, polys };
}

const layers = new WeakMap<object, StaticLayer>();

/** The scene's static layer (base mask + shapes + darkness), once per `fog` record object. */
function staticLayerOf(fog: FogRecord): StaticLayer {
  let l = layers.get(fog);
  if (!l) {
    const { mask } = maskOf({ fill: fog.fill, box: fog.box, runs: fog.runs });
    l = prepareStaticLayer(mask, fog.shapes, fog.darkness);
    layers.set(fog, l);
  }
  return l;
}

/** No `fog` row = every point clear, no darkness (FR-FOG-01). */
const CLEAR: StaticLayer = {
  mask: { fill: "clear", box: [0, 0, 0, 0], cells: new Uint8Array() },
  shapes: [],
  darkness: [],
};

/**
 * FR-FOG-34 / -46 for View as: does player P (blind or not, polygons `v`) see token `t`? Hidden →
 * no; P's own → yes; another player's → unless P is blind (party rule); unowned → a footprint
 * cell centre visible (invisible: inside a Sees-invisible polygon only).
 */
export function viewAsSees(
  t: Pick<TokenView, "col" | "row" | "size" | "hidden" | "ownerPlayerId"> & {
    invisible?: boolean;
  },
  playerId: string,
  v: PlayerVision,
  fog: FogRecord | null,
): boolean {
  if (t.hidden) return false;
  if (t.ownerPlayerId === playerId) return true;
  if (t.ownerPlayerId != null) return !v.blind;
  const layer = fog ? staticLayerOf(fog) : CLEAR;
  const n = footprint(t.size);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const pt = samplePoint(layer, t.col + i + 0.5, t.row + j + 0.5);
      if (t.invisible === true ? invisibleSeen(v, pt) : pointVisible(v, pt)) return true;
    }
  }
  return false;
}

/** The View-as pair a DM token on `sceneId` is judged against, or null (View as off). */
export function viewAsFor(sceneId: string): ViewAsPair | null {
  const { loaded } = useViewAs.getState();
  return loaded && loaded.sceneId === sceneId ? loaded : null;
}

/** The DM's `fog` record of a scene (the full one: every darkness shape). */
export const dmFogOf = (records: Records, sceneId: string) =>
  (records[FOG_TYPE]?.[sceneId] as FogRecord | undefined) ?? null;
