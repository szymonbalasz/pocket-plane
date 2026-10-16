// Face textures and UVs (FR-DICEX-14, -20). One atlas per (label set, look): a cell per value in
// the roller's body / pip colours, so a relabelled die only changes its UVs. The d4 shows the
// value at each corner (read at the top vertex), so its atlas is per die: a cell per face.
import type { DiceLook } from "@shared/dice-extras/looks";
import {
  cross,
  type DieGeometry,
  dot,
  LABEL_VALUES,
  type LabelKind,
  labelText,
  length,
  normalize,
  scale,
  sub,
  type Vec3,
} from "./geometry";

export const CELL = 128;

/** Atlas grid for `cells` cells. */
export const gridOf = (cells: number) => {
  const cols = Math.ceil(Math.sqrt(cells));
  return { cols, rows: Math.ceil(cells / cols) };
};

/** Label size as a share of the cell, by shape (the face's inscribed circle bounds it). */
const TEXT: Record<string, number> = { d6: 0.5, d8: 0.36, d10: 0.34, d12: 0.4, d20: 0.3 };

interface Frame {
  c: Vec3;
  u: Vec3;
  v: Vec3;
  r: number;
}

/** A face's plane frame: centre, axes (v toward the first vertex, u = v × n), radius. */
function frameOf(g: DieGeometry, face: number): Frame {
  const idx = g.faces[face] as number[];
  const pts = idx.map((i) => g.vertices[i] as Vec3);
  const c = scale(
    pts.reduce<Vec3>((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]),
    1 / pts.length,
  );
  const n = g.normals[face] as Vec3;
  const v = normalize(sub(pts[0] as Vec3, c));
  const u = cross(v, n);
  const r = Math.max(...pts.map((p) => length(sub(p, c))));
  return { c, u, v, r };
}

/** A face point in cell-local units (−1…1, y up). */
const local = (f: Frame, p: Vec3): [number, number] => {
  const d = sub(p, f.c);
  return [(dot(d, f.u) / f.r) * 0.96, (dot(d, f.v) / f.r) * 0.96];
};

/**
 * Flat-shaded triangles of a die with UVs into its atlas: face `i` maps to the cell of its label
 * (d4: cell `i`). Arrays are ready for `Float32BufferAttribute`.
 */
export function dieMesh(g: DieGeometry, labels: readonly number[], kind: LabelKind) {
  const values = LABEL_VALUES[kind];
  const cells = g.shape === "d4" ? g.faces.length : values.length;
  const { cols, rows } = gridOf(cells);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  g.faces.forEach((idx, face) => {
    const cell = g.shape === "d4" ? face : values.indexOf(labels[face] as number);
    const cx = ((cell % cols) + 0.5) / cols;
    const cy = 1 - (Math.floor(cell / cols) + 0.5) / rows;
    const f = frameOf(g, face);
    const n = g.normals[face] as Vec3;
    const push = (i: number) => {
      const p = g.vertices[i] as Vec3;
      const [x, y] = local(f, p);
      positions.push(...p);
      normals.push(...n);
      uvs.push(cx + (x * 0.5) / cols, cy + (y * 0.5) / rows);
    };
    for (let k = 1; k + 1 < idx.length; k++) {
      push(idx[0] as number);
      push(idx[k] as number);
      push(idx[k + 1] as number);
    }
  });
  return { positions, normals, uvs };
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function canvasOf(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/** "6" and "9" are underlined where both exist on the die. */
const underline = (kind: LabelKind, value: number) =>
  (value === 6 || value === 9) && LABEL_VALUES[kind].includes(6) && LABEL_VALUES[kind].includes(9);

function label(ctx: Ctx, text: string, size: number, mark: boolean) {
  ctx.font = `700 ${size}px system-ui, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 0, 0);
  if (mark) {
    const w = ctx.measureText(text).width;
    ctx.fillRect(-w / 2, size * 0.42, w, Math.max(2, size * 0.07));
  }
}

/** The atlas of a label set in a look: cell per value, body fill, label in the pip colour. */
export function drawAtlas(kind: LabelKind, shape: string, look: DiceLook): HTMLCanvasElement {
  const values = LABEL_VALUES[kind];
  const { cols, rows } = gridOf(values.length);
  const canvas = canvasOf(cols * CELL, rows * CELL);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.fillStyle = look.body;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = look.pips;
  values.forEach((value, cell) => {
    ctx.save();
    ctx.translate(((cell % cols) + 0.5) * CELL, (Math.floor(cell / cols) + 0.5) * CELL);
    label(ctx, labelText(kind, value), CELL * (TEXT[shape] ?? 0.36), underline(kind, value));
    ctx.restore();
  });
  return canvas;
}

/** The d4 atlas of one die: per face, each corner's vertex label near it, pointing at it. */
export function drawD4(g: DieGeometry, labels: readonly number[], look: DiceLook) {
  const { cols, rows } = gridOf(g.faces.length);
  const canvas = canvasOf(cols * CELL, rows * CELL);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.fillStyle = look.body;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = look.pips;
  g.faces.forEach((idx, face) => {
    const f = frameOf(g, face);
    const ox = ((face % cols) + 0.5) * CELL;
    const oy = (Math.floor(face / cols) + 0.5) * CELL;
    for (const i of idx) {
      const [x, y] = local(f, g.vertices[i] as Vec3);
      // Canvas y grows down; the label sits halfway to its corner, top toward it.
      const dx = x * 0.5 * CELL;
      const dy = -y * 0.5 * CELL;
      ctx.save();
      ctx.translate(ox + dx * 0.52, oy + dy * 0.52);
      ctx.rotate(Math.atan2(dx, -dy));
      label(ctx, String(labels[i]), CELL * 0.2, false);
      ctx.restore();
    }
  });
  return canvas;
}
