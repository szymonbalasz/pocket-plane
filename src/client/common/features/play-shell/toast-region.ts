// The client's one toast region (FR-SHELL-01, #153): players bottom-right; the DM top-centre
// below the top bar, clear of the right-edge Initiative rows. Two stacks share it: the
// notifications stack (`note-toasts`, its own element) and the sonner Toaster (alerts, errors).
// The Toaster sits next to the notifications stack, never under it, so both stay visible.
import { EDGE_GAP, LAUNCHER_CLEAR, TITLE_H, TOP_BAR_H } from "./geometry";
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
