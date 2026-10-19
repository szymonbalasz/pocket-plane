// Die meshes and faces (FR-DICEX-14, -15). Pure: no renderer, no physics. One geometry per shape
// (d4, d6, d8, d10, d12, d20; a d100 is two d10s), labels per face (d4: per vertex), and the
// up-face rule: d4 = the label at the top vertex, others = the face whose normal is nearest +Y.
import type { DieShape } from "@shared/dice-extras/throw";

export type Vec3 = readonly [number, number, number];
/** Unit quaternion `[x, y, z, w]`. */
export type Quat = readonly [number, number, number, number];

export interface DieGeometry {
  shape: DieShape;
  vertices: Vec3[];
  /** Vertex indices per face, counter-clockwise seen from outside. */
  faces: number[][];
  /** Outward unit normal per face. */
  normals: Vec3[];
  /** Centre → face plane distance per face (the resting height on that face). */
  inradius: number[];
  /** Centre → farthest vertex. */
  radius: number;
}

/** Label sets: the values a die's faces carry (d4: its vertices). */
export type LabelKind = "d4" | "d6" | "d8" | "d10" | "d10-tens" | "d10-units" | "d12" | "d20";

const range = (from: number, n: number, step = 1) =>
  Array.from({ length: n }, (_, i) => from + i * step);

export const LABEL_VALUES: Record<LabelKind, readonly number[]> = {
  d4: range(1, 4),
  d6: range(1, 6),
  d8: range(1, 8),
  d10: range(1, 10),
  "d10-tens": range(0, 10, 10),
  "d10-units": range(0, 10),
  d12: range(1, 12),
  d20: range(1, 20),
};

/** The text a label shows: d100 tens "00"–"90", everything else the number. */
export const labelText = (kind: LabelKind, value: number) =>
  kind === "d10-tens" ? String(value).padStart(2, "0") : String(value);

// --- vector math ---------------------------------------------------------------------------

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: Vec3) => Math.sqrt(dot(a, a));
export const normalize = (a: Vec3): Vec3 => scale(a, 1 / (length(a) || 1));

/** `q · v · q⁻¹` */
export function rotate(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  const u: Vec3 = [x, y, z];
  const t = scale(cross(u, v), 2);
  return add(add(v, scale(t, w)), cross(u, t));
}

/** `a · b` (apply b, then a). */
export function multiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** The shortest rotation taking unit `from` onto unit `to`. */
export function rotationBetween(from: Vec3, to: Vec3): Quat {
  const d = dot(from, to);
  if (d < -0.999999) {
    // Opposite: any axis perpendicular to `from`.
    const axis = normalize(
      Math.abs(from[0]) < 0.9 ? cross([1, 0, 0], from) : cross([0, 1, 0], from),
    );
    return [axis[0], axis[1], axis[2], 0];
  }
  const c = cross(from, to);
  const q: Quat = [c[0], c[1], c[2], 1 + d];
  const n = Math.hypot(...q);
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

// --- solids --------------------------------------------------------------------------------

const PHI = (1 + Math.sqrt(5)) / 2;

/** Faces from outward normal directions: per normal, the vertices farthest along it, in order. */
function facesFromNormals(vertices: Vec3[], normals: Vec3[]): number[][] {
  return normals.map((n0) => {
    const n = normalize(n0);
    const d = Math.max(...vertices.map((v) => dot(v, n)));
    const idx = vertices.map((v, i) => [dot(v, n), i] as const).filter(([x]) => d - x < 1e-6);
    return orderCcw(
      vertices,
      idx.map(([, i]) => i),
      n,
    );
  });
}

/** Sort a face's vertices counter-clockwise around `n` (seen from outside). */
function orderCcw(vertices: Vec3[], idx: number[], n: Vec3): number[] {
  const c = scale(
    idx.reduce<Vec3>((s, i) => add(s, vertices[i] as Vec3), [0, 0, 0]),
    1 / idx.length,
  );
  const u = normalize(sub(vertices[idx[0] as number] as Vec3, c));
  const v = cross(n, u);
  const angle = (i: number) => {
    const p = sub(vertices[i] as Vec3, c);
    return Math.atan2(dot(p, v), dot(p, u));
  };
  return [...idx].sort((a, b) => angle(a) - angle(b));
}

function build(shape: DieShape, vertices0: Vec3[], faces: number[][], size: number): DieGeometry {
  const r0 = Math.max(...vertices0.map(length));
  const vertices = vertices0.map((v) => scale(v, size / r0));
  const normals = faces.map((f) => {
    const [a, b, c] = f.map((i) => vertices[i] as Vec3) as [Vec3, Vec3, Vec3];
    return normalize(cross(sub(b, a), sub(c, a)));
  });
  const inradius = faces.map((f, i) => dot(vertices[f[0] as number] as Vec3, normals[i] as Vec3));
  return { shape, vertices, faces, normals, inradius, radius: size };
}

/** Circumradius per shape, in world units (die sizes roughly like a real set). */
const SIZE: Record<DieShape, number> = {
  d4: 0.78,
  d6: 0.62,
  d8: 0.68,
  d10: 0.66,
  d12: 0.66,
  d20: 0.68,
};

function d4(): DieGeometry {
  const v: Vec3[] = [
    [1, 1, 1],
    [-1, -1, 1],
    [-1, 1, -1],
    [1, -1, -1],
  ];
  // Face i is opposite vertex i.
  return build(
    "d4",
    v,
    facesFromNormals(
      v,
      v.map((p) => scale(p, -1)),
    ),
    SIZE.d4,
  );
}

function d6(): DieGeometry {
  const v: Vec3[] = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) v.push([x, y, z]);
  const n: Vec3[] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];
  return build("d6", v, facesFromNormals(v, n), SIZE.d6);
}

