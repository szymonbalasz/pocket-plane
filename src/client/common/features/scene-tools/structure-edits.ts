// DM structure edits from the tool, the door menu and double-click (FR-SCN-08, -09): each sends
// one intent and, once acked, records its inverse for undo (FR-SCN-15). The server validates and
// wins; a reject rejects the promise (the caller toasts). No feature logic beyond the inverse.
import {
  AddDoorResult,
  AddWallsResult,
  DOOR_CLOSED,
  type DoorState,
  SCN_INTENTS,
  type Segment,
  type Wall,
  type WallKind,
} from "@shared/scene-tools/schemas";
import type { StructureView } from "./structure-view";
import type { UndoStep } from "./undo";
import { recordUndo, type Send, scnUndo, type UndoStore } from "./undo-store";

/**
 * The steps that re-add walls as they were, one `scn.addWalls` per kind: never `replace`, so they
 * can't cut what they land on, and each kind dedupes only against itself (FR-SCN-07).
 */
function restoreWalls(sceneId: string, walls: readonly Wall[]): UndoStep[] {
  return [...new Set(walls.map((w) => w[5]))].map((kind) => {
    const same = walls.filter((w) => w[5] === kind);
    return {
      name: SCN_INTENTS.addWalls,
      input: {
        sceneId,
        segments: same.map((w) => [w[1], w[2], w[3], w[4]]),
        ...(kind === undefined ? {} : { kind }),
      },
      recreates: { ns: same.map((w) => w[0]) },
    };
  });
}

/**
 * FR-SCN-08 Wall, FR-SCN-57 Window / One-way: one polyline. Undo removes the segments that were
 * new (n ≥ the old nextN). FR-SCN-58: a polyline that replaced wall gets that wall back first, so
 * the scene is never open between the steps.
 */
export async function addWallsEdit(
  send: Send,
  sceneId: string,
  view: StructureView,
  segments: Segment[],
  undo: UndoStore = scnUndo,
  kind?: WallKind,
): Promise<number[]> {
  const nextN = view.full?.nextN ?? 1;
  const {
    ns,
    replaced = [],
    pieces = [],
  } = AddWallsResult.parse(
    await send(SCN_INTENTS.addWalls, {
      sceneId,
      segments,
      replace: true,
      ...(kind === undefined ? {} : { kind }),
    }),
  );
  const added = [...new Set(ns.filter((n) => n >= nextN))];
  if (added.length > 0) {
    recordUndo(
      {
        sceneId,
        steps: [
          ...restoreWalls(sceneId, replaced),
          { name: SCN_INTENTS.removeSegments, input: { sceneId, ns: [...added, ...pieces] } },
        ],
      },
      undo,
    );
  }
  return ns;
}

/** FR-SCN-59: reverses one-way walls. Undo reverses them again. */
export async function flipEdit(
  send: Send,
  sceneId: string,
  ns: number[],
  undo: UndoStore = scnUndo,
): Promise<void> {
  if (ns.length === 0) return;
  await send(SCN_INTENTS.flipWalls, { sceneId, ns });
  recordUndo({ sceneId, steps: [{ name: SCN_INTENTS.flipWalls, input: { sceneId, ns } }] }, undo);
}

/**
 * FR-SCN-08 Door: two clicks → one closed door. Undo removes it. FR-SCN-56: a door that replaced
 * wall gets that wall back first, so the scene is never open between the two steps.
 */
export async function addDoorEdit(
  send: Send,
  sceneId: string,
  segment: Segment,
  state: DoorState = DOOR_CLOSED,
  undo: UndoStore = scnUndo,
): Promise<number> {
  const {
    n,
    replaced = [],
    pieces = [],
  } = AddDoorResult.parse(await send(SCN_INTENTS.addDoor, { sceneId, segment, state }));
  const steps = restoreWalls(sceneId, replaced);
  steps.push({ name: SCN_INTENTS.removeSegments, input: { sceneId, ns: [n, ...pieces] } });
  recordUndo({ sceneId, steps }, undo);
  return n;
}

/** FR-SCN-09: a door's state. Undo restores the previous one. */
export async function setDoorEdit(
  send: Send,
  sceneId: string,
  n: number,
  prev: DoorState,
  state: DoorState,
  undo: UndoStore = scnUndo,
): Promise<void> {
  if (prev === state) return;
  await send(SCN_INTENTS.setDoor, { sceneId, n, state });
  recordUndo(
    { sceneId, steps: [{ name: SCN_INTENTS.setDoor, input: { sceneId, n, state: prev } }] },
    undo,
  );
}

/**
 * FR-SCN-08 Erase / door menu Delete. Undo re-adds them with the same coordinates (walls in one
 * `scn.addWalls` per kind, each door with its state); the acks remap the old `n`s.
 */
export async function removeEdit(
  send: Send,
  sceneId: string,
  view: StructureView,
  ns: number[],
  undo: UndoStore = scnUndo,
): Promise<void> {
  if (ns.length === 0) return;
  const gone = new Set(ns);
  const walls = view.walls.filter((w) => gone.has(w[0]));
  const doors = view.doors.filter((d) => gone.has(d.n));
  await send(SCN_INTENTS.removeSegments, { sceneId, ns: [...gone] });
  const steps = restoreWalls(sceneId, walls);
  for (const d of doors) {
    steps.push({
      name: SCN_INTENTS.addDoor,
      input: { sceneId, segment: d.seg, state: d.state },
      recreates: { ns: [d.n] },
    });
  }
  recordUndo({ sceneId, steps }, undo);
}
