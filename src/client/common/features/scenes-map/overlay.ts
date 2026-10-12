// Optimistic move overlay (FR-MAP-15, ADR-0021 E). A dropped token shows at its new cell until
// that intent's `ack` / `reject` or any snapshot; events update the records underneath, so the
// server wins as soon as the overlay clears. DOM-free so it runs under `bun test`.
import type { RecordStore } from "@shared/protocol/store";

export interface OverlayEntry {
  col: number;
  row: number;
  /** Identifies the move intent that owns this entry; a later move replaces it. */
  key: number;
}

export type MoveOverlay = ReadonlyMap<string, OverlayEntry>;

export const emptyOverlay: MoveOverlay = new Map();

let nextKey = 1;

/** Drop: show the token at `col,row`; returns the new overlay and the entry key. */
export function startMove(
  o: MoveOverlay,
  tokenId: string,
  col: number,
  row: number,
): { overlay: MoveOverlay; key: number } {
  const key = nextKey++;
  const m = new Map(o);
  m.set(tokenId, { col, row, key });
  return { overlay: m, key };
}

/** `ack` or `reject` of the intent with `key`: drop its entry (a newer move keeps its own). */
export function settleMove(o: MoveOverlay, tokenId: string, key: number): MoveOverlay {
  if (o.get(tokenId)?.key !== key) return o;
  const m = new Map(o);
  m.delete(tokenId);
  return m;
}

/** A snapshot replaces the store and drops all optimistic state (FR-SYNC-08). */
export const clearOverlay = (): MoveOverlay => emptyOverlay;

/** Shown position: the overlay entry if any, else the record. */
export function shownCell<T extends { id: string; col: number; row: number }>(
  o: MoveOverlay,
  t: T,
): T {
  const e = o.get(t.id);
  return e ? { ...t, col: e.col, row: e.row } : t;
}

/** True when `next` came from a snapshot (a new store at seq 0). */
export function isSnapshotStore(prev: RecordStore | null, next: RecordStore): boolean {
  return prev !== next && next.seq === 0;
}

/** FR-MAP-25: a receiver draws a signal only for the scene it shows. */
export function signalForShownScene(data: { sceneId: string }, shown: string | null): boolean {
  return shown !== null && data.sceneId === shown;
}
