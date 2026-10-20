// Notification kind `stats-awards` (FR-NOTE-48): info to all, no action, payload player-safe
// (`{fromN, toN, from, to, label}`); made only by `stats.showAwards`. No `endRule`: awards outlive
// fights. Client views (Trophy icon, Open) are ST2's.
import { STATS_AWARDS_KIND, StatsAwardsPayload } from "@shared/stats/schemas";
import { defineNotificationKind } from "../notifications/kind";

export const statsAwardsKind = defineNotificationKind({
  kind: STATS_AWARDS_KIND,
  ownerSpec: "stats",
  payload: StatsAwardsPayload,
  genericResolve: false,
});
