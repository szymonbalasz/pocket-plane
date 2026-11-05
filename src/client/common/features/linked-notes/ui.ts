// The Notes window's client state outside its components (eager, tiny): the open note, and a
// "New note" request from the palette (NOTES §7). FR-SHELL-200: a close resets it.
import { createStore } from "zustand";

export interface NotesUi {
  /** The note shown in the editor, or null. */
  selected: string | null;
  /** Bumped by the palette's "New note": the window opens its New note dialog. */
  newRequest: number;
  select(id: string | null): void;
  requestNew(): void;
  reset(): void;
}

export const notesUi = createStore<NotesUi>()((set) => ({
  selected: null,
  newRequest: 0,
  select: (id) => set({ selected: id }),
  requestNew: () => set((s) => ({ newRequest: s.newRequest + 1 })),
  reset: () => set({ selected: null }),
}));
