// Test support for party-board: party-loot's seed (two players, Mira + Thorn, a second campaign)
// plus image assets written straight to the table (two in Fixture Campaign, one in Second).
import { eq } from "drizzle-orm";
import { manualClock } from "../../commands/context";
import { asset, assetSeqNext, player } from "../../db/schema";
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
