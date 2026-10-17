// FR-FOG-38 (review A6): the vision cache. Server memory, never authoritative: `(sceneId,
// playerId)` → that player's vision, keyed by the fog `rev`, the structure `rev` and the sources'
// `(tokenId, col, row, size, senses)` (plus the darkness geometry, so a re-created fog row at rev 0
// can't hit an older rev 0); LRU of 256 entries; a miss recomputes from the DB. Restart → empty.
//
// One cache per SQLite connection: a TEMP table (per connection, never in the DB file, never in
// `state:digest`) holds the connection's number, so the many test DBs of one process never share
// entries. Entries computed **inside a transaction** stay pending, visible to that transaction
// only, until it commits: a TEMP marker row written in the same transaction survives only a
// commit, and the connection's next access promotes the pending entries (marker present) or drops
// them (rolled back), so a rev that never committed leaves no entry.
import type { PlayerVision } from "@shared/fog-of-war/vision";
import { sql } from "drizzle-orm";
import type { Db } from "../../db/client";

export const VISION_CACHE_MAX = 256;

export interface VisionEntry {
  /** The inputs' key (revs, darkness, sources). */
  key: string;
  vision: PlayerVision;
}

type Raw = Pick<Db, "run" | "all">;

interface Pending {
  tx: object;
  marker: number;
  entries: Map<string, VisionEntry>;
}

const TABLE = "pp_fog_vision_cache";
let nextConn = 1;
let nextMarker = 1;
const lru = new Map<string, VisionEntry>();
const pending = new Map<number, Pending>();

/** A command's `tx` has no `$client` (a `Db` does): its entries stay pending until commit. */
const inTransaction = (read: object) => !("$client" in read);

const isRaw = (read: object): read is Raw =>
  typeof (read as Partial<Raw>).run === "function" &&
  typeof (read as Partial<Raw>).all === "function";

/** The connection's number (assigned on first use; a rolled-back assignment just misses). */
function connOf(read: Raw): number {
  read.run(sql.raw(`CREATE TEMP TABLE IF NOT EXISTS ${TABLE} (k INTEGER PRIMARY KEY, v INTEGER)`));
  const row = read.all<{ v: number }>(sql.raw(`SELECT v FROM ${TABLE} WHERE k = 0`))[0];
  if (row) return row.v;
  const n = nextConn++;
  read.run(sql`INSERT INTO ${sql.raw(TABLE)} (k, v) VALUES (0, ${n})`);
  return n;
}

/** Promotes (committed) or drops (rolled back) another transaction's pending entries. */
function settle(read: Raw, conn: number) {
  const p = pending.get(conn);
  if (!p || (inTransaction(read) && p.tx === read)) return;
  pending.delete(conn);
  const m = read.all<{ k: number }>(sql`SELECT k FROM ${sql.raw(TABLE)} WHERE k = ${p.marker}`)[0];
  if (!m) return;
  read.run(sql`DELETE FROM ${sql.raw(TABLE)} WHERE k = ${p.marker}`);
  for (const [k, e] of p.entries) put(k, e);
}

function put(k: string, e: VisionEntry) {
  lru.delete(k);
  lru.set(k, e);
  while (lru.size > VISION_CACHE_MAX) lru.delete(lru.keys().next().value as string);
}

const pairKey = (conn: number, sceneId: string, playerId: string) =>
  `${conn}|${sceneId}|${playerId}`;

/** A cache handle bound to one read (a `Db` or a command's `tx`). */
export interface VisionCacheView {
  /** The entry for the pair if its key matches. */
  get(sceneId: string, playerId: string, key: string): PlayerVision | null;
  /** The pair's latest entry whatever its key (what clients last got: a re-derive's "before"). */
  latest(sceneId: string, playerId: string): VisionEntry | null;
  set(sceneId: string, playerId: string, e: VisionEntry): void;
}

const NO_CACHE: VisionCacheView = { get: () => null, latest: () => null, set: () => {} };

export function visionCache(read: object): VisionCacheView {
  if (!isRaw(read)) return NO_CACHE;
  const conn = connOf(read);
  settle(read, conn);
  const own = () => {
    const p = pending.get(conn);
    return p && p.tx === read ? p : null;
  };
  const latest = (sceneId: string, playerId: string) => {
    const k = pairKey(conn, sceneId, playerId);
    return own()?.entries.get(k) ?? lru.get(k) ?? null;
  };
  return {
    latest,
    get(sceneId, playerId, key) {
      const e = latest(sceneId, playerId);
      if (!e || e.key !== key) return null;
      if (!own()?.entries.has(pairKey(conn, sceneId, playerId))) {
        put(pairKey(conn, sceneId, playerId), e);
      }
      return e.vision;
    },
    set(sceneId, playerId, e) {
      const k = pairKey(conn, sceneId, playerId);
      if (!inTransaction(read)) {
        put(k, e);
        return;
      }
      let p = own();
      if (!p) {
        p = { tx: read, marker: nextMarker++, entries: new Map() };
        read.run(sql`INSERT INTO ${sql.raw(TABLE)} (k, v) VALUES (${p.marker}, 1)`);
        pending.set(conn, p);
      }
      p.entries.set(k, e);
    },
  };
}

/** Test support: the number of committed entries (LRU). */
export const visionCacheSize = () => lru.size;

/** FR-FOG-53: the drag preview's own LRU, so drags never evict players' sight (FR-FOG-38). */
export const PREVIEW_CACHE_MAX = 64;

/** A preview: one source's polygons at the previewed cell. */
export interface PreviewSight {
  see: number[][];
  dark: number[][];
}

const previews = new Map<string, PreviewSight>();

/**
 * FR-FOG-53: the preview cache bound to one read. `map.checkMove` writes nothing, so its entries
 * (keyed by every input, FR-FOG-53) go straight to the LRU; per connection like `visionCache`.
 */
export function previewCache(read: object): {
  get(key: string): PreviewSight | null;
  set(key: string, v: PreviewSight): void;
} {
  if (!isRaw(read)) return { get: () => null, set: () => {} };
  const conn = connOf(read);
  return {
    get(key) {
      const k = `${conn}|${key}`;
      const v = previews.get(k);
      if (!v) return null;
      previews.delete(k);
      previews.set(k, v);
      return v;
    },
    set(key, v) {
      const k = `${conn}|${key}`;
      previews.delete(k);
      previews.set(k, v);
      while (previews.size > PREVIEW_CACHE_MAX)
        previews.delete(previews.keys().next().value as string);
    },
  };
}

/** Test support: the number of preview entries. */
export const previewCacheSize = () => previews.size;

/** Test support: a restart (memory only, FR-FOG-38). */
export function clearVisionCache() {
  lru.clear();
  pending.clear();
  previews.clear();
}
