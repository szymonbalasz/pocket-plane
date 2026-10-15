// FR-SCN-15 prop undo (DM, client only): per scene, the last 50 prop edits made in this tab.
// Undo sends the inverse intent: place ↔ delete, the previous fields, the previous hidden flag, or
// re-placing a deleted prop. A re-place's `ack {propId}` remaps the old id in older entries, so
// undo chains keep working. A rejected inverse drops its entry (the caller shows a Toast). Lost
// on reload. Pure reducer + a small store; DOM-free so it runs under `bun test`.
import {
  SCN_INTENTS,
  type ScenePropRecord,
  type UpdatePropInput,
} from "@shared/scene-tools/schemas";
import { create } from "zustand";

/** FR-SCN-15: entries kept per scene. */
export const UNDO_MAX = 50;

/** Prop fields `scn.updateProp` sets, as they were before an edit. */
export type PropFieldsBefore = Omit<UpdatePropInput, "propId">;

export type PropUndoEntry =
  /** A placed or duplicated prop: undo deletes it. */
  | { op: "place"; propId: string }
  /** An `scn.updateProp`: undo restores the previous values of the fields it changed. */
  | { op: "update"; propId: string; prev: PropFieldsBefore }
  /** An `scn.setPropHidden`: undo restores the previous flag. */
  | { op: "hidden"; propId: string; prev: boolean }
  /** A deleted prop (its full DM record): undo places it again. */
  | { op: "delete"; prev: ScenePropRecord };

export type UndoStacks = Readonly<Record<string, readonly PropUndoEntry[]>>;

export const entryPropId = (e: PropUndoEntry): string => (e.op === "delete" ? e.prev.id : e.propId);

/** Pushes onto the scene's stack, dropping the oldest past `UNDO_MAX`. */
export function pushUndo(s: UndoStacks, sceneId: string, e: PropUndoEntry): UndoStacks {
  const next = [...(s[sceneId] ?? []), e];
  return { ...s, [sceneId]: next.slice(-UNDO_MAX) };
}

/** The scene's latest entry and the stacks without it. */
export function popUndo(
  s: UndoStacks,
  sceneId: string,
): { entry: PropUndoEntry | null; stacks: UndoStacks } {
  const stack = s[sceneId] ?? [];
  const entry = stack.at(-1) ?? null;
  if (!entry) return { entry: null, stacks: s };
  return { entry, stacks: { ...s, [sceneId]: stack.slice(0, -1) } };
}

/** FR-SCN-15: a re-placed prop got a new id; older entries follow it. */
export function remapProp(s: UndoStacks, from: string, to: string): UndoStacks {
  const out: Record<string, readonly PropUndoEntry[]> = {};
  for (const [sceneId, stack] of Object.entries(s)) {
    out[sceneId] = stack.map((e) => {
      if (entryPropId(e) !== from) return e;
      return e.op === "delete" ? { ...e, prev: { ...e.prev, id: to } } : { ...e, propId: to };
    });
  }
  return out;
}

export interface IntentCall {
  name: string;
  input: Record<string, unknown>;
}

/**
 * The inverse intent of an entry. A re-placed prop's rotation, z and lock come back with a
 * follow-up `scn.updateProp` (`restore`), sent once the re-place's ack names the new id.
 */
export function inverseOf(e: PropUndoEntry): {
  call: IntentCall;
  restore?: (propId: string) => IntentCall | null;
} {
  switch (e.op) {
    case "place":
      return { call: { name: SCN_INTENTS.deleteProp, input: { propId: e.propId } } };
    case "update":
      return { call: { name: SCN_INTENTS.updateProp, input: { propId: e.propId, ...e.prev } } };
    case "hidden":
      return {
        call: { name: SCN_INTENTS.setPropHidden, input: { propId: e.propId, hidden: e.prev } },
      };
    case "delete": {
      const p = e.prev;
      return {
        call: {
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
        },
        restore: (propId) =>
          p.rotation === 0 && p.z === 0 && !p.locked
            ? null
            : {
                name: SCN_INTENTS.updateProp,
                input: { propId, rotation: p.rotation, z: p.z, locked: p.locked },
              },
      };
    }
  }
}

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

// ---------- store + runner ----------

export const usePropUndo = create<{ stacks: UndoStacks }>(() => ({ stacks: {} }));

export function recordUndo(sceneId: string, e: PropUndoEntry): void {
  usePropUndo.setState((s) => ({ stacks: pushUndo(s.stacks, sceneId, e) }));
}

export type Send = (name: string, input: unknown) => Promise<unknown>;

/**
 * Undoes the scene's latest prop edit. Resolves `"empty"`, `"done"`, or rejects with the inverse's
 * error after dropping the entry (show it with `toastReject`).
 */
export async function undoLast(send: Send, sceneId: string): Promise<"empty" | "done"> {
  const { entry, stacks } = popUndo(usePropUndo.getState().stacks, sceneId);
  if (!entry) return "empty";
  usePropUndo.setState({ stacks });
  const inv = inverseOf(entry);
  const ack = (await send(inv.call.name, inv.call.input)) as { propId?: string } | undefined;
  if (inv.restore && ack?.propId) {
    usePropUndo.setState((s) => ({
      stacks: remapProp(s.stacks, entryPropId(entry), ack.propId as string),
    }));
    const follow = inv.restore(ack.propId);
    if (follow) await send(follow.name, follow.input);
  }
  return "done";
}
