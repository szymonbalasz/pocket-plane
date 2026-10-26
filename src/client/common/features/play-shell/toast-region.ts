// The client's one toast region (FR-SHELL-01, #153): players bottom-right; the DM top-centre
// below the top bar, clear of the right-edge Initiative rows. Two stacks share it: the
// notifications stack (`note-toasts`, its own element) and the sonner Toaster (alerts, errors).
// The Toaster sits next to the notifications stack, never under it, so both stay visible.
import { EDGE_GAP, LAUNCHER_CLEAR, type Rect, TITLE_H, TOP_BAR_H } from "./geometry";
import type { ShellClient } from "./registry";

/** The notifications stack's element; its edge offsets match `NOTE_EDGE` / the DM top. */
export const NOTE_STACK_SELECTOR = '[data-testid="note-toasts"]';
/** The notifications stack's distance from the right edge (player). */
export const NOTE_EDGE = 16;
/** Gap between the two stacks (the notifications stack's own gap). */
export const STACK_GAP = 8;
/**
 * The player stack's distance from the bottom edge: the work area's bottom gap + the stack gap
 * (20 px; the launcher sits in the top bar, FR-KIT-14).
 */
export const PLAYER_TOAST_BOTTOM = LAUNCHER_CLEAR + STACK_GAP;
/** DM stack top: below the title bars of top-anchored windows, so their controls stay clickable. */
export const DM_TOAST_TOP = TOP_BAR_H + EDGE_GAP + TITLE_H + STACK_GAP;

export interface ToastRegion {
  position: "top-center" | "bottom-right";
  offset: { top?: number; right?: number; bottom?: number };
}

/** Sonner placement for `client`, given the notifications stack's current height (0 = none). */
export function toastRegion(client: ShellClient, noteStackH: number): ToastRegion {
  const after = noteStackH > 0 ? noteStackH + STACK_GAP : 0;
  return client === "dm"
    ? { position: "top-center", offset: { top: DM_TOAST_TOP + after } }
    : {
        position: "bottom-right",
        offset: { right: NOTE_EDGE, bottom: PLAYER_TOAST_BOTTOM + after },
      };
}

/**
 * Where the roll-popup stack starts (FR-DICEX-39, seams S7): the region's third stack, beyond
 * the notifications and alert stacks so neither moves. Players: above both, bottom-right; the
 * DM: below both, top-centre (the stack keeps clear of Initiative itself, FR-NOTE-32's rule).
 */
export function popupRegion(
  client: ShellClient,
  noteStackH: number,
  alertStackH: number,
): { top: number } | { right: number; bottom: number } {
  const after = (h: number) => (h > 0 ? h + STACK_GAP : 0);
  const beyond = after(noteStackH) + after(alertStackH);
  return client === "dm"
    ? { top: DM_TOAST_TOP + beyond }
    : { right: NOTE_EDGE, bottom: PLAYER_TOAST_BOTTOM + beyond };
}

// ---- keep-out box (FR-SHELL-40, -48, -49; seams S2, S7) ----
// Sizes for the region's stacks: one toast and one roll popup (FR-SHELL-49, #256). Auto placement
// reads only `toastKeepOut` (through `keep-outs.ts`); W1 owns these constants (seams S2). The popup
// UI sizes itself from `ROLL_POPUP_W` / `ROLL_POPUP_H` / `ROLL_POPUPS_MAX`, so box and cards never
// drift.

/** Toasts the box holds: one (a second, 286 px, would end the player's sheet at 370, §12). */
export const KEEP_OUT_TOASTS = 1;
/** One compact toast card, px. */
export const KEEP_OUT_TOAST_H = 40;
/** One roll popup (FR-DICEX-46/47, seams S2): dice in a line at full size. */
export const ROLL_POPUP_W = 320;
export const ROLL_POPUP_H = 190;
/** FR-DICEX-39: at most this many roll popups at once (the oldest closes). */
export const ROLL_POPUPS_MAX = 3;
/** Widest stack in the region: sonner's toasts (356 px; notifications `w-80`, popup 320). */
export const KEEP_OUT_W = Math.max(356, ROLL_POPUP_W);
/**
 * Roll popups the box holds: one. A taller stack grows past the box while it lasts (transient,
 * 6 s); the DM's top-centre stack keeps clear of Initiative as built (FR-NOTE-32).
 */
