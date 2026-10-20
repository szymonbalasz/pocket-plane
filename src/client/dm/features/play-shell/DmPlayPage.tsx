// DM play page (FR-SHELL-01/02/03/06): shell frame with the campaign switcher and presence
// badge; `screen` (loading) replaces the frame while the window manager stays mounted.
import type { CampaignSummary, PlayerRecord } from "@shared/campaign-management/schemas";
import { Tooltip } from "@ui/components/ui/overlays";
import { Badge } from "@ui/components/ui/primitives";
import { PlayFrame } from "@ui/features/play-shell/PlayFrame";
import { ShellProvider, useOpenWindow } from "@ui/features/play-shell/ShellContext";
import { cn } from "@ui/lib/utils";
import { presenceBadge } from "@ui/sync/presence";
import { usePresence, useRecords } from "@ui/sync/store";
import { dmWindows } from "../../windows";
import { LogoutContext } from "../campaign-management/AccountSection";
import { CampaignBar } from "../campaign-management/CampaignBar";
import { DmMapBase, DmMapToolRail } from "../scenes-map/DmMap";
import { PLAYERS_KIND } from "./players-window";

/**
 * "N/M online", tooltip lists names; opens the Players window (FR-SHELL-06, OQ-SHELL-11).
 * While not live: "– / M online", muted, `data-state="unknown"` (FR-SHELL-33).
 */
function PresenceBadge() {
  const players = useRecords<PlayerRecord>("player");
  const badge = presenceBadge(usePresence(), players);
  const openWindow = useOpenWindow();
  return (
    <Tooltip content={badge.tooltip}>
      <button
        type="button"
        data-testid="ui-presence-badge"
        data-state={badge.state}
        data-online={badge.online ?? undefined}
        data-total={players.length}
        onClick={() => openWindow(PLAYERS_KIND)}
      >
        <Badge
          variant="outline"
          className={cn(
            "cursor-pointer hover:bg-accent",
            badge.state === "unknown" && "text-muted-foreground",
          )}
        >
          {badge.text}
        </Badge>
      </button>
    </Tooltip>
  );
}

export function DmPlayPage({
  screen,
  campaigns,
  onLogout,
}: {
  /** Replaces the frame (e.g. loading skeleton); windows keep their state. */
  screen: React.ReactNode;
  campaigns: CampaignSummary[];
  onLogout: () => void;
}) {
  // Log out lives in Preferences' Account section (FR-CAMP-35), not the top bar.
  return (
    <LogoutContext.Provider value={onLogout}>
      <ShellProvider registry={dmWindows}>
        {screen ?? (
          <PlayFrame
            client="dm"
            topLeft={<CampaignBar campaigns={campaigns} />}
            topRight={<PresenceBadge />}
            base={<DmMapBase />}
            toolRail={<DmMapToolRail />}
          />
        )}
      </ShellProvider>
    </LogoutContext.Provider>
  );
}
