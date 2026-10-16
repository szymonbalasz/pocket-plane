// The wall move guard (FR-SCN-10, -11, -38; ADR-0040), a line in scenes-map's `move-guards.ts`. A
// player's `map.moveToken` is refused when the straight line between the footprint centres of
// `from` and `to` crosses or touches a wall or a non-open door. The DM is never checked. Reads only
// the scene's structure row through the move's transaction (the committed state at drop); the
// parsed segments are cached by `(sceneId, rev)` (SCN §12), checked against the row's head.

import { moveBlocked, wallHint } from "@shared/scene-tools/geometry";
import { type Door, WALL_GUARD, type Wall } from "@shared/scene-tools/schemas";
import { footprint } from "@shared/scenes-map/geometry";
import { eq, sql } from "drizzle-orm";
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

/**
 * FR-SCN-10 / -11 / -38: refuses a player's blocked move; the hint (for `map.checkMove`) is one
 * piece of the **first** crossed segment, ≤ 0.5 cell either side of the crossing (review A3).
 */
export const scnWallGuard: MoveGuardRegistration = {
  name: WALL_GUARD,
  guard(env, token, from, to) {
    if (env.actor.role !== "player") return undefined;
    const s = guardSegments(env.read, token.sceneId);
    const n = footprint(token.size);
    if (!s || !moveBlocked(from, to, n, s.walls, s.doors)) return undefined;
    const piece = wallHint(from, to, n, s.walls, s.doors);
    return {
      refuse: WALL_BLOCKED,
      ...(piece ? { hint: { segments: [[piece[0], piece[1], piece[2], piece[3]]] } } : {}),
    };
  },
};
