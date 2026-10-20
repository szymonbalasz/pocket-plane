// Player colours, server side (CAMP FR-CAMP-23–26, -30–34; ADR-0055 amended by ADR-0057):
// defaults at player add, the boot migration, and the `camp.setColor` intent. Colours live only
// on `player.color` and `campaign.dm_color` as lowercase `#rrggbb`; every other feature derives
// them from the person it already names.
import {
  COLOR_PROBLEM_MESSAGE,
  type ColorHolder,
  colorClash,
  colorProblem,
  DM_DEFAULT_COLOR,
  defaultColor,
  isHexColor,
  normalizeColor,
} from "@shared/campaign-management/colors";
import { SetColorInput } from "@shared/campaign-management/schemas";
import { PlayerColorSet } from "@shared/events/campaign-management";
import { and, asc, eq, sql } from "drizzle-orm";
import { defineCommand } from "../../commands/commands";
import { conflict, forbidden, invalid, notFound } from "../../commands/errors";
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

/** FR-CAMP-23, -32: the default for a new player of `campaignId` (call before the insert). */
export function nextDefaultColor(tx: Reader, campaignId: string): string {
  const { dmColor, players } = holders(tx, campaignId);
  return defaultColor([dmColor, ...players.map((p) => p.color)].filter((c) => c !== null));
}

export interface ColorMigration {
  /** Pass 1: palette keys → hex, uppercase hex → lowercase. */
  normalised: number;
  /** Pass 2: DM colours → Amber, player colours → their default. */
  filled: number;
}

/**
 * FR-CAMP-23 / -34 boot migration (a start hook, before the server listens), one transaction:
 * **pass 1** turns every palette key in `player.color` / `campaign.dm_color` into its hex and
 * lowercases hex; **pass 2** sets a still-invalid `dm_color` to Amber and gives every player
 * whose colour is null or still invalid the default (FR-CAMP-32) against the pass-1 colours, per
 * campaign in `createdAt, rowid` order, each seeing the ones before it. No event, no log row (a
 * migration, like FR-FOG-40); rerun = no-op.
 */
export function migratePlayerColors(db: Db): ColorMigration {
  return db.transaction((tx) => {
    let normalised = 0;
    let filled = 0;
    for (const c of tx
      .select({ id: campaign.id, dmColor: campaign.dmColor })
      .from(campaign)
      .all()) {
      const hex = normalizeColor(c.dmColor);
      if (hex && hex !== c.dmColor) {
        tx.update(campaign).set({ dmColor: hex }).where(eq(campaign.id, c.id)).run();
        normalised++;
      }
    }
    for (const p of tx.select({ id: player.id, color: player.color }).from(player).all()) {
      const hex = normalizeColor(p.color);
      if (hex && hex !== p.color) {
        tx.update(player).set({ color: hex }).where(eq(player.id, p.id)).run();
        normalised++;
      }
    }
    for (const c of tx
      .select({ id: campaign.id, dmColor: campaign.dmColor })
      .from(campaign)
      .all()) {
      if (!isHexColor(c.dmColor)) {
        tx.update(campaign).set({ dmColor: DM_DEFAULT_COLOR }).where(eq(campaign.id, c.id)).run();
        filled++;
      }
      const { dmColor, players } = holders(tx, c.id);
      const taken = [dmColor, ...players.map((p) => p.color)].filter(isHexColor);
      for (const p of players) {
        if (isHexColor(p.color)) continue;
        const color = defaultColor(taken);
        tx.update(player).set({ color }).where(eq(player.id, p.id)).run();
        taken.push(color);
        filled++;
      }
    }
    return { normalised, filled };
  });
}

/**
 * FR-CAMP-25 / -33 `camp.setColor {playerId | null, color}`: a player sets their own colour, the
 * DM any player's of the campaign or (`null`) the DM colour. In this transaction, in order:
 * FR-CAMP-31 validity → `invalid` with its message; same colour → ack, no write; FR-CAMP-32
 * distance from the DM colour and every other player's → `conflict` "Taken by ‹name›" / "Too
 * close to ‹name›'s colour…" (SQLite's single writer serialises racing picks); else write + event.
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
    const problem = colorProblem(color);
    if (problem) throw invalid(COLOR_PROBLEM_MESSAGE[problem]);
    const current = row ? row.color : camp.dmColor;
    if (current === color) return {};

    const { dmColor, players } = holders(tx, campaignId);
    const others: ColorHolder[] = [
      ...(playerId !== null && dmColor ? [{ by: "dm", name: "DM", color: dmColor }] : []),
      ...players
        .filter((p) => p.id !== playerId && p.color !== null)
        .map((p) => ({ by: p.id, name: p.name, color: p.color as string })),
    ];
    const clash = colorClash(color, others);
    if (clash) throw conflict(clash.message);

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
