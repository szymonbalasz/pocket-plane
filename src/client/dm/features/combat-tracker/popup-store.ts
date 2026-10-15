// Client-only state of the DM's combat dialogs: the attack popup (card id, and where it was opened
// from) and the damage / heal dialog (combatant id). Popup edits and its dragged position live in
// the popup's own state (lost on close and reload; CBT §8, FR-CBT-76).
import { create } from "zustand";

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

export const useCombatDialogs = create<CombatDialogs>((set) => ({
  cardId: null,
  origin: null,
  openSeq: 0,
  hpCombatantId: null,
  openCard: (cardId, origin = null) => set((s) => ({ cardId, origin, openSeq: s.openSeq + 1 })),
  closeCard: () => set({ cardId: null, origin: null }),
  openHp: (hpCombatantId) => set({ hpCombatantId }),
  closeHp: () => set({ hpCombatantId: null }),
}));
