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
} from "@shared/scene-tools/schemas";
import type { StructureView } from "./structure-view";
import type { UndoStep } from "./undo";
import { recordUndo, type Send, scnUndo, type UndoStore } from "./undo-store";

/** FR-SCN-08 Wall: one polyline. Undo removes the segments that were new (n ≥ the old nextN). */
export async function addWallsEdit(
  send: Send,
  sceneId: string,
  view: StructureView,
  segments: Segment[],
  undo: UndoStore = scnUndo,
): Promise<number[]> {
  const nextN = view.full?.nextN ?? 1;
  const { ns } = AddWallsResult.parse(await send(SCN_INTENTS.addWalls, { sceneId, segments }));
  const added = [...new Set(ns.filter((n) => n >= nextN))];
  if (added.length > 0) {
    recordUndo(
      { sceneId, steps: [{ name: SCN_INTENTS.removeSegments, input: { sceneId, ns: added } }] },
      undo,
    );
  }
  return ns;
}

/** FR-SCN-08 Door: two clicks → one closed door. Undo removes it. */
export async function addDoorEdit(
  send: Send,
  sceneId: string,
  segment: Segment,
  state: DoorState = DOOR_CLOSED,
  undo: UndoStore = scnUndo,
): Promise<number> {
  const { n } = AddDoorResult.parse(await send(SCN_INTENTS.addDoor, { sceneId, segment, state }));
  recordUndo(
    { sceneId, steps: [{ name: SCN_INTENTS.removeSegments, input: { sceneId, ns: [n] } }] },
    undo,
  );
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
 * `scn.addWalls`, each door with its state); the acks remap the old `n`s.
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
  const steps: UndoStep[] = [];
  if (walls.length > 0) {
    steps.push({
      name: SCN_INTENTS.addWalls,
      input: { sceneId, segments: walls.map((w) => [w[1], w[2], w[3], w[4]]) },
      recreates: { ns: walls.map((w) => w[0]) },
    });
  }
  for (const d of doors) {
    steps.push({
      name: SCN_INTENTS.addDoor,
      input: { sceneId, segment: d.seg, state: d.state },
      recreates: { ns: [d.n] },
    });
  }
  recordUndo({ sceneId, steps }, undo);
}
