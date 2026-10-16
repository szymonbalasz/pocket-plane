// FR-FOG-32 / -33 / -36 / -38 / -39: a scene's vision sources and each player's sight, read from
// the DB (a command's `tx` or the server's `Db`) through the vision cache.
// - Source of P = a token on the scene with `ownerPlayerId = P`, not `hidden`; senses from its
//   definition's `statBlock.senses` (absent = all 0); at most 4 per player, oldest `seq` first
//   (more are ignored with a `warn` log). A player with ≥ 1 source has a `vision` record, even
//   with senses all 0 (no polygon).
// - Occluders (walls + doors not open, darkness edges for sources without see-through) are read
//   and prepared only on a cache miss.
// - Cache key: fog `rev`, structure `rev`, the darkness geometry and the sources'
//   `(tokenId, col, row, size, senses)` (FR-FOG-38).
import { geomOf } from "@shared/fog-of-war/shapes";
import {
  NO_SENSES,
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
import { entity, sceneFog, sceneStructure, token } from "../../db/schema";
import { type Logger, silentLogger } from "../../log";
import type { SceneRead } from "../scenes-map/visibility-hooks";
import { visionCache } from "./vision-cache";

let log: Logger = silentLogger;

/** The fog feature's logger (set at registration; FR-FOG-32's cap warning, FR-FOG-37's). */
export function setFogLogger(l: Logger) {
  log = l;
}
export const fogLog = () => log;

/** One vision source (FR-FOG-32). */
export interface SourceToken extends VisionSource {
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
  return s ?? NO_SENSES;
};

/** Each player's sources on a scene (≤ 4, oldest `seq` first); only the campaign's players. */
export function sceneSources(
  read: SceneRead,
  sceneId: string,
  players: readonly string[],
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
      tokenId: r.id,
      playerId: p,
      col: r.col,
      row: r.row,
      size: r.size,
      x: r.col + n / 2,
      y: r.row + n / 2,
      senses: defs.get(r.definitionId) ?? NO_SENSES,
    });
    out.set(p, list);
  }
  return out;
}

const sensesKey = (s: Senses) =>
  `${s.visionFt},${s.darkvisionFt},${s.seesMagicalDarkness ? 1 : 0},${s.seesInvisible ? 1 : 0}`;

/** FR-FOG-38: the cache key of one player's sight. */
export function sightKey(base: string, sources: readonly SourceToken[]): string {
  return `${base}|${sources.map((s) => `${s.tokenId}@${s.col},${s.row},${s.size}:${sensesKey(s.senses)}`).join(";")}`;
}

/** What a scene's sight is computed from, besides the sources. */
export interface SightInputs {
  sceneId: string;
  fogRev: number;
  darkness: readonly object[];
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
  const base = `${inputs.fogRev}|${s?.rev ?? -1}|${JSON.stringify(inputs.darkness.map(geomOf))}`;
  let occ: SceneOccluders | null = null;
  for (const [p, list] of sources) {
    const key = sightKey(base, list);
    let vision = cache.get(inputs.sceneId, p, key);
    if (!vision) {
      occ ??= sceneOccluders(read, inputs.sceneId, inputs.darkness);
      vision = playerVision(occ, list);
      cache.set(inputs.sceneId, p, { key, vision });
    }
    out.set(p, { key, sources: list, vision });
  }
  return out;
}

/** FR-SCN-37 + FR-FOG-28: walls, doors not open and darkness, prepared once. */
function sceneOccluders(
  read: SceneRead,
  sceneId: string,
  darkness: readonly Parameters<typeof geomOf>[0][],
): SceneOccluders {
  const s = read
    .select({ walls: sceneStructure.walls, doors: sceneStructure.doors })
    .from(sceneStructure)
    .where(eq(sceneStructure.sceneId, sceneId))
    .get();
  const segs = s ? sightOccluders(s) : [];
  return prepareScene(segs, darkness);
}

/** The scene's fog `rev` (no row: −1, so a later row at rev 0 never shares a key). */
export function fogRevOf(read: SceneRead, sceneId: string): number {
  return (
    read.select({ rev: sceneFog.rev }).from(sceneFog).where(eq(sceneFog.sceneId, sceneId)).get()
      ?.rev ?? -1
  );
}
