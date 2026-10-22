// Chrome keep-out registry (FR-SHELL-113, seams S2 / S16, ADR-0060 §7). APPEND-ONLY (AGENTS §9.9):
// a feature that wants a strip or a pinned panel over the map adds one entry to
// `CHROME_KEEP_OUTS` instead of special-casing the placer. A shown entry is a hard keep-out (the
// placer treats it like a window; its showing and going fire `push` / `return`), and a fit obstacle
// iff `fitObstacle` (read by the map's fit, `chromeFitObstacles`). At most a 64-px strip or a
// 360 × 240 box; the session-replay harness must pass at 1280×720 with it shown.
import type { RecordStore } from "@shared/protocol/store";
import type { Rect, Viewport } from "./geometry";
import type { KeepOut } from "./keep-outs";
import type { ShellClient } from "./registry";

export interface ChromeKeepOut {
  id: string;
  clients: readonly ShellClient[];
  /** Where it shows in this viewport, from the synced store; null = not shown. */
  rect: (vp: Viewport, store: RecordStore) => Rect | null;
  /** Also an obstacle for the map's fit (FR-MAP-93). */
  fitObstacle: boolean;
}

/** The chrome keep-outs (append yours). */
export const CHROME_KEEP_OUTS: readonly ChromeKeepOut[] = [];

/** FR-SHELL-113's size bound: a strip ≤ 64 px thick, or a box ≤ 360 × 240. */
export const chromeFits = (r: Rect) => Math.min(r.w, r.h) <= 64 || (r.w <= 360 && r.h <= 240);

/** This client's shown entries as hard keep-out regions (id = the entry's). */
export function chromeKeepOuts(
  client: ShellClient,
  vp: Viewport,
  store: RecordStore | undefined,
  list: readonly ChromeKeepOut[] = CHROME_KEEP_OUTS,
): KeepOut[] {
  if (!store) return [];
  const out: KeepOut[] = [];
  for (const c of list) {
    if (!c.clients.includes(client)) continue;
    let r: Rect | null = null;
    try {
      r = c.rect(vp, store);
    } catch (err) {
      console.warn(`chrome keep-out ${c.id}: rect() threw`, err);
    }
    if (r) out.push({ id: c.id, rect: { x: r.x, y: r.y, w: r.w, h: r.h }, kind: "hard" });
  }
  return out;
}

/** The shown entries the map's fit must avoid too (`fitObstacle`). */
export function chromeFitObstacles(
  client: ShellClient,
  vp: Viewport,
  store: RecordStore | undefined,
  list: readonly ChromeKeepOut[] = CHROME_KEEP_OUTS,
): Rect[] {
  const fit = new Set(list.filter((c) => c.fitObstacle).map((c) => c.id));
  return chromeKeepOuts(client, vp, store, list)
    .filter((k) => fit.has(k.id))
    .map((k) => k.rect);
}
