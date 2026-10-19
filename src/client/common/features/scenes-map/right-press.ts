// FR-MAP-71 right-press routing (both clients), DOM-free so it runs under `bun test`. A button-2
// press over the canvas, in order: (1) a door / prop node menu (the node sets `cancelBubble`, so the
// stage never sees it); not live → nothing (FR-MAP-28); (2) a token: DM → the token menu on the
// release (FR-MAP-18); player → only a layer menu hit there, else nothing (no laser, FR-MAP-24);
// (3) the active drawing tool's `pointer.menu` (FR-FOG-42); (4) the first layer `contextMenu` that
// hits (FR-SCN-51) → deferred: release < 4 px opens it, ≥ 4 px starts the laser from the press
// point; (5) else the laser at once. The laser needs `signalsLive`; the menu only `live`.
import type { CanvasClient } from "./layers";
import { isClick } from "./selection-logic";

export interface RightPressInput {
  client: CanvasClient;
  live: boolean;
  /** Ping / pull / laser on (DM: the viewed scene is the active one, FR-MAP-08) and live. */
  signalsLive: boolean;
  /** A door / prop node took the press (`cancelBubble`, FR-SCN-09 / -17). */
  nodeMenu: boolean;
  onToken: boolean;
  /** The active drawing tool's `pointer.menu` took it (FR-FOG-42). */
  toolMenu: boolean;
  /** A layer `contextMenu.hit` is true at the press point (FR-SCN-51). */
  layerHit: boolean;
}

export type RightPress =
  | { kind: "none" }
  | { kind: "node-menu" }
  | { kind: "token-menu" }
  | { kind: "tool-menu" }
  /** Wait for the release (< 4 px → the layer menu) or a drag (≥ 4 px → laser, when `laser`). */
  | { kind: "deferred"; laser: boolean }
  | { kind: "laser" };

/** FR-MAP-71: what a right press does, in the built order plus step (4). */
export function rightPress(s: RightPressInput): RightPress {
  if (s.nodeMenu) return { kind: "node-menu" };
  if (!s.live) return { kind: "none" };
  if (s.onToken) {
    if (s.client === "dm") return { kind: "token-menu" };
    return s.layerHit ? { kind: "deferred", laser: false } : { kind: "none" };
  }
  if (s.toolMenu) return { kind: "tool-menu" };
  if (s.layerHit) return { kind: "deferred", laser: s.signalsLive };
  return s.signalsLive ? { kind: "laser" } : { kind: "none" };
}

/**
 * FR-MAP-71 step (4): a deferred press after the pointer moved by (dx, dy) screen px: still a
 * click (`menu`), or ≥ 4 px: the laser from the press point when allowed, else nothing.
 */
export function deferredMove(laser: boolean, dx: number, dy: number): "menu" | "laser" | "none" {
  if (isClick(dx, dy)) return "menu";
  return laser ? "laser" : "none";
}
