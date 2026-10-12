// Client-only state of the DM's combat dialogs: the attack popup (card id) and the damage / heal
// dialog (combatant id). Popup edits live in the popup's own state (lost on reload; CBT §8).
import { create } from "zustand";

interface CombatDialogs {
  cardId: string | null;
  hpCombatantId: string | null;
  openCard(id: string): void;
  closeCard(): void;
  openHp(combatantId: string): void;
  closeHp(): void;
}

export const useCombatDialogs = create<CombatDialogs>((set) => ({
  cardId: null,
  hpCombatantId: null,
  openCard: (cardId) => set({ cardId }),
  closeCard: () => set({ cardId: null }),
  openHp: (hpCombatantId) => set({ hpCombatantId }),
  closeHp: () => set({ hpCombatantId: null }),
}));
