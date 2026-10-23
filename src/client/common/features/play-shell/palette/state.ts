// What the palette overlay shows (client memory, one per page): the palette and its input, the
// shortcuts sheet. `openPalette(prefix?)` is the client API (play-shell §9).
import { createStore, useStore } from "zustand";

export interface PaletteUi {
  open: boolean;
  input: string;
  sheet: boolean;
}

export const paletteUi = createStore<PaletteUi>(() => ({ open: false, input: "", sheet: false }));

export const usePaletteUi = <T>(select: (s: PaletteUi) => T): T => useStore(paletteUi, select);

/** Opens the palette on `prefix` (`>` commands, `@` characters); the sheet closes. */
export function openPalette(prefix = ""): void {
  paletteUi.setState({ open: true, input: prefix, sheet: false });
}

export const closePalette = (): void => paletteUi.setState({ open: false });

/** A pick's run, waiting for the palette to be gone and focus back (`settleClose`). */
let pending: (() => void) | null = null;

/**
 * A pick: the palette closes now; `run` waits until the dialog has returned focus. Radix returns
 * focus in a timeout after the dialog unmounts, so a command run earlier loses what it opened to
 * that focus move (a Popover's outside-focus dismiss: the Pause… bug, walkthrough P9).
 */
export function closeThenRun(run: () => void): void {
  pending = run;
  closePalette();
}

/**
 * The dialog's close focus step: `restoreFocus` puts focus back, then the pending pick runs (a
 * command may move focus itself, e.g. Roll dice or a Popover).
 */
export function settleClose(restoreFocus: () => void): void {
  restoreFocus();
  const run = pending;
  pending = null;
  run?.();
}

/** FR-SHELL-180: Ctrl+K toggles. */
export const togglePalette = (): void =>
  paletteUi.getState().open ? closePalette() : openPalette();

export const setInput = (input: string): void => paletteUi.setState({ input });

export const openShortcuts = (): void => paletteUi.setState({ open: false, sheet: true });

export const closeShortcuts = (): void => paletteUi.setState({ sheet: false });
