// `useFeature` (FR-CAMP-45, ADR-0058): is an optional feature on in this connection's campaign?
// Reads the `campaign` record the store already holds (`features`, absent = all off); a feature's
// UI renders nothing while it is false. The server never sends a feature's data while it is off,
// so this only decides what to draw, never what the client may hold.
import { hasFeature } from "@shared/campaign-management/features";
import type { CampaignRecord } from "@shared/campaign-management/schemas";
import type { RecordStore } from "@shared/protocol/store";
import { useSync } from "@ui/sync/store";

type Records = Pick<RecordStore, "you" | "records">;

/** The store's own campaign (a client holds only that one), or undefined before a snapshot. */
function ownCampaign(store: Records): CampaignRecord | undefined {
  const byId = store.records.campaign as Record<string, CampaignRecord> | undefined;
  if (!byId) return undefined;
  const own = store.you?.campaignId ? byId[store.you.campaignId] : undefined;
  return own ?? Object.values(byId)[0];
}

/** FR-CAMP-45: `key` is on in the store's campaign (no campaign row → false). */
export function isFeatureOn(store: Records, key: string): boolean {
  return hasFeature(ownCampaign(store)?.features, key);
}

/** FR-CAMP-45: the hook form; re-renders when the switch changes (a resync replaces the row). */
export function useFeature(key: string): boolean {
  return useSync((s) => isFeatureOn(s.store, key));
}
