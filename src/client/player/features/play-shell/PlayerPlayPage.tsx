// Player play page (FR-SHELL-01/02/04/06). `screen` (loading, waiting, invalid link) replaces
// the whole frame; the window manager stays mounted, so leaving `waiting` restores the shell
// with windows as they were, without reload.
import { PlayFrame } from "@ui/features/play-shell/PlayFrame";
import { ShellProvider } from "@ui/features/play-shell/ShellContext";
import { playerWindows } from "../../windows";
import { PlayerPresentPopup } from "../party-board/present-popup";
import { PlayerMapBase, PlayerMapToolRail } from "../scenes-map/PlayerMap";

export function PlayerPlayPage({
  screen,
  header,
}: {
  screen: React.ReactNode;
  /** "Playing as ‹player› in ‹campaign›" (campaign-management wording). */
  header: React.ReactNode;
}) {
  return (
    <ShellProvider registry={playerWindows}>
      {screen ?? (
        <PlayFrame
          client="player"
          topLeft={header}
          base={<PlayerMapBase />}
          toolRail={<PlayerMapToolRail />}
        />
      )}
      {/* FR-PARTY-36: a handout the DM presents, over every window and toast (seams S4). */}
      <PlayerPresentPopup />
    </ShellProvider>
  );
}
