// Drag preview routing (FR-MAP-41, FR-SYNC-28, ADR-0033): the `audience` hook of `map.drag`.
// One indexed token read per frame, no writes. A player sender must be allowed to move the token
// (FR-MAP-21, checked first so a hidden token looks unknown, #130); then the `sceneId` must match.
// A hidden token, or one on a scene that is not active, routes to other DM connections only.
import type { DragData } from "@shared/scenes-map/schemas";
import { and, eq } from "drizzle-orm";
import { forbidden, invalid, notFound } from "../../commands/errors";
import { token } from "../../db/schema";
import type { SignalAudience, SignalRead, SignalSender } from "../../ws/signals";

export function dragAudience(
  data: DragData,
  sender: SignalSender,
  read: SignalRead,
): SignalAudience {
  const t = read.db
    .select({
      sceneId: token.sceneId,
      hidden: token.hidden,
      ownerPlayerId: token.ownerPlayerId,
    })
    .from(token)
    .where(and(eq(token.id, data.tokenId), eq(token.campaignId, sender.campaignId)))
    .get();
  if (!t) throw notFound("Token not found");
  const onActive = read.activeSceneOf(sender.campaignId) === t.sceneId;
  if (sender.role === "player") {
    if (t.hidden || !onActive) throw notFound("Token not found");
    if (t.ownerPlayerId === null || t.ownerPlayerId !== sender.playerId) {
      throw forbidden("Not your token");
    }
  }
  if (t.sceneId !== data.sceneId) {
    throw invalid("Token is not on that scene", [{ path: ["sceneId"], message: "Wrong scene" }]);
  }
  return t.hidden || !onActive ? "dm" : "all";
}
