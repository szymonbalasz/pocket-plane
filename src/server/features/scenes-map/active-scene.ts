// Active-scene cache (FR-MAP-06, CON-22/23, live-sync §8): in memory, filled from the DB on
// first read per campaign (= rebuilt at boot), refreshed by a commit hook after `SceneActivated`
// or `OverviewShown` commits and before any listener (incl. the broadcaster) runs. The scene gate
// reads it. ADR-0075: in the sync layer "active scene" means the shown thing: the active scene or
// the shown overview (at most one of them, FR-OVW-06). `activeSceneOf(tx, cid)` stays battle-only.
import { OverviewShown } from "@shared/events/overview-scenes";
import { SceneActivated } from "@shared/events/scenes-map";
import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { overview, scene } from "../../db/schema";
import type { DispatchedEvent } from "../../events/types";

export class ActiveSceneCache {
  private byCampaign = new Map<string, string | null>();

  constructor(private readonly db: Db) {}

  private load(campaignId: string): string | null {
    const r = this.db
      .select({ id: scene.id })
      .from(scene)
      .where(and(eq(scene.campaignId, campaignId), eq(scene.active, true)))
      .get();
    if (r) return r.id;
    const shown = this.db
      .select({ id: overview.id })
      .from(overview)
      .where(and(eq(overview.campaignId, campaignId), eq(overview.active, true)))
      .get();
    return shown?.id ?? null;
  }

  get(campaignId: string): string | null {
    if (!this.byCampaign.has(campaignId)) this.byCampaign.set(campaignId, this.load(campaignId));
    return this.byCampaign.get(campaignId) ?? null;
  }

  /** Commit hook: reload the campaign's entry from the committed DB. */
  onCommit(e: DispatchedEvent): void {
    if (e.event.type !== SceneActivated.type && e.event.type !== OverviewShown.type) return;
    if (!e.event.campaignId) return;
    this.byCampaign.set(e.event.campaignId, this.load(e.event.campaignId));
  }
}

/**
 * `sync.loadScene` scope check (ADR-0041): the scene's or overview's campaign (ADR-0075: one ID
 * generator, never a collision), or null if it doesn't exist.
 */
export function sceneCampaignOf(db: Db, sceneId: string): string | null {
  const r = db
    .select({ campaignId: scene.campaignId })
    .from(scene)
    .where(eq(scene.id, sceneId))
    .get();
  if (r) return r.campaignId;
  const o = db
    .select({ campaignId: overview.campaignId })
    .from(overview)
    .where(eq(overview.id, sceneId))
    .get();
  return o?.campaignId ?? null;
}
