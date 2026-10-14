// Client-only state of the DM's combat-extras dialogs (Effect…, Concentration…, Temp HP…, Set
// death saves…, Add…), opened from Initiative rows, chips and the token menu. Dialog edits live
// in the dialogs' own state (CBTX §8: client memory).
import type { TargetRef } from "@shared/combat-extras/intents";
import { create } from "zustand";

export interface Target {
  ref: TargetRef;
  name: string;
}

interface CbtxDialogs {
  /** Effect dialog: new effect on `targets`, or edit of `editId`. */
  effect: { targets: Target[]; editId?: string } | null;
  concentration: Target | null;
  temp: Target[] | null;
  deathSet: { characterId: string; name: string } | null;
  add: boolean;
  openEffect(targets: Target[], editId?: string): void;
  openConcentration(t: Target): void;
  openTemp(ts: Target[]): void;
  openDeathSet(characterId: string, name: string): void;
  openAdd(): void;
  close(): void;
}

export const useCbtxDialogs = create<CbtxDialogs>((set) => ({
  effect: null,
  concentration: null,
  temp: null,
  deathSet: null,
  add: false,
  openEffect: (targets, editId) => set({ effect: { targets, editId } }),
  openConcentration: (concentration) => set({ concentration }),
  openTemp: (temp) => set({ temp }),
  openDeathSet: (characterId, name) => set({ deathSet: { characterId, name } }),
  openAdd: () => set({ add: true }),
  close: () => set({ effect: null, concentration: null, temp: null, deathSet: null, add: false }),
}));
