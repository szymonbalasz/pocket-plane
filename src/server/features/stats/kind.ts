// Notification kinds of stats. `stats-awards` (FR-NOTE-48): info to all, no action, payload
// player-safe (`{fromN, toN, from, to, label}`); made only by `stats.showAwards`. No `endRule`:
// awards outlive fights. `stats-fight-summary` (sprint 8, FR-NOTE-68): info to `all` or `dm`,
// payload `{encounterId}`, made only by the `ended` rule hook (`summary.ts`); toast class info
// (FR-NOTE-52). Client views (icons, Open) are ST2's / SB1's.
import {
  STATS_AWARDS_KIND,
  STATS_FIGHT_SUMMARY_KIND,
  StatsAwardsPayload,
  StatsFightSummaryPayload,
} from "@shared/stats/schemas";
import { defineNotificationKind } from "../notifications/kind";

export const statsAwardsKind = defineNotificationKind({
  kind: STATS_AWARDS_KIND,
  ownerSpec: "stats",
  payload: StatsAwardsPayload,
  genericResolve: false,
});

export const statsFightSummaryKind = defineNotificationKind({
  kind: STATS_FIGHT_SUMMARY_KIND,
  ownerSpec: "stats",
  payload: StatsFightSummaryPayload,
  genericResolve: false,
});
