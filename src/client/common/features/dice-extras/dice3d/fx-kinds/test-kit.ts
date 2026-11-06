// FR-DICEX-106: helpers for the kinds' tests (fx-kinds/<kind>.test.ts); imported by tests only.
import { Mesh, MeshStandardMaterial } from "three";
import type { RichKind } from "../../die-fx";
import { type RichLayer, richLayer } from "../fx-rich";
import type { RichSim, SimDie } from "../fx-sim";
import type { RichKindDef } from "./kind";

export const DT = 1 / 60;

/** `n` dice flying along +x for `s` seconds through `sim`; returns their last positions. */
export function fly(sim: RichSim, n: number, s: number, flying = true): SimDie[] {
  let dice: SimDie[] = [];
  for (let t = 0; t < s; t += DT) {
    dice = Array.from({ length: n }, (_, k) => ({ x: t * 12, y: 0.7, z: k * 3, r: 0.65 }));
    sim.step(DT, dice, flying);
  }
  return dice;
}

/**
 * bun test has no DOM: a canvas whose 2D context is missing (the atlas stays blank). Returns the
 * undo: a stub left on globalThis breaks later files in the same process (sonner's CSS insert).
 */
export function stubCanvas(): () => void {
  const g = globalThis as { document?: unknown };
  if (g.document) return () => {};
  g.document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => null }),
  };
  return () => {
    delete g.document;
  };
}

/** A die mesh as the renderer makes it (its own standard material). */
export const dieMesh = (): Mesh =>
  new Mesh(undefined, new MeshStandardMaterial({ color: 0xffffff }));

/**
 * A layer for `n` dice of `kind` (its `def`), driven like the renderer drives it: `rollS` seconds
 * in flight, then `land()` and `afterS` seconds of landing. Returns the layer and its dice.
 */
export function runLayer(
  kind: RichKind,
  def: RichKindDef,
  o: { n?: number; rollS?: number; afterS?: number; seed?: number } = {},
): { layer: RichLayer; meshes: Mesh[] } {
  const unstub = stubCanvas();
  const meshes = Array.from({ length: o.n ?? 1 }, dieMesh);
  const layer = richLayer(
    meshes.map((mesh) => ({ mesh, kind, def, radius: 0.65 })),
    o.seed ?? 1,
  );
  unstub();
  if (!layer) throw new Error("no layer");
  const rollS = o.rollS ?? 0.5;
  let t = 0;
  for (; t < rollS; t += DT) layer.update(t, t / rollS, 50);
  if (o.afterS !== undefined) {
    layer.land();
    const end = t + o.afterS;
    for (; t <= end; t += DT) layer.update(t, 1, 50);
  }
  return { layer, meshes };
}
