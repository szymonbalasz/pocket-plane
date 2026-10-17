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

// ---- keep-out box (FR-SHELL-40, seams S7, review A11) ----
// Sizes for the region's three stacks: 3 toasts and the roll popups (DICEX §7). Auto placement
// reads only `toastKeepOut`; D7 (roll popup) owns these constants. The popup UI sizes itself from
// `ROLL_POPUP_W` / `ROLL_POPUP_H` / `ROLL_POPUPS_MAX`, so the box and the cards never drift.

/** Toasts the box holds. */
export const KEEP_OUT_TOASTS = 3;
/**
 * One compact toast card, px. Bounded by the default layouts: a box taller than 304 px reaches
 * the DM's `dice.log` at 1280×720 and the player's sheet at 900 px high, moving them.
 */
export const KEEP_OUT_TOAST_H = 40;
/** One roll popup (DICEX §7): 280 px wide, at most 160 px tall (rows beyond 2 scroll inside). */
export const ROLL_POPUP_W = 280;
export const ROLL_POPUP_H = 160;
/** FR-DICEX-39: at most this many roll popups at once (the oldest closes). */
export const ROLL_POPUPS_MAX = 3;
/** Widest stack in the region: sonner's toasts (356 px; notifications `w-80`, popup 280). */
export const KEEP_OUT_W = Math.max(356, ROLL_POPUP_W);
/**
 * Roll popups the box holds: one. The full stack (3 × 160 + gaps, 640 px with the toasts) moves
 * the default layouts (the DM's `dice.log` at 1280×720, the player's sheet at 900 px high), so
 * the 2nd and 3rd popup, transient (6 s), may overlap a window (D7 report, open issue).
 */
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
