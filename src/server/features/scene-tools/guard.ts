// The wall move guard (FR-SCN-10, -11; ADR-0040), a line in scenes-map's `move-guards.ts`. A
// player's `map.moveToken` is refused when the straight line between the footprint centres of
// `from` and `to` crosses or touches a wall or a non-open door. The DM is never checked. Reads only
// the scene's structure row through the move's transaction (the committed state at drop).

import { moveBlocked } from "@shared/scene-tools/geometry";
import { footprint } from "@shared/scenes-map/geometry";
import { conflict } from "../../commands/errors";
import type { MoveGuardRegistration } from "../scenes-map/move-guards";
import { readStructure } from "./rows";

/** Same text for a wall, a closed and a locked door (FR-SCN-11). */
export const WALL_BLOCKED = "Blocked by a wall or door";

export const scnWallGuard: MoveGuardRegistration = {
  name: "scene-tools.walls",
  guard(env, token, from, to) {
    if (env.actor.role !== "player") return;
    const s = readStructure(env.read, token.sceneId);
    if (s && moveBlocked(from, to, footprint(token.size), s.walls, s.doors)) {
      throw conflict(WALL_BLOCKED);
    }
  },
};
