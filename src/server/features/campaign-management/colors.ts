// Player colours, server side (CAMP FR-CAMP-23–26; ADR-0055): defaults at player add, the boot
// backfill, and the `camp.setColor` intent. Colours live only on `player.color` and
// `campaign.dm_color`; every other feature derives them from the person it already names.
import { defaultColor, isPlayerColor, type PlayerColor } from "@shared/campaign-management/colors";
import { SetColorInput } from "@shared/campaign-management/schemas";
import { PlayerColorSet } from "@shared/events/campaign-management";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { defineCommand } from "../../commands/commands";
import { conflict, forbidden, notFound } from "../../commands/errors";
import type { Db, Tx } from "../../db/client";
import { campaign, player } from "../../db/schema";
import { toCampaignRecord, toPlayerRecord } from "./records";

type Reader = Pick<Tx, "select">;

/** Who holds which colour in a campaign: the DM first, then players in `createdAt, rowid` order. */
function holders(tx: Reader, campaignId: string) {
  const dm = tx
    .select({ dmColor: campaign.dmColor })
    .from(campaign)
    .where(eq(campaign.id, campaignId))
    .get();
  const players = tx
    .select({ id: player.id, name: player.name, color: player.color })
    .from(player)
    .where(eq(player.campaignId, campaignId))
    .orderBy(asc(player.createdAt), asc(sql`rowid`))
    .all();
  return { dmColor: dm?.dmColor ?? null, players };
}

/** FR-CAMP-23: the default for a new player of `campaignId` (call before the insert). */
export function nextDefaultColor(tx: Reader, campaignId: string): PlayerColor {
  const { dmColor, players } = holders(tx, campaignId);
  const taken = [dmColor, ...players.map((p) => p.color)].filter(isPlayerColor);
  return defaultColor(taken);
}

/**
 * FR-CAMP-23 boot backfill (a start hook, before the server listens): per campaign, players with
 * a null colour get defaults in `createdAt, rowid` order, each seeing the ones before it. One
 * transaction; no event, no log row (a migration, like FR-FOG-40); rerun = no-op. Returns how
 * many rows it filled.
 */
export function backfillPlayerColors(db: Db): number {
  return db.transaction((tx) => {
    const campaigns = tx
      .selectDistinct({ id: player.campaignId })
      .from(player)
      .where(isNull(player.color))
      .all();
    let n = 0;
    for (const { id: campaignId } of campaigns) {
      const { dmColor, players } = holders(tx, campaignId);
      const taken = [dmColor, ...players.map((p) => p.color)].filter(isPlayerColor);
      for (const p of players) {
        if (p.color !== null) continue;
        const color = defaultColor(taken);
        tx.update(player).set({ color }).where(eq(player.id, p.id)).run();
        taken.push(color);
        n++;
      }
    }
    return n;
  });
}

/**
 * FR-CAMP-25 / -26 `camp.setColor {playerId | null, color}`: a player sets their own colour, the
 * DM any player's of the campaign or (`null`) the DM colour. A pick must be free among the DM
 * colour and every other player's (checked in this transaction; SQLite's single writer
 * serialises racing picks) → else `conflict` "Taken by ‹name›". Same colour → ack, no write.
 */
export const setColor = defineCommand({
  name: "camp.setColor",
  input: SetColorInput,
  roles: ["dm", "player"],
  authorize({ playerId }, { actor }) {
    if (actor.role === "player" && playerId !== actor.playerId) {
      throw forbidden("You can only set your own colour");
    }
  },
  execute({ playerId, color }, { tx, ctx, actor, emit }) {
    const campaignId = actor.campaignId;
    if (!campaignId) throw notFound("Campaign not found");
    const camp = tx.select().from(campaign).where(eq(campaign.id, campaignId)).get();
    if (!camp) throw notFound("Campaign not found");
    const row =
      playerId === null
        ? null
        : tx
            .select()
            .from(player)
            .where(and(eq(player.id, playerId), eq(player.campaignId, campaignId)))
            .get();
    if (playerId !== null && !row) throw notFound("Player not found");
    const current = row ? row.color : camp.dmColor;
    if (current === color) return {};

    const { dmColor, players } = holders(tx, campaignId);
    if (playerId !== null && dmColor === color) throw conflict("Taken by DM");
    const taker = players.find((p) => p.id !== playerId && p.color === color);
    if (taker) throw conflict(`Taken by ${taker.name}`);

    const now = ctx.clock.iso();
    if (row) {
      tx.update(player).set({ color, updatedAt: now }).where(eq(player.id, row.id)).run();
      emit({
        type: PlayerColorSet.type,
        campaignId,
        payload: { playerId: row.id, color },
        changes: [
          {
            type: "player",
            id: row.id,
            before: toPlayerRecord(row),
            after: toPlayerRecord({ ...row, color }),
          },
        ],
      });
    } else {
      tx.update(campaign)
        .set({ dmColor: color, updatedAt: now })
        .where(eq(campaign.id, campaignId))
        .run();
      emit({
        type: PlayerColorSet.type,
        campaignId,
        payload: { playerId: null, color },
        changes: [
          {
            type: "campaign",
            id: campaignId,
            before: toCampaignRecord(camp),
            after: toCampaignRecord({ ...camp, dmColor: color }),
          },
        ],
      });
    }
    return {};
  },
});
