// FR-SCN-15 undo store and runner (DM tab memory; survives a reconnect, not a reload). Edits push
// entries with `recordUndo`; `undoLast` pops the scene's latest, sends its inverse steps in order
// and remaps refs from each ack; a reject drops the entry (the caller toasts). One undo at a time.
import { createStore, type StoreApi, useStore } from "zustand";
import {
  popUndo,
  pushUndo,
  remapOf,
  remapStacks,
  remapStep,
  type UndoEntry,
  type UndoStacks,
} from "./undo";

export interface UndoState {
  stacks: UndoStacks;
  /** An undo is in flight (the button and Ctrl+Z wait). */
  busy: boolean;
}

export type UndoStore = StoreApi<UndoState>;

export const createUndoStore = (): UndoStore =>
  createStore<UndoState>()(() => ({ stacks: {}, busy: false }));

/** This tab's stacks (one DM canvas per tab). */
export const scnUndo = createUndoStore();

export function recordUndo(e: UndoEntry, store: UndoStore = scnUndo): void {
  if (e.steps.length === 0) return;
  store.setState((s) => ({ stacks: pushUndo(s.stacks, e) }));
}

export type Send = (name: string, input: unknown) => Promise<unknown>;

/**
 * Undoes the scene's latest entry: `undone` (every step acked), `rejected` (a step was refused:
 * the entry is gone, `onReject` got the error), `empty` or `busy`.
 */
export async function undoLast(
  send: Send,
  sceneId: string,
  onReject: (err: unknown) => void,
  store: UndoStore = scnUndo,
): Promise<"undone" | "rejected" | "empty" | "busy"> {
  if (store.getState().busy) return "busy";
  const popped = popUndo(store.getState().stacks, sceneId);
  if (!popped) return "empty";
  store.setState({ stacks: popped.stacks, busy: true });
  let steps = popped.entry.steps;
  try {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (!step) break;
      let ack: unknown;
      try {
        ack = await send(step.name, step.input);
      } catch (err) {
        onReject(err);
        return "rejected";
      }
      const r = remapOf(step, ack);
      steps = steps.map((s, j) => (j > i ? remapStep(s, r) : s));
      store.setState((s) => ({ stacks: remapStacks(s.stacks, sceneId, r) }));
    }
    return "undone";
  } finally {
    store.setState({ busy: false });
  }
}

/** The number of entries the scene can undo (the Undo button's state). */
export function useUndoDepth(sceneId: string | null, store: UndoStore = scnUndo): number {
  return useStore(store, (s) => (sceneId ? (s.stacks[sceneId]?.length ?? 0) : 0));
}

export function useUndoBusy(store: UndoStore = scnUndo): boolean {
  return useStore(store, (s) => s.busy);
}
