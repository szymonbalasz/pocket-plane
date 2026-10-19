// FR-DICEX-48 (§6.1 table C; ADR-0051 Previews): the tray's 3D stills, pure (no three). Each
// redraw renders a temporary arena on the page's one canvas, copies it into the tray's own 2D
// canvas and removes it **in the same task**; while a throw's loop runs it waits for the loop's
// next frame. Never a lasting arena on the dice layer (`addStillArena` is the look editor's).
import type { DieShape } from "@shared/dice-extras/throw";
import {
  defaultLabels,
  geometryOf,
  LABEL_VALUES,
  type LabelKind,
  multiply,
  normalize,
  type Quat,
  rotationBetween,
  type Vec3,
} from "./geometry";

/** The face a still shows: the highest (d20 → 20); a d100's tens "00" and units "0". */
export const topValue = (kind: LabelKind): number =>
  kind === "d10-tens" || kind === "d10-units" ? 0 : Math.max(...LABEL_VALUES[kind]);

/** A quarter-ish turn about +Y so the die reads as a solid (as the look editor's die). */
const TURN: Quat = [0, Math.sin(0.35), 0, Math.cos(0.35)];

/** Default labels and the pose with `topValue` up (d4: its vertex; others: its face). */
export function stillPose(shape: DieShape, kind: LabelKind): { labels: number[]; q: Quat } {
  const g = geometryOf(shape);
  const labels = defaultLabels(g, kind);
  const i = labels.indexOf(topValue(kind));
  const up = shape === "d4" ? normalize(g.vertices[i] as Vec3) : (g.normals[i] as Vec3);
  return { labels, q: multiply(TURN, rotationBetween(up, [0, 1, 0])) };
}

/** The parts of the shared stage a still needs. */
export interface StillStage {
  /** A throw's render loop is running. */
  looping: boolean;
  lost: boolean;
  /** Redraws waiting for the loop's next frame, one per target (a newer one replaces it). */
  stills: Map<object, () => void>;
}

/** Run `job` now (no loop: this task), else on the loop's next frame. Throws on a lost context. */
export function requestStill(stage: StillStage, key: object, job: () => void): void {
  if (stage.lost) throw new Error("Dice: WebGL context lost");
  if (stage.looping) {
    stage.stills.set(key, job);
    return;
  }
  stage.stills.delete(key);
  job();
}

/** The loop's frame (or any draw of the shared canvas): run the waiting redraws. */
export function flushStills(stage: StillStage): void {
  if (stage.stills.size === 0) return;
  const jobs = [...stage.stills.values()];
  stage.stills.clear();
  for (const job of jobs) job();
}

export const cancelStill = (stage: StillStage, key: object) => stage.stills.delete(key);

/** One redraw's steps on the shared canvas. */
export interface StillOps<A> {
  /** Add the temporary arena. */
  add(): A;
  /** Render it alone (its box cleared first). */
  draw(arena: A): void;
  /** Copy its pixels into the tray's 2D canvas (same task: the drawing buffer still holds them). */
  copy(arena: A): void;
  remove(arena: A): void;
  /** Draw the shared canvas again without it. */
  restore(): void;
}

/** Add → draw → copy → remove → restore, all in this one task. */
export function stillOnce<A>(ops: StillOps<A>): void {
  const arena = ops.add();
  try {
    ops.draw(arena);
    ops.copy(arena);
  } finally {
    ops.remove(arena);
    ops.restore();
  }
}
