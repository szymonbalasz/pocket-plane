// Tool bar home spot (FR-MAP-60, FR-FOG-58): the active tool's panel sits top-left, right of the
// rail, and wraps by control group within its max width; while shown it is the hard keep-out
// `map.toolbar` (FR-SHELL-48 (b)) and pushes windows off it (FR-SHELL-55). Pure.
import type { Rect, Viewport } from "../play-shell/geometry";
import { keepOuts } from "../play-shell/keep-outs";
import type { ShellClient } from "../play-shell/registry";

/** Keep-out id the tool bar reports while shown. */
export const TOOL_BAR_KEEP_OUT = "map.toolbar";
/** Widest a tool bar gets (FR-MAP-60). */
export const TOOL_BAR_MAX_W = 560;
/** Gap right of the rail and before a keep-out region in the top strip. */
export const TOOL_BAR_GAP = 8;
/** Marks a control group a tool bar never splits across rows (`data-rows` counts their rows). */
export const BAR_GROUP_ATTR = "data-bar-group";

/** The home spot in viewport px: right of the rail + 8, top-aligned with it (y 56). */
export function toolBarSpot(rail: { top: number; right: number }): { top: number; left: number } {
  return { top: Math.round(rail.top), left: Math.round(rail.right) + TOOL_BAR_GAP };
}

/**
 * Max width of a bar whose left edge is at `left` (FR-MAP-60): 560 px, or less to end 8 px before
 * a keep-out region in the top strip (the DM's top-centre toast box: 390 / 390 / 470 / 550 px at
 * 1280×720 / 1280×800 / 1440×900 / 1600×900). Only the client's own regions count, never the
 * bar's own report. Its one-row width is the third bound (CSS shrink-to-fit).
 */
export function toolBarMaxWidth(
  client: ShellClient,
  spot: { top: number; left: number },
  vp: Viewport,
): number {
  let room = TOOL_BAR_MAX_W;
  for (const { rect: r } of keepOuts(client, vp, new Map())) {
    const inTopStrip = r.y < vp.h / 2 && r.y + r.h > spot.top;
    if (!inTopStrip || r.x < spot.left) continue;
    room = Math.min(room, r.x - TOOL_BAR_GAP - spot.left);
  }
  return Math.max(0, Math.floor(room));
}

/** Rows a wrapped bar takes: distinct tops of its groups (± 2 px); at least 1. */
export function barRows(tops: readonly number[]): number {
  const rows: number[] = [];
  for (const t of tops) if (!rows.some((r) => Math.abs(r - t) <= 2)) rows.push(t);
  return Math.max(1, rows.length);
}

/** The bar's rect in viewport px: its own box and the parts hanging under it (union). */
export function barRect(boxes: readonly Rect[]): Rect | null {
  if (boxes.length === 0) return null;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  const bottom = Math.max(...boxes.map((b) => b.y + b.h));
  return {
    x: Math.floor(x),
    y: Math.floor(y),
    w: Math.ceil(right) - Math.floor(x),
    h: Math.ceil(bottom) - Math.floor(y),
  };
}
