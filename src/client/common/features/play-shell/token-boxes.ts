// Token screen boxes for placing things clear of the tokens on the map (FR-CBT-56 popup, FR-NOTE-32
// toast stack, open placement of new windows; P3 glitches 2 and 13). `coveredArea` and
// `screenFootprint` are pure; `tokenScreenBoxes` reads the live map canvas.
import type { RecordStore } from "@shared/protocol/store";
import { footprint } from "@shared/scenes-map/geometry";
import { SCENE_TYPE, TOKEN_TYPE, type TokenSize } from "@shared/scenes-map/schemas";

/** A token's on-screen box, px; `id` = its token record id when read from the canvas. */
export interface TokenBox {
  x: number;
  y: number;
  w: number;
  h: number;
  id?: string;
}

/** Area of `boxes` under the rect (x, y, w, h), px². */
export function coveredArea(
  r: { x: number; y: number; w: number; h: number },
  boxes: readonly TokenBox[],
): number {
  return boxes.reduce(
    (sum, t) =>
      sum +
      Math.max(0, Math.min(r.x + r.w, t.x + t.w) - Math.max(r.x, t.x)) *
        Math.max(0, Math.min(r.y + r.h, t.y + t.h) - Math.max(r.y, t.y)),
    0,
  );
}

/**
 * A token's footprint side in map px (FR-MAP-14 cells × the scene's grid cell size), from the
 * token record in `store` and its scene; null when either is missing.
 */
export function footprintSide(store: RecordStore, tokenId: string): number | null {
  const t = store.records[TOKEN_TYPE]?.[tokenId] as
    | { size?: TokenSize; sceneId?: string }
    | undefined;
  if (!t?.size || !t.sceneId) return null;
  const scene = store.records[SCENE_TYPE]?.[t.sceneId] as { gridCellSize?: number } | undefined;
  if (!scene?.gridCellSize) return null;
  return footprint(t.size) * scene.gridCellSize;
}

/**
 * A token's footprint on screen (FR-SHELL-57): the `map-token` group's absolute position (its
 * top-left cell corner) plus its side × the on-screen scale (stage scale), offset by the canvas.
 */
export function screenFootprint(
  canvas: { left: number; top: number },
  pos: { x: number; y: number },
  scale: number,
  side: number,
): Omit<TokenBox, "id"> {
  return { x: canvas.left + pos.x, y: canvas.top + pos.y, w: side * scale, h: side * scale };
}

interface KonvaNode {
  id(): string;
  getClientRect(): { x: number; y: number; width: number; height: number };
  getAbsolutePosition(): { x: number; y: number };
  getAbsoluteScale(): { x: number; y: number };
}
interface KonvaStage {
  container(): HTMLElement;
  find(selector: string): KonvaNode[];
}

/**
 * On-screen box of each drawn token in `tokenIds` (`"all"`: every drawn token) on the map canvas
 * (Konva `name` / `id`, AGENTS §9.5); tokens not drawn (other scene, no canvas) are left out.
 * With `store`, each box is the token's **footprint** (FR-SHELL-57: its cells at the current
 * camera, computed from the record's size, never from the node's children, so the name label and
 * badges don't count); a token the store lacks falls back to the node's client rect.
 */
export function tokenScreenBoxes(
  tokenIds: readonly string[] | "all",
  store?: RecordStore,
): TokenBox[] {
  if (tokenIds.length === 0 || typeof window === "undefined") return [];
  const K = (window as unknown as { Konva?: { stages: KonvaStage[] } }).Konva;
  const stage = K?.stages.find((s) => s.container().isConnected);
  if (!stage) return [];
  const box = stage.container().getBoundingClientRect();
  const want = tokenIds === "all" ? null : new Set(tokenIds);
  return stage
    .find(".map-token")
    .filter((n) => want === null || want.has(n.id()))
    .map((n) => {
      const side = store ? footprintSide(store, n.id()) : null;
      if (side !== null) {
        const f = screenFootprint(box, n.getAbsolutePosition(), n.getAbsoluteScale().x, side);
        return { ...f, id: n.id() };
      }
      const r = n.getClientRect();
      return { x: box.left + r.x, y: box.top + r.y, w: r.width, h: r.height, id: n.id() };
    });
}
