// FR-DICEX-15 / -34 settle to result: simulate the whole throw headless in its arena first
// (cannon-es, no renderer; fixed 60 Hz, ≤ 150 steps), snap dice still moving (or cocked) at the
// end to their nearest resting pose, read each up-face and relabel so it carries the server
// value; the renderer then plays the recorded motion (no visible snap afterwards). The motion is
// cosmetic: seeded by the throw (hash of its first public entry id), never `ctx.dice`, so equal
// arenas show the same tumble. Dice enter from the arena's bottom edge and bounce off its walls.
import type { DieShape } from "@shared/dice-extras/throw";
import {
  Body,
  ContactMaterial,
  ConvexPolyhedron,
  Material,
  Plane,
  Quaternion,
  SAPBroadphase,
  Sphere,
  Vec3,
  World,
} from "cannon-es";
import type { Arena } from "../arena";
import {
  type DieGeometry,
  defaultLabels,
  geometryOf,
  type LabelKind,
  type Quat,
  relabel,
  restingPose,
  tilt,
  type Vec3 as V3,
} from "./geometry";

/** FR-DICEX-15: fixed step and the step budget (2.5 s). */
export const STEP_HZ = 60;
export const MAX_STEPS = 150;
/** The sprint-3 zone's arena (world units), for callers without a rect. */
export const DEFAULT_ARENA: Arena = { x: 6, z: 3.5 };
/** Frames blended into the snapped pose when a die is still moving at the budget's end. */
const SNAP_FRAMES = 12;
/** Dice resting further than this off flat (on another die, against a wall) snap too. */
const MAX_TILT = (12 * Math.PI) / 180;

/** Effective slow-down of a thrown die (world units / s²): sets the launch speed per arena. */
const DECEL = 20;
const MAX_SPEED = 50;

/** Per frame and die: position xyz + quaternion xyzw. */
export const POSE = 7;

export interface SimDie {
  shape: DieShape;
  kind: LabelKind;
}

export interface Simulation {
  dice: readonly SimDie[];
  /** Frames recorded (the first is the start pose), ≤ `MAX_STEPS` + 1. */
  frameCount: number;
  /** `frameCount × dice × POSE`. */
  frames: Float32Array;
  /** Physics steps run before every die slept (or the budget). */
  steps: number;
  /** Per die: snapped to a resting pose at the end. */
  snapped: boolean[];
  /** Per die: the final orientation (the last frame's). */
  final: Quat[];
}

