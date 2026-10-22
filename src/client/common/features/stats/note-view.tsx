// Views of kinds `stats-awards` (FR-NOTE-48) and `stats-fight-summary` (FR-NOTE-68), both
// clients: icon, the text and an Open button (client-only, not an action) that opens Stats on
// those awards (`openStatsAwards`, FR-SHELL-94) or that fight with Highlights (`openStatsFight`,
// FR-STATS-34): how a player offline at the time gets there. The DM's summary row adds the
// encounter's name from its own store (players' encounter rows carry none).
import { ENCOUNTER_TYPE } from "@shared/combat-tracker/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import {
  STATS_AWARDS_KIND,
  STATS_FIGHT_SUMMARY_KIND,
  StatsAwardsPayload,
  StatsFightSummaryPayload,
} from "@shared/stats/schemas";
import { SwordsIcon, TrophyIcon } from "lucide-react";
import { Button } from "../../components/ui/button";
import { useSync } from "../../sync/store";
import { defineNotificationView } from "../notifications/views";
import { useOpenStatsAwards, useOpenStatsFight } from "./open";

function StatsAwards({ notification: n }: { notification: NotificationRecord }) {
  const open = useOpenStatsAwards();
  const p = StatsAwardsPayload.safeParse(n.payload);
  return (
    <span className="flex flex-col items-start gap-1">
      <span>{n.text}</span>
      {p.success ? (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-1.5"
          data-testid="note-stats-awards-open"
          onClick={() => open(p.data.fromN)}
        >
          Open
        </Button>
      ) : null}
    </span>
  );
}

export const statsAwardsView = defineNotificationView({
  kind: STATS_AWARDS_KIND,
  icon: TrophyIcon,
  render: StatsAwards,
});

function FightSummary({ notification: n }: { notification: NotificationRecord }) {
  const open = useOpenStatsFight();
  const p = StatsFightSummaryPayload.safeParse(n.payload);
  const encounterId = p.success ? p.data.encounterId : null;
  const name = useSync((s) => {
    if (s.store.you?.role !== "dm" || !encounterId) return null;
    const e = s.store.records[ENCOUNTER_TYPE]?.[encounterId] as { name?: unknown } | undefined;
    return typeof e?.name === "string" ? e.name : null;
  });
  return (
    <span className="flex flex-col items-start gap-1">
      <span>
        {n.text}
        {name ? <span data-testid="stats-summary-name">: {name}</span> : null}
      </span>
      {encounterId ? (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-1.5"
          data-testid="stats-summary-open"
          onClick={() => open(encounterId)}
        >
          Open
        </Button>
      ) : null}
    </span>
  );
}

export const statsFightSummaryView = defineNotificationView({
  kind: STATS_FIGHT_SUMMARY_KIND,
  icon: SwordsIcon,
  render: FightSummary,
});
