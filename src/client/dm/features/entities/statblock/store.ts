// FR-KIT-100–102: the stat-block window's creature, in memory only (lost on reload, `restoreOpen:
// false`). Every opener records its target here and opens the one window (`ent.statblock:main`)
// with `by: "user"` (to front, restored if minimised); a launcher click shows the last creature.
import { useOpenWindow } from "@ui/features/play-shell/ShellContext";
import { useCallback } from "react";
import { create } from "zustand";
import { STATBLOCK_KIND, type StatBlockTarget } from "./logic";

interface StatBlockState {
  target: StatBlockTarget | null;
  show(target: StatBlockTarget): void;
}

export const useStatBlockTarget = create<StatBlockState>()((set) => ({
  target: null,
  show: (target) => set({ target }),
}));

/** Opens the stat block on `target` (FR-KIT-101): replaces the content, brings it to front. */
export function useOpenStatBlock(): (target: StatBlockTarget) => void {
  const open = useOpenWindow();
  return useCallback(
    (target: StatBlockTarget) => {
      useStatBlockTarget.getState().show(target);
      open(STATBLOCK_KIND, undefined, { by: "user" });
    },
    [open],
  );
}
