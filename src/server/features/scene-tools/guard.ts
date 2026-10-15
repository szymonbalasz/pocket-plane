// The wall move guard (FR-SCN-10, -11; ADR-0040), a line in scenes-map's `move-guards.ts`. A
// player's `map.moveToken` is refused when the straight line between the footprint centres of
// `from` and `to` crosses or touches a wall or a non-open door. The DM is never checked. Reads only
// the scene's structure row through the move's transaction (the committed state at drop); the
// parsed segments are cached by `(sceneId, rev)` (SCN §12), checked against the row's head.

import { moveBlocked } from "@shared/scene-tools/geometry";
import type { Door, Wall } from "@shared/scene-tools/schemas";
import { footprint } from "@shared/scenes-map/geometry";
import { eq, sql } from "drizzle-orm";
import { conflict } from "../../commands/errors";
import { sceneStructure } from "../../db/schema";
import type { MoveGuardRegistration } from "../scenes-map/move-guards";
import type { SceneRead } from "../scenes-map/visibility-hooks";
import { readStructure } from "./rows";

/** Same text for a wall, a closed and a locked door (FR-SCN-11). */
export const WALL_BLOCKED = "Blocked by a wall or door";

const CACHE_MAX = 64;
const cache = new Map<string, { key: string; walls: Wall[]; doors: Door[] }>();

/**
 * The scene's segments, or null (no row). The head (`rev`, `nextN`, `updatedAt`, sizes) is read
 * every time; the JSON leaves only when it changed.
 */
export function guardSegments(
  read: SceneRead,
  sceneId: string,
): { walls: Wall[]; doors: Door[] } | null {
  const s = sceneStructure;
  const head = read
    .select({
      rev: s.rev,
      nextN: s.nextN,
      updatedAt: s.updatedAt,
      bytes: sql<number>`octet_length(${s.walls}) + octet_length(${s.doors})`,
    })
    .from(s)
    .where(eq(s.sceneId, sceneId))
    .get();
  if (!head) return null;
  const key = `${head.rev}|${head.nextN}|${head.updatedAt}|${head.bytes}`;
  const hit = cache.get(sceneId);
  if (hit?.key === key) return hit;
  const r = readStructure(read, sceneId);
  if (!r) return null;
  const entry = { key, walls: r.walls, doors: r.doors };
  cache.delete(sceneId);
  cache.set(sceneId, entry);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return entry;
}

export const scnWallGuard: MoveGuardRegistration = {
  name: "scene-tools.walls",
  guard(env, token, from, to) {
    if (env.actor.role !== "player") return;
    const s = guardSegments(env.read, token.sceneId);
    if (s && moveBlocked(from, to, footprint(token.size), s.walls, s.doors)) {
      throw conflict(WALL_BLOCKED);
    }
  },
};
