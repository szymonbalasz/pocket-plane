// Drag preview routing (FR-MAP-41, FR-SYNC-28, ADR-0033 / ADR-0042): the `audience` hook of
// `map.drag`. One indexed token read per frame (plus the scene's grid and fog while a
// `dragAudience` hook is registered), no writes. A player sender must see the token (hidden or
// fog-hidden for them → `not_found`, FR-FOG-11, checked first so it looks unknown) and own it
// (FR-MAP-21, `forbidden`); then the `sceneId` must match. A token hidden for players or on a
// scene that is not active goes to other DM connections only; else to the DM plus the players
// every `dragAudience` hook allows (FR-FOG-15: who sees the stored token and, on a position
// frame, the token at the previewed cell).
import { dropCell } from "@shared/scenes-map/geometry";
import type { DragData } from "@shared/scenes-map/schemas";
import { and, eq } from "drizzle-orm";
import { forbidden, invalid, notFound } from "../../commands/errors";
import { scene, token } from "../../db/schema";
import type { SignalAudience, SignalRead, SignalSender } from "../../ws/signals";
import { toTokenRecord } from "./rows";
import { tokenHiddenFor, tokenHiddenForPlayers, visibilityHooks } from "./visibility-hooks";

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
  const onActive = read.activeSceneOf(sender.campaignId) === t.sceneId;
  if (sender.role === "player") {
    if (!onActive || tokenHiddenFor(t, sender.playerId ?? null, sender.campaignId)) {
      throw notFound("Token not found");
    }
    if (t.ownerPlayerId === null || t.ownerPlayerId !== sender.playerId) {
      throw forbidden("Not your token");
    }
  }
  if (t.sceneId !== data.sceneId) {
    throw invalid("Token is not on that scene", [{ path: ["sceneId"], message: "Wrong scene" }]);
  }
  // Hidden, or seen by no player (party-level, FR-FOG-14): every frame stays with the DM.
  if (!onActive || tokenHiddenForPlayers(t)) return "dm";
  if (!visibilityHooks.hasDragAudience()) return "all";
  const players = visibilityHooks.dragAudience(read.db, t, previewCell(read, data)) ?? [];
  return players.length === 0 ? "dm" : { players };
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
