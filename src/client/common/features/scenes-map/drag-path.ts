// Drag path and combat trail (FR-MAP-52–55, sprint 4): derived on each client from the one drag
// pipeline (`drag-preview.ts`, seams S1) and the `token` upserts it already receives: no intent,
// signal field, ack hint or record (0 bytes). `pathShown` is a draw rule over frames already
// routed (FR-MAP-53); the blocked step comes from the SCN wall hint in the drag probe's ack
// (FR-MAP-55); trails live in client memory, keyed by the started encounter's turn (FR-MAP-54).
// DOM-free so it runs under `bun test`.
import { ENCOUNTER_TYPE, type EncounterView } from "@shared/combat-tracker/schemas";
import type { RecordStore } from "@shared/protocol/store";
import type { Segment } from "@shared/scene-tools/schemas";
import { dragPath } from "@shared/scenes-map/geometry";
import { TOKEN_TYPE, type TokenView } from "@shared/scenes-map/schemas";

export interface Cell {
  col: number;
  row: number;
}

/**
 * FR-MAP-53: the path of T is drawn iff this client draws T at all (T in its store: hidden, fog-
 * and vision-hidden tokens never reach a player, nor their frames) and it is a DM client or T is a
 * player token. Non-player tokens glide on players' canvases with no path (OQ-MAP-37).
 */
export function pathShown(
  t: Pick<TokenView, "ownerPlayerId"> | undefined,
  client: "dm" | "player",
): boolean {
  if (!t) return false;
  return client === "dm" || t.ownerPlayerId !== null;
}

/** "c,r c,r …": the `cells` attr of `map-drag-path`. */
export const cellsAttr = (cells: readonly Cell[]) =>
  cells.map((c) => `${c.col},${c.row}`).join(" ");

