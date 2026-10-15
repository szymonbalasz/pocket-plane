// FR-SCN-15 drawing undo (DM, client only): per scene, the last 50 edits made in this tab. Generic:
// an entry is the ordered inverse intents of one edit. If the first inverse re-creates a record
// (re-placing a deleted prop, re-adding erased segments), its `ack` names the new id(s): `remap`
// rewrites the old id(s) at that input key in the entry's later steps and in every older entry, so
// undo chains keep working. A rejected inverse drops its entry (the caller shows a Toast). Lost on
// reload. Props build their entries with `propUndo` below; structure folds in the same way.
// Pure reducer + a small store; DOM-free so it runs under `bun test`.
import {
  SCN_INTENTS,
  type ScenePropRecord,
  type UpdatePropInput,
} from "@shared/scene-tools/schemas";
import { create } from "zustand";

/** FR-SCN-15: entries kept per scene. */
export const UNDO_MAX = 50;

type Id = string | number;

export interface UndoStep {
  name: string;
  input: Record<string, unknown>;
}

export interface UndoEntry {
  /** Inverse intents, sent in order. */
  steps: UndoStep[];
  /**
   * The first step re-creates `from` (ids or `n`s): its ack field `ackField` holds the new one(s),
   * same order. Every input value at `key` (scalar or array element) equal to an old id is
   * rewritten, in this entry's later steps and in older entries.
   */
  remap?: { ackField: string; key: string; from: Id[] };
}

export type UndoStacks = Readonly<Record<string, readonly UndoEntry[]>>;

/** Pushes onto the scene's stack, dropping the oldest past `UNDO_MAX`. */
export function pushUndo(s: UndoStacks, sceneId: string, e: UndoEntry): UndoStacks {
  const next = [...(s[sceneId] ?? []), e];
  return { ...s, [sceneId]: next.slice(-UNDO_MAX) };
}

/** The scene's latest entry and the stacks without it. */
export function popUndo(
  s: UndoStacks,
  sceneId: string,
): { entry: UndoEntry | null; stacks: UndoStacks } {
  const stack = s[sceneId] ?? [];
  const entry = stack.at(-1) ?? null;
  if (!entry) return { entry: null, stacks: s };
  return { entry, stacks: { ...s, [sceneId]: stack.slice(0, -1) } };
}

function remapStep(step: UndoStep, key: string, map: ReadonlyMap<Id, Id>): UndoStep {
  if (!(key in step.input)) return step;
  const v = step.input[key];
  const swap = (x: unknown) => (map.has(x as Id) ? map.get(x as Id) : x);
  const next = Array.isArray(v) ? v.map(swap) : swap(v);
  return { ...step, input: { ...step.input, [key]: next } };
}

function remapEntry(e: UndoEntry, key: string, map: ReadonlyMap<Id, Id>): UndoEntry {
  const steps = e.steps.map((s) => remapStep(s, key, map));
  const remap =
    e.remap && e.remap.key === key
      ? { ...e.remap, from: e.remap.from.map((x) => map.get(x) ?? x) }
      : e.remap;
  return remap ? { steps, remap } : { steps };
}

/** FR-SCN-15: re-created records got new ids; every entry follows them. */
export function remapIds(s: UndoStacks, key: string, map: ReadonlyMap<Id, Id>): UndoStacks {
  const out: Record<string, readonly UndoEntry[]> = {};
  for (const [sceneId, stack] of Object.entries(s)) {
    out[sceneId] = stack.map((e) => remapEntry(e, key, map));
  }
  return out;
}

/** Old → new ids from a re-create's ack (`ack[ackField]`: one id or a list, same order). */
export function remapOf(entry: UndoEntry, ack: unknown): Map<Id, Id> | null {
  if (!entry.remap) return null;
  const got = (ack as Record<string, unknown> | undefined)?.[entry.remap.ackField];
  const next = Array.isArray(got) ? got : got === undefined ? [] : [got];
  if (next.length !== entry.remap.from.length) return null;
  return new Map(entry.remap.from.map((old, i) => [old, next[i] as Id]));
}

// ---------- store + runner ----------

export const useUndoStacks = create<{ stacks: UndoStacks }>(() => ({ stacks: {} }));

export function recordUndo(sceneId: string, e: UndoEntry): void {
  useUndoStacks.setState((s) => ({ stacks: pushUndo(s.stacks, sceneId, e) }));
}

export type Send = (name: string, input: unknown) => Promise<unknown>;

/**
 * Undoes the scene's latest edit: sends its steps in order, remapping after the first. Resolves
 * `"empty"` or `"done"`; rejects with the inverse's error after dropping the entry (show it with
 * `toastReject`).
 */
export async function undoLast(send: Send, sceneId: string): Promise<"empty" | "done"> {
  const { entry, stacks } = popUndo(useUndoStacks.getState().stacks, sceneId);
  if (!entry) return "empty";
  useUndoStacks.setState({ stacks });
  let steps = entry.steps;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i] as UndoStep;
    const ack = await send(step.name, step.input);
    if (i > 0 || !entry.remap) continue;
    const map = remapOf(entry, ack);
    if (!map) continue;
    const key = entry.remap.key;
    useUndoStacks.setState((s) => ({ stacks: remapIds(s.stacks, key, map) }));
    steps = steps.map((s) => remapStep(s, key, map));
  }
  return "done";
}

// ---------- prop entries (FR-SCN-15: place ↔ delete, previous fields, hidden flag, re-place) ----------

/** Prop fields `scn.updateProp` sets, as they were before an edit. */
export type PropFieldsBefore = Omit<UpdatePropInput, "propId">;

export const propUndo = {
  /** A placed or duplicated prop: undo deletes it. */
  place: (propId: string): UndoEntry => ({
    steps: [{ name: SCN_INTENTS.deleteProp, input: { propId } }],
  }),
  /** An `scn.updateProp`: undo restores the previous values of the fields it changed. */
  update: (propId: string, prev: PropFieldsBefore): UndoEntry => ({
    steps: [{ name: SCN_INTENTS.updateProp, input: { propId, ...prev } }],
  }),
  /** An `scn.setPropHidden`: undo restores the previous flag. */
  hidden: (propId: string, prev: boolean): UndoEntry => ({
    steps: [{ name: SCN_INTENTS.setPropHidden, input: { propId, hidden: prev } }],
  }),
  /** A deleted prop: undo places it again, then restores rotation, z and lock if not default. */
  delete: (p: ScenePropRecord): UndoEntry => {
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
      },
    ];
    if (p.rotation !== 0 || p.z !== 0 || p.locked) {
      steps.push({
        name: SCN_INTENTS.updateProp,
        input: { propId: p.id, rotation: p.rotation, z: p.z, locked: p.locked },
      });
    }
    return { steps, remap: { ackField: "propId", key: "propId", from: [p.id] } };
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
