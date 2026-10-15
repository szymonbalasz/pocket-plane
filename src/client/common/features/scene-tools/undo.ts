// FR-SCN-15 drawing undo (DM, client only; OQ-SCN-08): per scene, the last 50 structure and prop
// edits made in this tab, as the inverse intents to send. Each inverse step that re-creates
// something (a re-added wall or door, a re-placed prop) learns its new `n` / id from the `ack` and
// **remaps** the old one in the rest of the stack, so undo chains keep working. A rejected
// inverse drops its entry. Lost on reload. Pure (the store and the sender live in `undo-store.ts`).
// Props (build/scene-tools-props) push their own entries with the same shape (`propId` refs,
// `recreates: {propId}`).
import { AddDoorResult, AddWallsResult } from "@shared/scene-tools/schemas";
import { z } from "zod";

/** FR-SCN-15: entries kept per scene. */
export const UNDO_MAX = 50;

/** What an inverse step's ack re-creates, by the old refs it replaces. */
export type Recreates = { ns: number[] } | { propId: string };

/** One inverse intent. Refs the remap rewrites: `n`, `ns` (segments), `propId` (props). */
export interface UndoStep {
  name: string;
  input: Record<string, unknown>;
  recreates?: Recreates;
}

export interface UndoEntry {
  sceneId: string;
  /** Sent in order; a reject stops the rest. */
  steps: UndoStep[];
}

export type UndoStacks = Readonly<Record<string, readonly UndoEntry[]>>;

export interface Remap {
  ns: Map<number, number>;
  ids: Map<string, string>;
}

export const emptyRemap = (): Remap => ({ ns: new Map(), ids: new Map() });

/** Pushes an entry onto its scene's stack, dropping the oldest past `UNDO_MAX`. */
export function pushUndo(stacks: UndoStacks, e: UndoEntry): UndoStacks {
  const s = [...(stacks[e.sceneId] ?? []), e];
  return { ...stacks, [e.sceneId]: s.slice(-UNDO_MAX) };
}

/** The scene's latest entry and the stacks without it (null when nothing to undo). */
export function popUndo(
  stacks: UndoStacks,
  sceneId: string,
): { entry: UndoEntry; stacks: UndoStacks } | null {
  const s = stacks[sceneId] ?? [];
  const entry = s.at(-1);
  if (!entry) return null;
  return { entry, stacks: { ...stacks, [sceneId]: s.slice(0, -1) } };
}

const PropAck = z.object({ propId: z.string() });

/** What a step's ack remaps: old refs → the re-created ones (empty when the ack doesn't parse). */
export function remapOf(step: UndoStep, ack: unknown): Remap {
  const r = emptyRemap();
  const c = step.recreates;
  if (!c) return r;
  if ("propId" in c) {
    const a = PropAck.safeParse(ack);
    if (a.success && a.data.propId !== c.propId) r.ids.set(c.propId, a.data.propId);
    return r;
  }
  const walls = AddWallsResult.safeParse(ack);
  const door = AddDoorResult.safeParse(ack);
  const got = walls.success ? walls.data.ns : door.success ? [door.data.n] : [];
  c.ns.forEach((old, i) => {
    const now = got[i];
    if (now !== undefined && now !== old) r.ns.set(old, now);
  });
  return r;
}

const mapN = (r: Remap, v: unknown) => (typeof v === "number" ? (r.ns.get(v) ?? v) : v);
const mapId = (r: Remap, v: unknown) => (typeof v === "string" ? (r.ids.get(v) ?? v) : v);

/** A step with its refs rewritten. */
export function remapStep(step: UndoStep, r: Remap): UndoStep {
  if (r.ns.size === 0 && r.ids.size === 0) return step;
  const input = { ...step.input };
  if ("n" in input) input.n = mapN(r, input.n);
  if (Array.isArray(input.ns)) input.ns = input.ns.map((v) => mapN(r, v));
  if ("propId" in input) input.propId = mapId(r, input.propId);
  const c = step.recreates;
  const recreates: Recreates | undefined = !c
    ? undefined
    : "propId" in c
      ? { propId: mapId(r, c.propId) as string }
      : { ns: c.ns.map((v) => mapN(r, v) as number) };
  return recreates ? { ...step, input, recreates } : { ...step, input };
}

/** Rewrites every entry of one scene's stack (the entries older than the one being undone). */
export function remapStacks(stacks: UndoStacks, sceneId: string, r: Remap): UndoStacks {
  if (r.ns.size === 0 && r.ids.size === 0) return stacks;
  const s = stacks[sceneId];
  if (!s) return stacks;
  return {
    ...stacks,
    [sceneId]: s.map((e) => ({ ...e, steps: e.steps.map((st) => remapStep(st, r)) })),
  };
}