/** Every footprint cell of the path's steps (an n × n token covers n² per step), each once. */
export function pathFootprint(path: readonly Cell[], n: number): Cell[] {
  const seen = new Set<string>();
  const out: Cell[] = [];
  for (const s of path) {
    for (let dr = 0; dr < n; dr++) {
      for (let dc = 0; dc < n; dc++) {
        const k = `${s.col + dc},${s.row + dr}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ col: s.col + dc, row: s.row + dr });
      }
    }
  }
  return out;
}

const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;

/**
 * FR-MAP-55: the index of the first path step past the wall the move guard found (the step the
 * from → to line crosses into), or -1. `pieces` = the wall hint's pieces for the current cell
 * (one piece around the first crossing, FR-SCN-38); the crossing is where the line between the
 * footprint centres meets the piece's line.
 */
export function blockedStep(from: Cell, to: Cell, n: number, pieces: readonly Segment[]): number {
  const steps = Math.max(Math.abs(to.col - from.col), Math.abs(to.row - from.row));
  const piece = pieces[0];
  if (steps === 0 || !piece) return -1;
  const ax = from.col + n / 2;
  const ay = from.row + n / 2;
  const dx = to.col - from.col;
  const dy = to.row - from.row;
  const [x1, y1, x2, y2] = piece;
  const den = cross(dx, dy, x2 - x1, y2 - y1);
  let t: number;
  if (Math.abs(den) > 1e-12) t = cross(x1 - ax, y1 - ay, x2 - x1, y2 - y1) / den;
  else {
    // Along the line (a wall the move runs on): the piece's middle, projected.
    const mx = (x1 + x2) / 2 - ax;
    const my = (y1 + y2) / 2 - ay;
    t = (mx * dx + my * dy) / (dx * dx + dy * dy);
  }
  const at = Math.ceil(Math.min(1, Math.max(0, t)) * steps - 1e-9);
  return Math.min(steps, Math.max(1, at));
}

/**
 * FR-MAP-55: the `blocked` step of this client's own drag. A player's from the wall hint; the DM
 * is never blocked (plain path, FR-SCN-13's "through wall" tag), whatever hints an owner's dry
 * run carries.
 */
export function ownDragBlocked(
  client: "dm" | "player",
  drag: { from: Cell; to: Cell; size: number },
  pieces: readonly Segment[],
): number {
  return client === "player" ? blockedStep(drag.from, drag.to, drag.size, pieces) : -1;
}

// ---------- combat trail (FR-MAP-54) ----------

/**
 * The turn trails belong to: the started encounter's (id, round, turn) as this client reads it,
 * or null (no trails). DM: only when the encounter's scene is the one shown. Players never get
 * the encounter's scene (CBT §9); theirs is the active scene, which they always show.
 */
export function combatTurnKey(
  store: RecordStore,
  client: "dm" | "player",
  sceneId: string,
): string | null {
  const all = Object.values(store.records[ENCOUNTER_TYPE] ?? {}) as EncounterView[];
  const e = all.find((x) => x.status === "started");
  if (!e) return null;
  if (client === "dm") {
    if (e.sceneId !== sceneId) return null;
    return `${e.id}:${e.round}:${e.turnCombatantId ?? ""}`;
  }
  return `${e.id}:${e.round}:${e.playerTurnCombatantId ?? ""}`;
}

export interface TrailState {
  /** The turn the trails belong to (`combatTurnKey`). */
  key: string | null;
  /** tokenId → this turn's committed moves, each a straight path. */
  byToken: Record<string, Cell[][]>;
}

export const noTrails: TrailState = { key: null, byToken: {} };

/** A committed move read from the client's own store: previous cell → new cell. */
export interface TokenMove {
  tokenId: string;
  from: Cell;
  to: Cell;
}

/**
 * The trail state after a frame: a turn change (or leaving combat) drops every trail; in combat
 * each move adds its straight path to its token's trail; a deleted token loses its trail.
 */
export function nextTrails(
  s: TrailState,
  key: string | null,
  moves: readonly TokenMove[],
  deleted: readonly string[] = [],
): TrailState {
  let byToken = s.key === key ? s.byToken : {};
  if (key === null) return byToken === s.byToken && s.key === null ? s : { key, byToken: {} };
  for (const m of moves) {
    if (m.from.col === m.to.col && m.from.row === m.to.row) continue;
    if (byToken === s.byToken) byToken = { ...byToken };
    byToken[m.tokenId] = [...(byToken[m.tokenId] ?? []), dragPath(m.from, m.to)];
  }
  for (const id of deleted) {
    if (!(id in byToken)) continue;
    if (byToken === s.byToken) byToken = { ...byToken };
    delete byToken[id];
  }
  return byToken === s.byToken && s.key === key ? s : { key, byToken };
}

/**
 * The moves and deletes of an event frame's `token` changes on the shown scene: `known` = each
 * token's last cell in this client's store (before the frame), `store` = the store after it.
 * Returns the updated `known` too.
 */
export function tokenMovesOf(
  changes: readonly { type: string; id: string; op: "upsert" | "delete" }[],
  known: Readonly<Record<string, Cell>>,
  store: RecordStore,
  sceneId: string,
): { moves: TokenMove[]; deleted: string[]; known: Record<string, Cell> } {
  const moves: TokenMove[] = [];
  const deleted: string[] = [];
  let next: Record<string, Cell> | null = null;
  const rows = store.records[TOKEN_TYPE] ?? {};
  for (const c of changes) {
    if (c.type !== TOKEN_TYPE) continue;
    const t = rows[c.id] as TokenView | undefined;
    next ??= { ...known };
    if (c.op === "delete" || !t || t.sceneId !== sceneId) {
      // Gone from this client or from the shown scene: no trail.
      deleted.push(c.id);
      delete next[c.id];
      continue;
    }
    const prev = known[c.id];
    if (prev && (prev.col !== t.col || prev.row !== t.row))
      moves.push({ tokenId: c.id, from: prev, to: { col: t.col, row: t.row } });
    next[c.id] = { col: t.col, row: t.row };
  }
  return { moves, deleted, known: next ?? { ...known } };
}

/** `known` for a token list (each token's stored cell). */
export function knownCells(tokens: readonly TokenView[]): Record<string, Cell> {
  const out: Record<string, Cell> = {};
  for (const t of tokens) out[t.id] = { col: t.col, row: t.row };
  return out;
}
