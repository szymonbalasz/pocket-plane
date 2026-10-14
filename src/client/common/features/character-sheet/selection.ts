// Which creature the `char.sheet` window shows (client memory only, CHARX §8): the picker's
// selection, the NPC sheet the DM last opened (FR-CHARX-31) and a pending "open in edit mode"
// (a just-created character, FR-CHARX-30). One store per page.
import { createStore } from "zustand";

export interface SheetSelection {
  selectedId: string | null;
  /** DM: the definition last opened via Creatures → Sheet (picker keeps it). */
  npcId: string | null;
  /** Open this creature in edit mode once it is in the store (with the creation hint). */
  editId: string | null;
}

export const sheetSelection = createStore<SheetSelection>(() => ({
  selectedId: null,
  npcId: null,
  editId: null,
}));

export const selectSheet = (id: string) => sheetSelection.setState({ selectedId: id });

/** Creatures → Sheet (DM): show that definition / character. */
export function openSheetFor(id: string, kind: "character" | "monster") {
  sheetSelection.setState(kind === "monster" ? { selectedId: id, npcId: id } : { selectedId: id });
}

export const requestEdit = (id: string) => sheetSelection.setState({ selectedId: id, editId: id });
export const clearEditRequest = () => sheetSelection.setState({ editId: null });
