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
 * The player stack's distance from the bottom edge: above the launcher bar, so a toast never
 * covers a launcher button (a long launcher row reaches the bottom-right corner).
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

// ---- keep-out box (FR-SHELL-40, seams S7, review A11) ----
// Sizes for the region's three stacks at their fullest: 3 toasts and one roll popup (DICEX §7).
// Auto placement reads only `toastKeepOut`; D7 (roll popup) owns these constants and grows them.

/** Toasts the box holds. */
export const KEEP_OUT_TOASTS = 3;
/**
 * One compact toast card, px. Bounded by the default layouts: a box taller than 304 px reaches
 * the DM's `dice.log` at 1280×720 and the player's sheet at 900 px high, moving them.
 */
export const KEEP_OUT_TOAST_H = 40;
/** Widest stack in the region: sonner's toasts (356 px; notifications `w-80`, popup 280). */
export const KEEP_OUT_W = 356;
/** One roll popup at its max height (DICEX §7: 280 × 160). */
export const ROLL_POPUP_H = 160;
/** Roll popups the box holds. */
export const KEEP_OUT_POPUPS = 1;

/** Height of the box: the toasts, then the popups, `STACK_GAP` between any two cards. */
export const KEEP_OUT_H =
  KEEP_OUT_TOASTS * KEEP_OUT_TOAST_H +
  KEEP_OUT_POPUPS * ROLL_POPUP_H +
  (KEEP_OUT_TOASTS + KEEP_OUT_POPUPS - 1) * STACK_GAP;

/**
 * Where this client's toasts and roll popups go at their fullest, in viewport px: players
 * bottom-right above the launcher, the DM top-centre below the top bar and window title bars.
 * Auto-placed windows keep out of it (FR-SHELL-40).
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
