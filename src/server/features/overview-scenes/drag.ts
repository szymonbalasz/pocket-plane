// Item drag preview routing (FR-OVW-37, ADR-0026, ADR-0033): the `audience` hook of `ovw.drag`, its
// own signal because `map.drag`'s hook reads the token table (ADR-0075 Decision 4). One indexed read
// per frame, no writes. A player sender follows FR-OVW-35: hidden, on an overview not shown or
// unknown → `not_found`, checked first so it looks unknown; visible but not theirs → `forbidden`. A
// frame holding any hidden item, or on an overview not shown, goes to other DM connections only.
import type { ItemDragData } from "@shared/overview-scenes/schemas";
import { and, eq, inArray } from "drizzle-orm";
import { forbidden, invalid, notFound } from "../../commands/errors";
import { overviewItem } from "../../db/schema";
import type { SignalAudience, SignalRead, SignalSender } from "../../ws/signals";

const NOT_FOUND = "Item not found";

export function itemDragAudience(
  data: ItemDragData,
  sender: SignalSender,
  read: SignalRead,
): SignalAudience {
  const ids = "end" in data ? data.itemIds : data.moves.map((m) => m.itemId);
  const isPlayer = sender.role === "player";
  if (isPlayer && ids.length !== 1) {
    throw invalid("Invalid signal", [{ path: ["moves"], message: "One item at a time" }]);
  }
  const rows = read.db
    .select({
      kind: overviewItem.kind,
      hidden: overviewItem.hidden,
      locked: overviewItem.locked,
      ownerPlayerId: overviewItem.ownerPlayerId,
    })
    .from(overviewItem)
    .where(
      and(
        eq(overviewItem.campaignId, sender.campaignId),
        eq(overviewItem.overviewId, data.overviewId),
        inArray(overviewItem.id, ids),
      ),
    )
    .all();
  if (rows.length !== ids.length) throw notFound(NOT_FOUND);
  const shown = read.activeSceneOf(sender.campaignId) === data.overviewId;
  const anyHidden = rows.some((r) => r.hidden);
  if (isPlayer) {
    if (!shown || anyHidden) throw notFound(NOT_FOUND);
    // `ovw.moveItems` would refuse the drop (§9), so nobody sees it move.
    const own = (r: (typeof rows)[number]) =>
      r.kind === "miniature" && r.ownerPlayerId === sender.playerId && !r.locked;
    if (!rows.every(own)) throw forbidden("Not your miniature");
  }
  return !shown || anyHidden ? "dm" : "all";
}
