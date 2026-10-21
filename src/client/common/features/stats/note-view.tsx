// View of kind `stats-awards` (FR-NOTE-48), both clients: trophy icon, the text ("Session awards:
// Tue 20 Oct") and an Open button (client-only, not an action) that opens Stats on those awards
// (`openStatsAwards`, FR-SHELL-94): how a player offline at the time gets there.
import type { NotificationRecord } from "@shared/notifications/schemas";
import { STATS_AWARDS_KIND, StatsAwardsPayload } from "@shared/stats/schemas";
import { TrophyIcon } from "lucide-react";
import { Button } from "../../components/ui/button";
import { defineNotificationView } from "../notifications/views";
import { useOpenStatsAwards } from "./open";

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