function d8(): DieGeometry {
  const v: Vec3[] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];
  const n: Vec3[] = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) n.push([x, y, z]);
  return build("d8", v, facesFromNormals(v, n), SIZE.d8);
}

/** (0, ±1, ±φ) and its cyclic permutations: the icosahedron's vertices. */
function icosaPoints(): Vec3[] {
  const out: Vec3[] = [];
  for (const a of [-1, 1]) for (const b of [-PHI, PHI]) out.push([0, a, b], [a, b, 0], [b, 0, a]);
  return out;
}

/** (±1, ±1, ±1), (0, ±φ, ±1/φ) cyclic: the dodecahedron dual to `icosaPoints`. */
function dodecaPoints(): Vec3[] {
  const out: Vec3[] = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) out.push([x, y, z]);
  for (const a of [-PHI, PHI])
    for (const b of [-1 / PHI, 1 / PHI]) out.push([0, a, b], [a, b, 0], [b, 0, a]);
  return out;
}

const d12 = () =>
  build("d12", dodecaPoints(), facesFromNormals(dodecaPoints(), icosaPoints()), SIZE.d12);
const d20 = () =>
  build("d20", icosaPoints(), facesFromNormals(icosaPoints(), dodecaPoints()), SIZE.d20);

/**
 * Pentagonal trapezohedron: apexes T (0) / B (1), upper ring U_i at 72i°, lower ring L_i at
 * 72i + 36°, heights ±a. Kites T U_i L_i U_i+1 and B L_i U_i+1 L_i+1 are planar when
 * h = a (1 + cos 36°) / (1 − cos 36°). The apex is each face's first vertex (labels point at it).
 */
function d10(): DieGeometry {
  const a = 0.105;
  const c36 = Math.cos(Math.PI / 5);
  const h = (a * (1 + c36)) / (1 - c36);
  const v: Vec3[] = [
    [0, h, 0],
    [0, -h, 0],
  ];
  const at = (deg: number, y: number): Vec3 => [
    Math.cos((deg * Math.PI) / 180),
    y,
    Math.sin((deg * Math.PI) / 180),
  ];
  for (let i = 0; i < 5; i++) v.push(at(72 * i, a)); // U_i = 2 + i
  for (let i = 0; i < 5; i++) v.push(at(72 * i + 36, -a)); // L_i = 7 + i
  const U = (i: number) => 2 + (i % 5);
  const L = (i: number) => 7 + (i % 5);
  const faces: number[][] = [];
  for (let i = 0; i < 5; i++) faces.push([0, U(i), L(i), U(i + 1)]);
  for (let i = 0; i < 5; i++) faces.push([1, L(i), U(i + 1), L(i + 1)]);
  // Orient each kite outward (keep the apex first).
  const oriented = faces.map((f) => {
    const [p, q, r] = f.map((i) => v[i] as Vec3) as [Vec3, Vec3, Vec3];
    const n = cross(sub(q, p), sub(r, p));
    const centre = scale(
      f.reduce<Vec3>((s, i) => add(s, v[i] as Vec3), [0, 0, 0]),
      1 / 4,
    );
    return dot(n, centre) >= 0 ? f : [f[0] as number, ...f.slice(1).reverse()];
  });
  return build("d10", v, oriented, SIZE.d10);
}

const BUILDERS: Record<DieShape, () => DieGeometry> = { d4, d6, d8, d10, d12, d20 };
const cache = new Map<DieShape, DieGeometry>();

