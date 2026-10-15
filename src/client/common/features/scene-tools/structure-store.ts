// Client-only Structure tool state (FR-SCN-08): the mode, a polyline or door in progress, the
// hover vertex / segment and the erase box; plus what the shown canvas publishes for the tool's
// handlers (scene, structure, zoom, loaded) and the door menu. DOM-free.
import type { Vertex } from "@shared/scene-tools/geometry";
import type { DoorState } from "@shared/scene-tools/schemas";
import { createStore } from "zustand";
import { EMPTY_STRUCTURE, type PxBox, type StructureView } from "./structure-view";

export const STRUCTURE_MODES = ["wall", "door", "erase"] as const;
export type StructureMode = (typeof STRUCTURE_MODES)[number];

export interface StructureToolState {
  mode: StructureMode;
  /** Wall: the polyline so far; Door: the first click. */
  points: Vertex[];
  hover: Vertex | null;
  /** Erase: Ctrl / Shift-drag box, map px. */
  box: PxBox | null;
  /** Erase: the segment under the pointer. */
  hoverN: number | null;
}

const IDLE = { points: [], hover: null, box: null, hoverN: null };

export const structureTool = createStore<StructureToolState>()(() => ({ mode: "wall", ...IDLE }));

export function setStructureMode(mode: StructureMode): void {
  structureTool.setState({ mode, ...IDLE });
}

/** Drops a gesture in progress; true if there was one (Esc stops there, FR-SCN-06). */
export function resetStructureGesture(): boolean {
  const s = structureTool.getState();
  const had = s.points.length > 0 || s.box !== null;
  structureTool.setState(IDLE);
  return had;
}

/** What the shown DM canvas publishes for the tool's handlers (set by the structure layer). */
export interface ShownStructure {
  sceneId: string | null;
  view: StructureView;
  /** Camera scale: screen px per map px (erase tolerance is 8 screen px). */
  scale: number;
  /** The scene's rows are in the store (ADR-0041); tools wait until then. */
  loaded: boolean;
}

export const shownStructure = createStore<ShownStructure>()(() => ({
  sceneId: null,
  view: EMPTY_STRUCTURE,
  scale: 1,
  loaded: false,
}));

/** FR-SCN-09 door menu (right-click), screen px. */
export interface DoorMenuState {
  open: { sceneId: string; n: number; state: DoorState; at: { x: number; y: number } } | null;
}

export const doorMenu = createStore<DoorMenuState>()(() => ({ open: null }));
