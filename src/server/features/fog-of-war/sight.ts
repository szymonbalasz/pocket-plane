// FR-FOG-32 / -33 / -36 / -38 / -39 / -52: a scene's vision sources and each player's sight, read
// from the DB (a command's `tx` or the server's `Db`) through the vision cache.
// - Source of P = a token on the scene with `ownerPlayerId = P`, not `hidden`; senses from its
//   definition's `statBlock.senses` (absent = Normal 999 ft, sprint 4); at most 4 per player,
//   oldest `seq` first (more are ignored with a `warn` log); while party vision is on, at most 12
//   for the whole party, taken round robin over players in campaign order (FR-FOG-52). A player
//   with ≥ 1 source has a `vision` record, even with stored senses 0 / 0 (no polygon).
// - Occluders (walls + doors not open + the map rectangle's edges, darkness edges for sources
//   without see-through) are read and prepared only on a cache miss.
// - Cache key: fog `rev`, structure `rev`, the darkness geometry, the map rectangle (size, cell
//   size, offsets: its edges occlude), the party-vision flag and the sources'
//   `(tokenId, col, row, size, senses)` (FR-FOG-38).
import { geomOf } from "@shared/fog-of-war/shapes";
import {
  type MapBounds,
  mapBounds,
  NORMAL_SENSES,
  type PlayerVision,
  playerVision,
  prepareScene,
  type SceneOccluders,
  type Senses,
  SOURCES_MAX,
  type VisionSource,
} from "@shared/fog-of-war/vision";
import { sightOccluders } from "@shared/scene-tools/geometry";
import { footprint } from "@shared/scenes-map/geometry";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { entity, scene, sceneStructure, token } from "../../db/schema";
import { type Logger, silentLogger } from "../../log";
import type { SceneRead } from "../scenes-map/visibility-hooks";
import { visionCache } from "./vision-cache";

let log: Logger = silentLogger;

/** The fog feature's logger (set at registration; FR-FOG-32's cap warning, FR-FOG-37's). */
export function setFogLogger(l: Logger) {
  log = l;
}
export const fogLog = () => log;

let computed = 0;

/** Test support: how many sights were computed (cache misses, FR-FOG-38). */
export const sightsComputed = () => computed;

/** FR-FOG-52 (OQ-FOG-56): ≤ 12 sources for the whole party while party vision is on. */
export const PARTY_SOURCES_MAX = 12;

/** One vision source (FR-FOG-32). */
export interface SourceToken extends VisionSource {
  id: string;
  tokenId: string;
  playerId: string;
  col: number;
  row: number;
  size: string;
}

/** The token fields that make it a source (FR-FOG-32). */
export interface SourceLike {
  sceneId: string;
  ownerPlayerId: string | null;
  hidden: boolean;
  col: number;
  row: number;
  size: string;
}

/** FR-FOG-32: an owned token the DM hasn't hidden. */
export const isSource = (t: SourceLike | null | undefined): t is SourceLike =>
  t != null && t.ownerPlayerId !== null && !t.hidden;

const sensesOf = (statBlock: unknown): Senses => {
  const s = (statBlock as { senses?: Senses } | null)?.senses;
  return s ?? NORMAL_SENSES;
};

/**
 * Each player's sources on a scene (≤ 4, oldest `seq` first); only the campaign's players. With
 * `party` (FR-FOG-52): then ≤ 12 for the whole party, round robin over `players` in order.
 */
export function sceneSources(
  read: SceneRead,
  sceneId: string,
  players: readonly string[],
  party = false,
): Map<string, SourceToken[]> {
  const rows = read
    .select({
      id: token.id,
      owner: token.ownerPlayerId,
      col: token.col,
      row: token.row,
      size: token.size,
      definitionId: token.definitionId,
    })
    .from(token)
    .where(and(eq(token.sceneId, sceneId), isNotNull(token.ownerPlayerId), eq(token.hidden, false)))
    .orderBy(asc(token.seq))
    .all();
  const out = new Map<string, SourceToken[]>();
  if (rows.length === 0) return out;
  const defs = new Map(
    read
      .select({ id: entity.id, statBlock: entity.statBlock })
      .from(entity)
      .where(inArray(entity.id, [...new Set(rows.map((r) => r.definitionId))].sort()))
      .all()
      .map((d) => [d.id, sensesOf(d.statBlock)]),
  );
  const known = new Set(players);
  for (const r of rows) {
    const p = r.owner as string;
    if (!known.has(p)) continue;
    const list = out.get(p) ?? [];
    if (list.length >= SOURCES_MAX) {
      log.warn(
        `fog: player ${p} has more than ${SOURCES_MAX} tokens on scene ${sceneId}; token ${r.id} gives no vision`,
      );
      continue;
    }
    const n = footprint(r.size);
    list.push({
      id: r.id,
      tokenId: r.id,
      playerId: p,
      col: r.col,
      row: r.row,
      size: r.size,
      x: r.col + n / 2,
      y: r.row + n / 2,
      senses: defs.get(r.definitionId) ?? NORMAL_SENSES,
    });
    out.set(p, list);
  }
  return party ? partyCut(out, players, sceneId) : out;
}