export function geometryOf(shape: DieShape): DieGeometry {
  let g = cache.get(shape);
  if (!g) {
    g = BUILDERS[shape]();
    cache.set(shape, g);
  }
  return g;
}

export const labelKindOf = (shape: DieShape, d100?: "tens" | "units"): LabelKind =>
  d100 === "tens" ? "d10-tens" : d100 === "units" ? "d10-units" : shape;

/**
 * Starting labels per face (d4: per vertex). Opposite faces pair up as on a real die (sum to
 * the first + last value); the d4 numbers its vertices in order.
 */
export function defaultLabels(g: DieGeometry, kind: LabelKind): number[] {
  const values = LABEL_VALUES[kind];
  if (g.shape === "d4") return [...values];
  const labels: number[] = new Array(g.faces.length).fill(Number.NaN);
  let lo = 0;
  let hi = values.length - 1;
  for (let i = 0; i < g.faces.length; i++) {
    if (!Number.isNaN(labels[i] as number)) continue;
    const n = g.normals[i] as Vec3;
    let opp = -1;
    let best = 2;
    g.normals.forEach((m, j) => {
      const d = dot(n, m);
      if (j !== i && Number.isNaN(labels[j] as number) && d < best) {
        best = d;
        opp = j;
      }
    });
    labels[i] = values[lo++] as number;
    if (opp >= 0) labels[opp] = values[hi--] as number;
  }
  return labels;
}

/** The index carrying the up label: d4 = the top vertex; others = the face normal nearest +Y. */
export function upIndex(g: DieGeometry, q: Quat): number {
  const points = g.shape === "d4" ? g.vertices : g.normals;
  let best = -1;
  let max = Number.NEGATIVE_INFINITY;
  points.forEach((p, i) => {
    const y = rotate(q, p)[1];
    if (y > max) {
      max = y;
      best = i;
    }
  });
  return best;
}

/**
 * FR-DICEX-46: the turn about +Y (radians) that stands the up face's label upright for a camera
 * looking straight down with screen up = −Z (a label's up points at its face's first vertex, as
 * the atlas maps it). A d4 reads at its corners: 0. The up face (and value) never changes.
 */
export function uprightTurn(g: DieGeometry, q: Quat): number {
  if (g.shape === "d4") return 0;
  const pts = (g.faces[upIndex(g, q)] as number[]).map((i) => g.vertices[i] as Vec3);
  const c = scale(pts.reduce(add, [0, 0, 0]), 1 / pts.length);
  const v = rotate(q, sub(pts[0] as Vec3, c));
  const a = Math.PI - Math.atan2(v[0], v[2]);
  return Math.atan2(Math.sin(a), Math.cos(a)); // shortest way round
}

/** A turn of `a` radians about +Y. */
export const yaw = (a: number): Quat => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];

/** FR-DICEX-15: the value a die shows in orientation `q`. */
export const upFace = (g: DieGeometry, labels: readonly number[], q: Quat): number =>
  labels[upIndex(g, q)] as number;

/**
 * FR-DICEX-15 relabel: the labels with `target` moved onto the up position (swapped with
 * whatever was there), so `upFace(g, result, q) === target`. A target outside the label set
 * replaces the up label.
 */
export function relabel(
  g: DieGeometry,
  labels: readonly number[],
  q: Quat,
  target: number,
): number[] {
  const out = [...labels];
  const up = upIndex(g, q);
  const j = out.indexOf(target);
  if (j >= 0) out[j] = out[up] as number;
  out[up] = target;
  return out;
}

/** The face the die rests on in `q`: the face normal nearest −Y. */
export function bottomFace(g: DieGeometry, q: Quat): number {
  let best = 0;
  let min = Number.POSITIVE_INFINITY;
  g.normals.forEach((n, i) => {
    const y = rotate(q, n)[1];
    if (y < min) {
      min = y;
      best = i;
    }
  });
  return best;
}

/** The nearest resting pose: rotate so the bottom face lies flat; its height off the floor. */
export function restingPose(g: DieGeometry, q: Quat): { q: Quat; y: number } {
  const f = bottomFace(g, q);
  const n = rotate(q, g.normals[f] as Vec3);
  const fix = rotationBetween(n, [0, -1, 0]);
  const out = multiply(fix, q);
  const len = Math.hypot(...out);
  return {
    q: [out[0] / len, out[1] / len, out[2] / len, out[3] / len],
    y: g.inradius[f] as number,
  };
}

/** Tilt of the resting face off the floor, in radians. */
export function tilt(g: DieGeometry, q: Quat): number {
  const n = rotate(q, g.normals[bottomFace(g, q)] as Vec3);
  return Math.acos(Math.min(1, Math.max(-1, -n[1])));
}
