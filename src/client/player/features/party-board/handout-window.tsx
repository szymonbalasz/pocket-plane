// Player `party.handout` viewer (FR-PARTY-13, -14): read only; showing a handout marks it seen at
// its `rev` (only while the window is shown, not minimised).

import { markSeen, useSeenRevs } from "@ui/features/party-board/player-seen";
import { handoutSelection } from "@ui/features/party-board/selection";
import { HandoutArticle, HandoutBody, type LoadedHandout } from "@ui/features/party-board/Viewer";
import { partyHandoutWindowBase } from "@ui/features/party-board/window";
import { defineWindow } from "@ui/features/play-shell/registry";
import { useWindowShown } from "@ui/features/play-shell/ShellWindow";
import { useEffect } from "react";
import { useStore } from "zustand";

function Seen({ loaded }: { loaded: LoadedHandout }) {
  const shown = useWindowShown();
  useSeenRevs(); // binds this viewer's seen map
  const { id, rev } = loaded.header;
  useEffect(() => {
    if (shown) markSeen(id, rev);
  }, [shown, id, rev]);
  return <HandoutArticle loaded={loaded} />;
}

function PlayerHandout() {
  const handoutId = useStore(handoutSelection, (s) => s.handoutId);
  return <HandoutBody handoutId={handoutId} render={(loaded) => <Seen loaded={loaded} />} />;
}

export const playerHandoutWindow = defineWindow({
  ...partyHandoutWindowBase,
  clients: ["player"],
  component: PlayerHandout,
});
