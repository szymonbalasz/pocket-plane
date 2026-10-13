// Pure scene math shared by server and clients (MAP §8 derived values): footprint, cell ↔ px,
// drop rounding, map overlap, ruler distance, token numbering, duplicate placement, list order.
import { nameLength, TOKEN_NAME_MAX, type TokenSize } from "./schemas";

export interface Grid {
  gridCellSize: number;
  gridOffsetX: number;
  gridOffsetY: number;
}

export interface MapRect extends Grid {
  mapWidth: number;
  mapHeight: number;
}

/** FR-MAP-14: tiny/small/medium 1, large 2, huge 3, gargantuan 4 cells per side. */
export function footprint(size: TokenSize): number {
  switch (size) {
    case "large":
      return 2;
    case "huge":
      return 3;
    case "gargantuan":
      return 4;
    default:
      return 1;
  }
}

/** Cell → px (top-left corner): `offset + index × cellSize` (display px). */
export function cellToPx(g: Grid, col: number, row: number): { x: number; y: number } {
  return { x: g.gridOffsetX + col * g.gridCellSize, y: g.gridOffsetY + row * g.gridCellSize };
}

/** The cell containing a point (ruler, drop target under the pointer). */
export function pxToCell(g: Grid, x: number, y: number): { col: number; row: number } {
  return {
    col: Math.floor((x - g.gridOffsetX) / g.gridCellSize),
    row: Math.floor((y - g.gridOffsetY) / g.gridCellSize),
  };
}

/** FR-MAP-15: a dragged token's top-left corner → `round((left − offset) / cellSize)`. */
export function dropCell(g: Grid, left: number, top: number): { col: number; row: number } {
  return {
    col: Math.round((left - g.gridOffsetX) / g.gridCellSize) + 0,
    row: Math.round((top - g.gridOffsetY) / g.gridCellSize) + 0,
  };
}

/** FR-MAP-14: valid iff the footprint overlaps the map rectangle. */
export function overlapsMap(m: MapRect, col: number, row: number, size: TokenSize): boolean {
  const n = footprint(size);
  const { x, y } = cellToPx(m, col, row);
  const side = n * m.gridCellSize;
  return x < m.mapWidth && x + side > 0 && y < m.mapHeight && y + side > 0;
}

/** FR-MAP-22: 5/10/5 diagonals, `5 × (max(dx, dy) + floor(min(dx, dy) / 2))` ft (#145). */
export function distanceFt(a: { col: number; row: number }, b: { col: number; row: number }) {
  const dx = Math.abs(a.col - b.col);
  const dy = Math.abs(a.row - b.row);
  return 5 * (Math.max(dx, dy) + Math.floor(Math.min(dx, dy) / 2));
}

/** Ruler (FR-MAP-22) and drag (FR-MAP-15) label text. */
export function distanceLabel(a: { col: number; row: number }, b: { col: number; row: number }) {
  return `${distanceFt(a, b)} ft`;
}

// ---------- names (FR-MAP-16) ----------

const SUFFIX = /^(.*) ([1-9]\d{0,8})$/;

/** Name minus a trailing ` <N>`. */
export function baseName(name: string): string {
  const m = SUFFIX.exec(name);
  return m?.[1] && m[1].trim().length > 0 ? m[1] : name;
}

/** First `max` code points, trailing spaces removed. */
function cut(s: string, max: number): string {
  return [...s].slice(0, Math.max(0, max)).join("").trimEnd();
}

/**
 * FR-MAP-16: if the scene has tokens named `B` (counts as 1) or `B N`, the new name is
 * `B <max N + 1>`, else `name` unchanged. `B` is cut so the result fits 40 code points; a token
 * already carrying such a cut base counts too, so repeated places keep counting up.
 */
export function numberedName(name: string, sceneNames: readonly string[]): string {
  const b = baseName(name);
  let max = 0;
  for (const t of sceneNames) {
    if (t === b) {
      max = Math.max(max, 1);
      continue;
    }
    const m = SUFFIX.exec(t);
    if (!m) continue;
    const [, stem = "", digits = ""] = m;
    if (stem === b || stem === cut(b, TOKEN_NAME_MAX - 1 - digits.length)) {
      max = Math.max(max, Number(digits));
    }
  }
  if (max === 0) return name;
  const suffix = ` ${max + 1}`;
  const stem =
    nameLength(b) + suffix.length > TOKEN_NAME_MAX ? cut(b, TOKEN_NAME_MAX - suffix.length) : b;
  return `${stem}${suffix}`;
}

/** FR-MAP-04: "‹name› (copy)", cut to 60. */
export function copyName(name: string, max = 60): string {
  const full = `${name} (copy)`;
  return nameLength(full) <= max ? full : cut(full, max);
}

/**
 * FR-MAP-17: the copy goes to `col + footprint` same row if valid, else `col − footprint`,
 * else the source cell.
 */
export function duplicateCell(
  m: MapRect,
  t: { col: number; row: number; size: TokenSize },
): { col: number; row: number } {
  const n = footprint(t.size);
  for (const col of [t.col + n, t.col - n]) {
    if (overlapsMap(m, col, t.row, t.size)) return { col, row: t.row };
  }
  return { col: t.col, row: t.row };
}

// ---------- order ----------

/** Case-insensitive, code-point order on the folded name; same on every machine. */
export const nameKey = (s: string) => s.normalize("NFC").toLowerCase();

export function byNameThenSeq(
  a: { name: string; seq: number },
  b: { name: string; seq: number },
): number {
  const ka = nameKey(a.name);
  const kb = nameKey(b.name);
  if (ka !== kb) return ka < kb ? -1 : 1;
  return a.seq - b.seq;
}

export interface SceneListEntry<F, S> {
  folder: F | null;
  scenes: S[];
}

/**
 * FR-MAP-02 list order: folders (each with its scenes), then root scenes; each by name
 * (case-insensitive), tiebreak `seq`. A scene whose folder is unknown sits at the root.
 */
export function sceneList<
  F extends { id: string; name: string; seq: number },
  S extends { name: string; seq: number; folderId: string | null },
>(folders: readonly F[], scenes: readonly S[]): SceneListEntry<F, S>[] {
  const sortedScenes = [...scenes].sort(byNameThenSeq);
  const known = new Set(folders.map((f) => f.id));
  const out: SceneListEntry<F, S>[] = [...folders].sort(byNameThenSeq).map((f) => ({
    folder: f,
    scenes: sortedScenes.filter((s) => s.folderId === f.id),
  }));
  out.push({
    folder: null,
    scenes: sortedScenes.filter((s) => s.folderId === null || !known.has(s.folderId)),
  });
  return out;
}

/** Flattened list order (FR-MAP-08 default: the first scene). */
export function sceneOrder<
  F extends { id: string; name: string; seq: number },
  S extends { name: string; seq: number; folderId: string | null },
>(folders: readonly F[], scenes: readonly S[]): S[] {
  return sceneList(folders, scenes).flatMap((e) => e.scenes);
}

/** Canvas draw order (MAP §7): larger tokens below smaller, then by `seq`. */
export function tokenDrawOrder(
  a: { size: TokenSize; seq: number },
  b: { size: TokenSize; seq: number },
): number {
  return footprint(b.size) - footprint(a.size) || a.seq - b.seq;
}

/** Initials for a token without an image (MAP §7). */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words[1]] : [words[0]];
  return letters
    .map((w) => [...(w ?? "")][0] ?? "")
    .join("")
    .toUpperCase();
}
