// FR-DICE-106: the `dice.details` window's picked line: one entry id that the window follows, set
// by the row menu and a double-click. Client memory only. Like `focus.ts`, the window's companion
// does the opening, so the call works whether the window is open, minimised or closed.
import { useEffect, useSyncExternalStore } from "react";
import { createStore } from "zustand";
import { useOpenWindow } from "../play-shell/ShellContext";

export const DICE_DETAILS_KIND = "dice.details";

export interface RollDetailsState {
  entryId: string | null;
  /** Bumped per pick: the companion opens / fronts the window on a change. */
  seq: number;
}

export const rollDetails = createStore<RollDetailsState>()(() => ({ entryId: null, seq: 0 }));

/** FR-DICE-106: open, restore and front the details window on this entry. */
export function openRollDetails(entryId: string): void {
  rollDetails.setState((s) => ({ entryId, seq: s.seq + 1 }));
}

export function useRollDetails<T>(select: (s: RollDetailsState) => T): T {
  return useSyncExternalStore(
    rollDetails.subscribe,
    () => select(rollDetails.getState()),
    () => select(rollDetails.getState()),
  );
}

/** `dice.details` companion: mounted while the kind is available, open or not. */
export function RollDetailsRuntime() {
  const open = useOpenWindow();
  const seq = useRollDetails((s) => s.seq);
  useEffect(() => {
    if (seq > 0) open(DICE_DETAILS_KIND);
  }, [seq, open]);
  return null;
}
