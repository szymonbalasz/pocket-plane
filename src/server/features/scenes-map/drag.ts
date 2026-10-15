// Drag preview routing (FR-MAP-41, FR-SYNC-28, ADR-0033): the `audience` hook of `map.drag`.
// One indexed token read per frame (plus the scene's grid while a `dragToDm` hook is registered),
// no writes. A player sender must be allowed to move the token (FR-MAP-21, checked first so a
// token hidden for players looks unknown, #130); then the `sceneId` must match. A token hidden
// for players, one on a scene that is not active, or one any `dragToDm` hook routes (FR-FOG-15,
// ADR-0039) goes to other DM connections only.
import { dropCell } from "@shared/scenes-map/geometry";
import type { DragData } from "@shared/scenes-map/schemas";
import { and, eq } from "drizzle-orm";
import { forbidden, invalid, notFound } from "../../commands/errors";
import { scene, token } from "../../db/schema";
import type { SignalAudience, SignalRead, SignalSender } from "../../ws/signals";
import { toTokenRecord } from "./rows";
import { tokenHiddenForPlayers, visibilityHooks } from "./visibility-hooks";

export function dragAudience(
  data: DragData,
  sender: SignalSender,
  read: SignalRead,
): SignalAudience {
  const row = read.db
    .select()
    .from(token)
    .where(and(eq(token.id, data.tokenId), eq(token.campaignId, sender.campaignId)))
    .get();
  if (!row) throw notFound("Token not found");
  const t = toTokenRecord(row);
  const hidden = tokenHiddenForPlayers(t);
  const onActive = read.activeSceneOf(sender.campaignId) === t.sceneId;
  if (sender.role === "player") {
    if (hidden || !onActive) throw notFound("Token not found");
    if (t.ownerPlayerId === null || t.ownerPlayerId !== sender.playerId) {
      throw forbidden("Not your token");
    }
  }
  if (t.sceneId !== data.sceneId) {
    throw invalid("Token is not on that scene", [{ path: ["sceneId"], message: "Wrong scene" }]);
  }
  if (hidden || !onActive) return "dm";
  if (!visibilityHooks.hasDragToDm()) return "all";
  return visibilityHooks.dragToDm(read.db, t, previewCell(read, data)) ? "dm" : "all";
}

/** FR-FOG-15: the previewed top-left cell (FR-MAP-15 rounding); null on an `end` frame. */
function previewCell(read: SignalRead, data: DragData): { col: number; row: number } | null {
  if ("end" in data) return null;
  const g = read.db
    .select({
      gridCellSize: scene.gridCellSize,
      gridOffsetX: scene.gridOffsetX,
      gridOffsetY: scene.gridOffsetY,
    })
    .from(scene)
    .where(eq(scene.id, data.sceneId))
    .get();
  return g ? dropCell(g, data.x, data.y) : null;
}
