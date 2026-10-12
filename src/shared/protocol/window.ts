// Windowed record types (ADR-0029, CON-38): bounded snapshots for append-only logs.
// Pure; the server registry cuts snapshots with it, convergence helpers project stores with it.
import type { RecordMap } from "./store";

/** Keys of `R` whose value is a number (the window's `orderBy`, e.g. `n`, `seq`). */
export type NumericKey<R> = {
  [K in keyof R]-?: R[K] extends number ? K : never;
}[keyof R] &
  string;

export interface RecordWindow<R> {
  /** Numeric field; higher = newer. Ties keep the provider's order. */
  orderBy: NumericKey<R>;
  /** Newest unpinned rows kept (pinned rows don't count). Integer ≥ 1. */
  size: number;
  /** Rows always in the snapshot, whatever their age (e.g. pending notifications). */
  pin?: (r: R) => boolean;
}

export interface WindowCut<R> {
  /** Pinned rows + newest `size` unpinned rows, in the provider's order. */
  rows: R[];
  /** Lowest `orderBy` among the kept unpinned rows; null when none are kept. */
  floor: number | null;
}

function orderValue<R>(r: R, w: RecordWindow<R>): number {
  const v = (r as Record<string, unknown>)[w.orderBy];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error(`Window orderBy "${w.orderBy}" must be a finite number, got ${String(v)}`);
  }
  return v;
}

/**
 * The snapshot cut (ADR-0029): every pinned row plus the newest `size` unpinned rows by
 * `orderBy`. Taken before the visibility filter, so the floor is the same for every viewer.
 */
export function cutWindow<R>(rows: readonly R[], w: RecordWindow<R>): WindowCut<R> {
  const unpinned: { r: R; v: number; i: number }[] = [];
  rows.forEach((r, i) => {
    if (!w.pin?.(r)) unpinned.push({ r, v: orderValue(r, w), i });
  });
  // Newest first; stable on ties (provider order).
  const newest = [...unpinned].sort((a, b) => b.v - a.v || a.i - b.i).slice(0, w.size);
  const keep = new Set(newest.map((x) => x.r));
  const floor = newest.length === 0 ? null : Math.min(...newest.map((x) => x.v));
  return { rows: rows.filter((r) => keep.has(r) || w.pin?.(r) === true), floor };
}

/**
 * Record IDs (pre-filter) a fresh snapshot is cut to, per windowed type. Unlisted types are
 * not windowed and compare in full.
 */
export type WindowIds = Record<string, readonly string[]>;

/**
 * Convergence view (FR-SYNC-20 as amended by ADR-0029): windowed types keep only rows inside
 * the current cut (pinned + at or above the floor). Older rows a client still holds are real,
 * just not resent, so they drop out of the comparison.
 */
export function windowProjection(records: RecordMap, windows: WindowIds): RecordMap {
  const out: RecordMap = {};
  for (const [type, byId] of Object.entries(records)) {
    const ids = windows[type];
    if (!ids) {
      out[type] = byId;
      continue;
    }
    const allowed = new Set(ids);
    const kept: Record<string, unknown> = {};
    for (const [id, r] of Object.entries(byId)) if (allowed.has(id)) kept[id] = r;
    out[type] = kept;
  }
  return out;
}
