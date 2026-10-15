// Client-only state of the DM's effect-modifiers dialogs (MOD §7): the targets and preset an
// "Apply effect ▸" pick opened the apply dialog with. Dialog edits live in the dialogs' state.
import type { TargetRef } from "@shared/combat-extras/intents";
import type { PresetChoice } from "@shared/effect-modifiers/rules";
import { create } from "zustand";

export interface ModTarget {
  ref: TargetRef;
  name: string;
}

interface ModDialogs {
  apply: { targets: ModTarget[]; choice: PresetChoice } | null;
  openApply(targets: ModTarget[], choice: PresetChoice): void;
  close(): void;
}

export const useModDialogs = create<ModDialogs>((set) => ({
  apply: null,
  openApply: (targets, choice) => set({ apply: { targets, choice } }),
  close: () => set({ apply: null }),
}));
