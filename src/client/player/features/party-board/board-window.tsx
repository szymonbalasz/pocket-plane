// Player `party.board` (FR-PARTY-11, -13): handouts shared with this player, newest shared first,
// "Shared with you" / "Everyone" (no other names, OQ-PARTY-10), New / Updated from this browser's
// seen revs. Read only.
import { playerShareLabel } from "@shared/party-board/format";
import type { PlayerHandoutRecord } from "@shared/party-board/schemas";
import { Badge } from "@ui/components/ui/primitives";
import { PartyBoard } from "@ui/features/party-board/Board";
import {
  HandoutListBody,
  HandoutRow,
  ShareBadge,
  useHandoutHeaders,
} from "@ui/features/party-board/HandoutList";
import { MARK_TEXT, markOf, playerOrder } from "@ui/features/party-board/logic";
import { useSeenRevs } from "@ui/features/party-board/player-seen";
import { partyBoardWindowBase } from "@ui/features/party-board/window";
import { defineWindow } from "@ui/features/play-shell/registry";
import { useMemo } from "react";

function PlayerHandouts() {
  const headers = useHandoutHeaders();
  const seen = useSeenRevs();
  const rows = useMemo(
    () => playerOrder(headers.rows as unknown as PlayerHandoutRecord[]),
    [headers.rows],
  );
  return (
    <HandoutListBody headers={headers}>
      {rows.map((h) => {
        const mark = markOf(h.rev, seen[h.id]);
        return (
          <HandoutRow
            key={h.id}
            h={h}
            badge={<ShareBadge label={playerShareLabel(h.sharedWith)} muted={false} />}
            mark={
              mark && (
                <Badge data-testid="party-handout-new" data-value={mark} className="px-1.5 py-0">
                  {MARK_TEXT[mark]}
                </Badge>
              )
            }
          />
        );
      })}
    </HandoutListBody>
  );
}

function PlayerPartyBoard() {
  return <PartyBoard handouts={<PlayerHandouts />} />;
}

export const playerPartyBoardWindow = defineWindow({
  ...partyBoardWindowBase,
  clients: ["player"],
  component: PlayerPartyBoard,
});
