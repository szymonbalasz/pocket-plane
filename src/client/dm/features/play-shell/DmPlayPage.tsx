// DM play page (FR-SHELL-01/02/03/06): shell frame with the campaign switcher and presence
// badge; `screen` (loading) replaces the frame while the window manager stays mounted.
import type { CampaignSummary, PlayerRecord } from "@shared/campaign-management/schemas";
import type { PresenceRecord } from "@shared/live-sync/schemas";
import { Button } from "@ui/components/ui/button";
import { Tooltip } from "@ui/components/ui/overlays";
import { Badge } from "@ui/components/ui/primitives";
import { PlayFrame } from "@ui/features/play-shell/PlayFrame";
import { ShellProvider, useOpenWindow } from "@ui/features/play-shell/ShellContext";
import { useRecords } from "@ui/sync/store";
import { dmWindows } from "../../windows";
import { CampaignBar } from "../campaign-management/CampaignBar";
import { DmMapBase, DmMapToolRail } from "../scenes-map/DmMap";
import { PLAYERS_KIND } from "./players-window";

/** "N/M online", tooltip lists names; opens the Players window (FR-SHELL-06, OQ-SHELL-11). */
function PresenceBadge() {
  const players = useRecords<PlayerRecord>("player");
  const presence = useRecords<PresenceRecord>("presence");
  const openWindow = useOpenWindow();
  const online = new Set(presence.filter((p) => p.online).map((p) => p.playerId));
  const names = players.filter((p) => online.has(p.id)).map((p) => p.name);
  return (
    <Tooltip content={names.length ? names.join(", ") : "Nobody online"}>
      <button
        type="button"
        data-testid="ui-presence-badge"
        data-online={names.length}
        data-total={players.length}
        onClick={() => openWindow(PLAYERS_KIND)}
      >
        <Badge variant="outline" className="cursor-pointer hover:bg-accent">
          {names.length}/{players.length} online
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
  return (
    <ShellProvider registry={dmWindows}>
      {screen ?? (
        <PlayFrame
          client="dm"
          topLeft={<CampaignBar campaigns={campaigns} />}
          topRight={<PresenceBadge />}
          topEnd={
            <Button variant="ghost" size="sm" data-testid="camp-logout" onClick={onLogout}>
              Log out
            </Button>
          }
          base={<DmMapBase />}
          toolRail={<DmMapToolRail />}
        />
      )}
    </ShellProvider>
  );
}
