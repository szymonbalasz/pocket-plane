// Client-only state of the DM's combat dialogs: the attack popup (card id, and where it was opened
// from) and the damage / heal dialog (combatant id). Popup edits and its dragged position live in
// the popup's own state (lost on close and reload; CBT §8, FR-CBT-76).
import { create } from "zustand";
import { setMapSelection } from "../scenes-map/selection";

/** FR-CBT-75: the notification toast / row the popup was opened from, viewport px. */
export interface PopupOrigin {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface CombatDialogs {
  cardId: string | null;
  /** Null: placed per FR-CBT-55/56 (Pending row, own attack). */
  origin: PopupOrigin | null;
  /** Bumped per open, so reopening the same card places it again. */
  openSeq: number;
  hpCombatantId: string | null;
  openCard(id: string, origin?: PopupOrigin | null): void;
  closeCard(): void;
  openHp(combatantId: string): void;
  closeHp(): void;
}

export const useCombatDialogs = create<CombatDialogs>((set, get) => ({
  cardId: null,
  origin: null,
  openSeq: 0,
  hpCombatantId: null,
  openCard: (cardId, origin = null) => {
    // Another card over an open popup: that popup closes, and so do its targets (below).
    if (get().cardId !== null) setMapSelection([]);
    set((s) => ({ cardId, origin, openSeq: s.openSeq + 1 }));
  },
  // FR-CBT-54 (sim-5 glitch 1): the popup's selection rows are the map selection, so every close
  // (Apply, Dismiss, Later, Esc, the card resolved elsewhere) clears it: the next card's popup
  // opens with the selection the DM makes for it, never this one's leftovers.
  closeCard: () => {
    if (get().cardId !== null) setMapSelection([]);
    set({ cardId: null, origin: null });
  },
  openHp: (hpCombatantId) => set({ hpCombatantId }),
  closeHp: () => set({ hpCombatantId: null }),
}));
