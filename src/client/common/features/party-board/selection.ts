// What the `party.handout` viewer shows (FR-PARTY-14): client state only, never sent. One store
// per page; the board's rows, the notification's "Open" and the DM's "New handout" set it, then
// open the window.
import { createStore } from "zustand";

export type ViewerMode = "view" | "edit" | "new";

export interface HandoutSelection {
  handoutId: string | null;
  mode: ViewerMode;
}

export const handoutSelection = createStore<HandoutSelection>(() => ({
  handoutId: null,
  mode: "view",
}));

export function selectHandout(handoutId: string, mode: Exclude<ViewerMode, "new"> = "view") {
  handoutSelection.setState({ handoutId, mode });
}

/** DM: the viewer opens on an empty editor (FR-PARTY-15); Cancel returns to the last handout. */
export function startNewHandout() {
  handoutSelection.setState({ mode: "new" });
}