/**
 * FR-FOG-52: ≤ 12 sources for the party, one per player per round in campaign order; the rest
 * give no sight (`warn`). A player whose sources were all cut keeps an empty list (still a
 * `vision` record, no polygon).
 */
function partyCut(
  all: Map<string, SourceToken[]>,
  players: readonly string[],
  sceneId: string,
): Map<string, SourceToken[]> {
  const total = [...all.values()].reduce((n, l) => n + l.length, 0);
  if (total <= PARTY_SOURCES_MAX) return all;
  const order = players.filter((p) => all.has(p));
  const kept = new Map<string, SourceToken[]>(order.map((p) => [p, []]));
  let left = PARTY_SOURCES_MAX;
  for (let round = 0; left > 0 && round < SOURCES_MAX; round++) {
    for (const p of order) {
      const s = all.get(p)?.[round];
      if (!s || left === 0) continue;
      kept.get(p)?.push(s);
      left--;
    }
  }
  for (const p of order) {
    for (const s of (all.get(p) ?? []).slice(kept.get(p)?.length ?? 0)) {
      log.warn(
        `fog: party vision has more than ${PARTY_SOURCES_MAX} sources on scene ${sceneId}; token ${s.tokenId} gives no vision`,
      );
    }
  }
  return kept;
}

const sensesKey = (s: Senses) =>
  `${s.visionFt ?? "n"},${s.darkvisionFt},${s.seesMagicalDarkness ? 1 : 0},${s.seesInvisible ? 1 : 0}`;

/** FR-FOG-38: the cache key of one player's sight. */
export function sightKey(base: string, sources: readonly SourceToken[]): string {
  return `${base}|${sources.map((s) => `${s.tokenId}@${s.col},${s.row},${s.size}:${sensesKey(s.senses)}`).join(";")}`;
}

/** What a scene's sight is computed from, besides the sources. */
export interface SightInputs {
  sceneId: string;
  fogRev: number;
  darkness: readonly object[];
  /** FR-FOG-50: party vision on (in the cache key, FR-FOG-38). */
  party?: boolean;
}

/** FR-FOG-33 / -38 (review A8): the scene's map rectangle in grid units, or null. */
export function sceneBounds(read: SceneRead, sceneId: string): MapBounds | null {
  const s = read
    .select({
      mapWidth: scene.mapWidth,
      mapHeight: scene.mapHeight,
      gridCellSize: scene.gridCellSize,
      gridOffsetX: scene.gridOffsetX,
      gridOffsetY: scene.gridOffsetY,
    })
    .from(scene)
    .where(eq(scene.id, sceneId))
    .get();
  return s && s.gridCellSize > 0 ? mapBounds(s) : null;
}

/** One player's sight on a scene (FR-FOG-36 / -39), with its cache key. */
export interface SightEntry {
  key: string;
  sources: SourceToken[];
  vision: PlayerVision;
}

/**
 * Every player's sight on a scene: players with ≥ 1 source only (cache first, FR-FOG-38). The
 * occluders are read and prepared once, on the first miss.
 */
export function sceneSight(
  read: SceneRead,
  inputs: SightInputs & { darkness: readonly Parameters<typeof geomOf>[0][] },
  sources: ReadonlyMap<string, SourceToken[]>,
): Map<string, SightEntry> {
  const out = new Map<string, SightEntry>();
  if (sources.size === 0) return out;
  const cache = visionCache(read);
  const s = read
    .select({ rev: sceneStructure.rev })
    .from(sceneStructure)
    .where(eq(sceneStructure.sceneId, inputs.sceneId))
    .get();
  const bounds = sceneBounds(read, inputs.sceneId);
  const base = [
    inputs.fogRev,
    s?.rev ?? -1,
    bounds?.join(",") ?? "-",
    inputs.party ? "party" : "own",
    JSON.stringify(inputs.darkness.map(geomOf)),
  ].join("|");
  let occ: SceneOccluders | null = null;
  for (const [p, list] of sources) {
    const key = sightKey(base, list);
    let vision = cache.get(inputs.sceneId, p, key);
    if (!vision) {
      occ ??= sceneOccluders(read, inputs.sceneId, inputs.darkness, bounds);
      vision = playerVision(occ, list);
      computed++;
      cache.set(inputs.sceneId, p, { key, vision });
    }
    out.set(p, { key, sources: list, vision });
  }
  return out;
}

/** FR-SCN-37 + FR-FOG-28 / -33: walls, doors not open, map edges and darkness, prepared once. */
export function sceneOccluders(
  read: SceneRead,
  sceneId: string,
  darkness: readonly Parameters<typeof geomOf>[0][],
  bounds: MapBounds | null = sceneBounds(read, sceneId),
): SceneOccluders {
  const s = read
    .select({ walls: sceneStructure.walls, doors: sceneStructure.doors })
    .from(sceneStructure)
    .where(eq(sceneStructure.sceneId, sceneId))
    .get();
  const segs = s ? sightOccluders(s) : [];
  return prepareScene(segs, darkness, bounds ?? undefined);
}
