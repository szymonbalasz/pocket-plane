// FR-SCN-15 prop entries on the ONE per-scene undo stack (`undo.ts` + `undo-store.ts`, shared with
// structure edits): place ↔ delete, the previous fields, the previous hidden flag, or re-placing a
// deleted prop (its `ack {propId}` remaps the old id in the entry's follow-up step and in every
// older entry, so undo chains keep working). A rejected inverse drops its entry (the caller shows
// a Toast). Lost on reload. DOM-free.
import {
  SCN_INTENTS,
  type ScenePropRecord,
  type UpdatePropInput,
} from "@shared/scene-tools/schemas";
import type { UndoStep } from "./undo";
import {
  recordUndo as recordShared,
  type Send,
  scnUndo,
  undoLast as undoShared,
} from "./undo-store";

export type { Send } from "./undo-store";

/** One prop edit's inverse steps (the scene comes with `recordUndo`). */
export interface PropUndo {
  steps: UndoStep[];
}

/** Records a prop edit's inverse on the scene's shared stack. */
export function recordUndo(sceneId: string, e: PropUndo): void {
  recordShared({ sceneId, steps: e.steps }, scnUndo);
}

/**
 * Undoes the scene's latest edit (prop or structure: one stack). Resolves `"empty"` or `"done"`;
 * rejects with the inverse's error after dropping the entry (show it with `toastReject`).
 */
export async function undoLast(send: Send, sceneId: string): Promise<"empty" | "done"> {
  let error: unknown = null;
  const r = await undoShared(send, sceneId, (e) => {
    error = e;
  });
  if (r === "rejected") throw error;
  return r === "undone" ? "done" : "empty";
}

/** Prop fields `scn.updateProp` sets, as they were before an edit. */
export type PropFieldsBefore = Omit<UpdatePropInput, "propId">;

export const propUndo = {
  /** A placed or duplicated prop: undo deletes it. */
  place: (propId: string): PropUndo => ({
    steps: [{ name: SCN_INTENTS.deleteProp, input: { propId } }],
  }),
  /** An `scn.updateProp`: undo restores the previous values of the fields it changed. */
  update: (propId: string, prev: PropFieldsBefore): PropUndo => ({
    steps: [{ name: SCN_INTENTS.updateProp, input: { propId, ...prev } }],
  }),
  /** An `scn.setPropHidden`: undo restores the previous flag. */
  hidden: (propId: string, prev: boolean): PropUndo => ({
    steps: [{ name: SCN_INTENTS.setPropHidden, input: { propId, hidden: prev } }],
  }),
  /** A deleted prop: undo places it again (new id), then restores rotation, z and lock if set. */
  delete: (p: ScenePropRecord): PropUndo => {
    const steps: UndoStep[] = [
      {
        name: SCN_INTENTS.placeProp,
        input: {
          sceneId: p.sceneId,
          assetId: p.assetId,
          col: p.col,
          row: p.row,
          w: p.w,
          h: p.h,
          hidden: p.hidden,
        },
        recreates: { propId: p.id },
      },
    ];
    if (p.rotation !== 0 || p.z !== 0 || p.locked) {
      steps.push({
        name: SCN_INTENTS.updateProp,
        input: { propId: p.id, rotation: p.rotation, z: p.z, locked: p.locked },
      });
    }
    return { steps };
  },
};

/** The fields an update changes, with their values before it (the inverse's input). */
export function prevFields(
  before: ScenePropRecord,
  change: PropFieldsBefore,
): PropFieldsBefore | null {
  const prev: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(change)) {
    if (v === undefined) continue;
    const old = before[k as keyof ScenePropRecord];
    if (old !== v) prev[k] = old;
  }
  return Object.keys(prev).length > 0 ? (prev as PropFieldsBefore) : null;
}
