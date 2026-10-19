// Test support for party-board: party-loot's seed (two players, Mira + Thorn, a second campaign)
// plus image assets written straight to the table (two in Fixture Campaign, one in Second).
import { HANDOUT_TITLE_MAX } from "@shared/party-board/schemas";
import { sharedWithPlayer } from "@shared/party-board/visibility";
import { asc, eq } from "drizzle-orm";
import { manualClock } from "../../commands/context";
import type { Db } from "../../db/client";
import {
  asset,
  assetSeqNext,
  handout,
  handoutPresent,
  handoutSeqNext,
  player,
} from "../../db/schema";
import { createTestServices } from "../../testing/services";
import type { Viewer } from "../../ws/records";
import { seedLoot } from "../party-loot/testing";

const AT = "2026-01-01T00:00:00.000Z";

export function seedParty() {
  const clock = manualClock();
  const s = createTestServices({ clock });
  const t = seedLoot(s);
  const image = (id: string, campaignId: string) =>
    s.db
      .insert(asset)
      .values({
        id,
        campaignId,
        seq: assetSeqNext,
        name: id,
        hash: `hash-${id}`,
        mime: "image/png",
        bytes: 100,
        width: 10,
        height: 10,
        displayWidth: 10,
        displayHeight: 10,
        createdAt: AT,
      })
      .run();
  // Capability-style ids: 22 chars of [A-Za-z0-9_-] (ADR-0023).
  const images = {
    map: "imgMap_aaaaaaaaaaaaaaa",
    poster: "imgPoster_aaaaaaaaaaaa",
    second: "imgSecond_aaaaaaaaaaaa",
  };
  image(images.map, t.campaignId);
  image(images.poster, t.campaignId);
  image(images.second, t.secondCampaignId);
  const load = (v: Viewer, type: string, ids?: string[]) =>
    s.records.load({ db: s.db, presence: { list: () => [] } }, v, type, ids)[type] ?? [];
  const secondPlayerId = s.db
    .select({ id: player.id })
    .from(player)
    .where(eq(player.campaignId, t.secondCampaignId))
    .get()?.id as string;
  return {
    ...t,
    clock,
    secondPlayerId,
    images,
    load,
  };
}

export type PartySeed = ReturnType<typeof seedParty>;

/**
 * FR-PARTY-35 invariant: every `handout-present` row is for a player of its campaign who can see
 * its handout (same campaign). Returns the violating rows' ids (empty = holds).
 */
export function presentInvariantViolations(db: Db): string[] {
  const rows = db
    .select({
      id: handoutPresent.id,
      campaignId: handoutPresent.campaignId,
      playerId: handoutPresent.playerId,
      handoutCampaignId: handout.campaignId,
      sharedWith: handout.sharedWith,
      playerCampaignId: player.campaignId,
    })
    .from(handoutPresent)
    .leftJoin(handout, eq(handout.id, handoutPresent.handoutId))
    .leftJoin(player, eq(player.id, handoutPresent.playerId))
    .all();
  return rows
    .filter(
      (r) =>
        r.sharedWith === null ||
        r.handoutCampaignId !== r.campaignId ||
        r.playerCampaignId !== r.campaignId ||
        !sharedWithPlayer(r.sharedWith, r.playerId),
    )
    .map((r) => r.id);
}

/**
 * CON-44 worst case for `handout-present` (PARTY §12 S5, seams S14): one max-length handout shared
 * with all and an open present for **every** player of the campaign (the per-player cap), written
 * straight to the tables (UUID-length ids, as `ctx.ids`). Idempotent (re-run after adding players).
 * Returns the number of rows.
 */
export function writeWorstPresents(db: Db, campaignId: string): number {
  const at = "2026-01-01T00:00:00.000Z";
  const pad = (p: string, n: number) => (p + "x".repeat(n)).slice(0, n);
  const handoutId = pad("handout-present-worst-", 36);
  const exists = db.select({ id: handout.id }).from(handout).where(eq(handout.id, handoutId)).get();
  if (!exists)
    db.insert(handout)
      .values({
        id: handoutId,
        campaignId,
        seq: handoutSeqNext,
        title: pad("Present worst ", HANDOUT_TITLE_MAX),
        body: "",
        imageAssetIds: [],
        sharedWith: { mode: "all", playerIds: [] },
        rev: 1,
        bodyRev: 1,
        createdAt: at,
        updatedAt: at,
        sharedAt: at,
      })
      .run();
  const players = db
    .select({ id: player.id })
    .from(player)
    .where(eq(player.campaignId, campaignId))
    .orderBy(asc(player.createdAt), asc(player.id))
    .all();
  // One row per player: replace any open present (unique (campaignId, playerId)).
  db.delete(handoutPresent).where(eq(handoutPresent.campaignId, campaignId)).run();
  for (const [i, p] of players.entries()) {
    db.insert(handoutPresent)
      .values({
        id: pad(`present-${i}-`, 36),
        campaignId,
        handoutId,
        playerId: p.id,
        presentedAt: at,
      })
      .run();
  }
  return players.length;
}