/** FNV-1a: the throw seed from its first entry id. */
export function seedOf(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a small seeded PRNG in [0, 1). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Collision groups: hulls hit the floor and walls; dice hit each other as spheres (cheap, and a
// die never ends balanced on another's face).
const G_STATIC = 1;
const G_HULL = 2;
const G_SPHERE = 4;

function hullOf(g: DieGeometry) {
  return new ConvexPolyhedron({
    vertices: g.vertices.map((v) => new Vec3(v[0], v[1], v[2])),
    faces: g.faces,
  });
}

/** A random unit quaternion from three uniforms (Shoemake). */
function randomQuat(r: () => number): Quat {
  const u1 = r();
  const u2 = r() * 2 * Math.PI;
  const u3 = r() * 2 * Math.PI;
  const a = Math.sqrt(1 - u1);
  const b = Math.sqrt(u1);
  return [a * Math.sin(u2), a * Math.cos(u2), b * Math.sin(u3), b * Math.cos(u3)];
}

function nlerp(a: Quat, b: Quat, t: number): Quat {
  const s = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
  const q = [0, 1, 2, 3].map((i) => (a[i] as number) * (1 - t) + (b[i] as number) * s * t);
  const n = Math.hypot(...q);
  return q.map((x) => x / n) as unknown as Quat;
}

/** Run the throw's physics; deterministic for a seed, dice list and arena. */
export function simulate(
  dice: readonly SimDie[],
  seed: number,
  arena: Arena = DEFAULT_ARENA,
): Simulation {
  const r = prng(seed);
  const world = new World({ gravity: new Vec3(0, -60, 0), allowSleep: true });
  world.broadphase = new SAPBroadphase(world);
  const dieMat = new Material("die");
  const floorMat = new Material("floor");
  const wallMat = new Material("wall");
  world.addContactMaterial(
    new ContactMaterial(dieMat, floorMat, { friction: 0.35, restitution: 0.3 }),
  );
  world.addContactMaterial(
    new ContactMaterial(dieMat, wallMat, { friction: 0.1, restitution: 0.5 }),
  );
  world.addContactMaterial(
    new ContactMaterial(dieMat, dieMat, { friction: 0.1, restitution: 0.4 }),
  );

  const statics: [V3, V3, Material][] = [
    [[0, 0, 0], [0, 1, 0], floorMat],
    [[-arena.x, 0, 0], [1, 0, 0], wallMat],
    [[arena.x, 0, 0], [-1, 0, 0], wallMat],
    [[0, 0, -arena.z], [0, 0, 1], wallMat],
    [[0, 0, arena.z], [0, 0, -1], wallMat],
  ];
  for (const [p, n, material] of statics) {
    const body = new Body({ mass: 0, material, collisionFilterGroup: G_STATIC });
    body.addShape(new Plane());
    body.position.set(p[0], p[1], p[2]);
    // A cannon Plane faces +Z: turn it to face `n`.
    const q = new Quaternion();
    q.setFromVectors(new Vec3(0, 0, 1), new Vec3(n[0], n[1], n[2]));
    body.quaternion.copy(q);
    world.addBody(body);
  }

  // Dice enter from the bottom edge (+z is screen-down) in a loose grid, so no two start
  // overlapping, and fly up the screen fast enough to cross it and bounce off the far wall.
  const geos = dice.map((d) => geometryOf(d.shape));
  const gap = Math.min(1.6, (2 * arena.x - 1.6) / 4);
  const cx = (r() - 0.5) * Math.max(0, 2 * arena.x - 4 * gap - 2);
  const reach = Math.sqrt(2 * DECEL * 2 * arena.z);
  const bodies = geos.map((g, i) => {
    const body = new Body({
      mass: 1,
      material: dieMat,
      linearDamping: 0.12,
      angularDamping: 0.25,
      allowSleep: true,
      sleepSpeedLimit: 0.5,
      sleepTimeLimit: 0.15,
      collisionFilterGroup: G_HULL | G_SPHERE,
      collisionFilterMask: G_STATIC | G_HULL | G_SPHERE,
    });
    const hull = hullOf(g);
    hull.collisionFilterGroup = G_HULL;
    hull.collisionFilterMask = G_STATIC;
    const ball = new Sphere(g.radius * 0.9);
    ball.collisionFilterGroup = G_SPHERE;
    ball.collisionFilterMask = G_SPHERE;
    body.addShape(hull);
    body.addShape(ball);
    const col = i % 4;
    const row = Math.floor(i / 4) % 2;
    const layer = Math.floor(i / 8);
    body.position.set(
      cx + (col - 1.5) * gap + (r() - 0.5) * 0.3,
      1.4 + layer * 1.5 + r() * 0.5,
      Math.max(-arena.z + 1, arena.z - 1 - row * 1.5 - r() * 0.3),
    );
    const q = randomQuat(r);
    body.quaternion.set(q[0], q[1], q[2], q[3]);
    const speed = Math.min(MAX_SPEED, reach * (0.85 + r() * 0.35));
    body.velocity.set((r() - 0.5) * Math.min(arena.x, 8), 1 + r() * 3, -speed);
    body.angularVelocity.set((r() - 0.5) * 30, (r() - 0.5) * 30, (r() - 0.5) * 30);
    world.addBody(body);
    return body;
  });

  const n = dice.length;
  const frames = new Float32Array((MAX_STEPS + 1) * n * POSE);
  const record = (f: number) => {
    bodies.forEach((b, i) => {
      const o = (f * n + i) * POSE;
      frames.set(
        [
          b.position.x,
          b.position.y,
          b.position.z,
          b.quaternion.x,
          b.quaternion.y,
          b.quaternion.z,
          b.quaternion.w,
        ],
        o,
      );
    });
  };
  record(0);
  let steps = 0;
  while (steps < MAX_STEPS) {
    world.step(1 / STEP_HZ);
    steps += 1;
    record(steps);
    if (bodies.every((b) => b.sleepState === Body.SLEEPING)) break;
  }
  const frameCount = steps + 1;

  // Snap: a die still moving at the budget's end, or resting cocked, eases into its nearest
  // resting pose over the last frames (still within the budget).
  const snapped = bodies.map((b, i) => {
    const g = geos[i] as DieGeometry;
    const at = (f: number) => (f * n + i) * POSE;
    const last = at(frameCount - 1);
    const q = Array.from(frames.subarray(last + 3, last + 7)) as unknown as Quat;
    const moving = b.sleepState !== Body.SLEEPING;
    if (!moving && tilt(g, q) <= MAX_TILT) return false;
    const pose = restingPose(g, q);
    const from = Math.max(0, frameCount - 1 - SNAP_FRAMES);
    const start = Array.from(frames.subarray(at(from), at(from) + POSE));
    const end = [
      Math.min(arena.x - g.radius, Math.max(-arena.x + g.radius, frames[last] as number)),
      pose.y,
      Math.min(arena.z - g.radius, Math.max(-arena.z + g.radius, frames[last + 2] as number)),
    ];
    const q0 = start.slice(3) as unknown as Quat;
    for (let f = from + 1; f < frameCount; f++) {
      const t = (f - from) / (frameCount - 1 - from);
      const e = t * t * (3 - 2 * t);
      const p = [0, 1, 2].map((k) => (start[k] as number) * (1 - e) + (end[k] as number) * e);
      frames.set([...p, ...nlerp(q0, pose.q, e)], at(f));
    }
    return true;
  });

  const final = bodies.map((_, i) => {
    const o = ((frameCount - 1) * n + i) * POSE;
    const q = Array.from(frames.subarray(o + 3, o + 7));
    const len = Math.hypot(...q);
    return q.map((x) => x / len) as unknown as Quat;
  });
  return {
    dice,
    frameCount,
    frames: frames.subarray(0, frameCount * n * POSE),
    steps,
    snapped,
    final,
  };
}

/** FR-DICEX-15: each die's labels relabelled so its final up-face carries `values[i]`. */
export function settleLabels(sim: Simulation, values: readonly number[]): number[][] {
  return sim.dice.map((d, i) => {
    const g = geometryOf(d.shape);
    return relabel(g, defaultLabels(g, d.kind), sim.final[i] as Quat, values[i] as number);
  });
}

/** The pose of die `i` at fractional frame `f` (position lerp, quaternion nlerp). */
export function poseAt(sim: Simulation, i: number, f: number): { p: V3; q: Quat } {
  const n = sim.dice.length;
  const f0 = Math.max(0, Math.min(sim.frameCount - 1, Math.floor(f)));
  const f1 = Math.min(sim.frameCount - 1, f0 + 1);
  const t = Math.max(0, Math.min(1, f - f0));
  const a = (f0 * n + i) * POSE;
  const b = (f1 * n + i) * POSE;
  const fr = sim.frames;
  const p = [0, 1, 2].map(
    (k) => (fr[a + k] as number) * (1 - t) + (fr[b + k] as number) * t,
  ) as unknown as V3;
  const qa = Array.from(fr.subarray(a + 3, a + 7)) as unknown as Quat;
  const qb = Array.from(fr.subarray(b + 3, b + 7)) as unknown as Quat;
  return { p, q: nlerp(qa, qb, t) };
}