export const KEEP_OUT_POPUPS = 1;

/** Height of the box: the toasts, then the popups, `STACK_GAP` between any two cards (238). */
export const KEEP_OUT_H =
  KEEP_OUT_TOASTS * KEEP_OUT_TOAST_H +
  KEEP_OUT_POPUPS * ROLL_POPUP_H +
  (KEEP_OUT_TOASTS + KEEP_OUT_POPUPS - 1) * STACK_GAP;

/**
 * Where this client's toasts and roll popups go, in viewport px (FR-SHELL-49): players
 * bottom-right, 20 px above the bottom edge (vw − 372, vh − 258), the DM top-centre below the top bar and
 * window title bars ((vw − 356) / 2, 100); 356 × 238 both. Auto-placed windows keep out of it
 * (players: hard, DM: soft; FR-SHELL-48) and the fit frames no token under it (FR-MAP-59).
 */
export function toastKeepOut(client: ShellClient, vp: { w: number; h: number }): Rect {
  return client === "dm"
    ? { x: Math.round((vp.w - KEEP_OUT_W) / 2), y: DM_TOAST_TOP, w: KEEP_OUT_W, h: KEEP_OUT_H }
    : {
        x: vp.w - NOTE_EDGE - KEEP_OUT_W,
        y: vp.h - PLAYER_TOAST_BOTTOM - KEEP_OUT_H,
        w: KEEP_OUT_W,
        h: KEEP_OUT_H,
      };
}

// ---- the DM's shown stack (FR-SHELL-59; OQ-MAP-57 D, #288) ----
// The Fit keeps the summary strip and whatever shows clear, not the whole empty box (FR-MAP-80).
// Reporters (notifications' toast stack, the DM roll-popup stack) call `reportShownStack` with
// their rendered rect; client memory only.

/** The DM stack's home strip: one summary card (FR-NOTE-42), centred at the region's top. */
export const SUMMARY_STRIP_W = 320;
export const SUMMARY_STRIP_H = 57;

/** The summary strip at the DM stack's home, viewport px (an obstacle for the Fit under D). */
export function summaryStrip(vp: { w: number; h: number }): Rect {
  return {
    x: Math.round((vp.w - SUMMARY_STRIP_W) / 2),
    y: DM_TOAST_TOP,
    w: SUMMARY_STRIP_W,
    h: SUMMARY_STRIP_H,
  };
}

let shown: ReadonlyMap<string, Rect> = new Map();
const shownListeners = new Set<() => void>();

const sameRect = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/**
 * A DM stack reports its rendered rect (viewport px) while something shows, null when empty.
 * Same rect again → no change.
 */
export function reportShownStack(id: string, rect: Rect | null): void {
  const cur = shown.get(id);
  if (rect === null ? cur === undefined : cur && sameRect(cur, rect)) return;
  const next = new Map(shown);
  if (rect === null) next.delete(id);
  else next.set(id, { x: rect.x, y: rect.y, w: rect.w, h: rect.h });
  shown = next;
  for (const fn of [...shownListeners]) fn();
}

/** The reported rects so far (a new Map on every change). */
export function shownStacks(): ReadonlyMap<string, Rect> {
  return shown;
}

/**
 * The bounding box of the DM's rendered toasts and roll popups now (FR-SHELL-59), null when none
 * shows. Players: always null (they keep their corner box).
 */
export function shownStack(
  client: ShellClient,
  reports: ReadonlyMap<string, Rect> = shown,
): Rect | null {
  if (client !== "dm" || reports.size === 0) return null;
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const r of reports.values()) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Subscribe to shown-stack reports (`useSyncExternalStore`). */
export function subscribeShownStack(fn: () => void): () => void {
  shownListeners.add(fn);
  return () => {
    shownListeners.delete(fn);
  };
}
