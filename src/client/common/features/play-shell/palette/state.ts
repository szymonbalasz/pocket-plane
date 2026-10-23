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

/** FR-SHELL-180: Ctrl+K toggles. */
export const togglePalette = (): void =>
  paletteUi.getState().open ? closePalette() : openPalette();

export const setInput = (input: string): void => paletteUi.setState({ input });

export const openShortcuts = (): void => paletteUi.setState({ open: false, sheet: true });

export const closeShortcuts = (): void => paletteUi.setState({ sheet: false });
