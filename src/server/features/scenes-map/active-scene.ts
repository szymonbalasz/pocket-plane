// Active-scene cache (FR-MAP-06, CON-22/23, live-sync §8): in memory, filled from the DB on
// first read per campaign (= rebuilt at boot), refreshed by a commit hook after `SceneActivated`
// commits and before any listener (incl. the broadcaster) runs. The scene gate reads it.
import { SceneActivated } from "@shared/events/scenes-map";
import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { scene } from "../../db/schema";
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
    return r?.id ?? null;
  }

  get(campaignId: string): string | null {
    if (!this.byCampaign.has(campaignId)) this.byCampaign.set(campaignId, this.load(campaignId));
    return this.byCampaign.get(campaignId) ?? null;
  }

  /** Commit hook: reload the campaign's entry from the committed DB. */
  onCommit(e: DispatchedEvent): void {
    if (e.event.type !== SceneActivated.type || !e.event.campaignId) return;
    this.byCampaign.set(e.event.campaignId, this.load(e.event.campaignId));
  }
}

/** `sync.loadScene` scope check (ADR-0041): the scene's campaign, or null if it doesn't exist. */
export function sceneCampaignOf(db: Db, sceneId: string): string | null {
  const r = db
    .select({ campaignId: scene.campaignId })
    .from(scene)
    .where(eq(scene.id, sceneId))
    .get();
  return r?.campaignId ?? null;
}
