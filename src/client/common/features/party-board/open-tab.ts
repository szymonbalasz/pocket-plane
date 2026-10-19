// FR-PARTY-30 `openPartyTab(tab)`: stores the tab as a click would, then opens, restores or
// focuses `party.board` as a feature open (`by: "feature"`, FR-SHELL-41). Callers: LOOT's
// `loot-received` "Open" and the sheet's wallet link (FR-LOOT-22, -23).
import type { You } from "@shared/protocol/frames";
import { useCallback } from "react";
import { useSync } from "../../sync/store";
import type { OpenBy } from "../play-shell/manager";
import { useOpenWindow } from "../play-shell/ShellContext";
import { PARTY_BOARD_KIND, type PartyTab } from "./logic";
import { partyMemory, type TabState, tabKey } from "./seen";

export type OpenWindowFn = (kind: string, instance?: string, opts?: { by?: OpenBy }) => void;

/** The tab key of a viewer (FR-PARTY-11), null before the first snapshot. */
export const tabKeyOf = (you: You | null) =>
  you ? tabKey(you.campaignId, you.role, you.playerId) : null;

export function openPartyTab(
  tab: PartyTab,
  deps: { you: You | null; open: OpenWindowFn; tabs?: TabState },
) {
  (deps.tabs ?? partyMemory().tabs).choose(tabKeyOf(deps.you), tab);
  deps.open(PARTY_BOARD_KIND, undefined, { by: "feature" });
}

/** `openPartyTab` bound to this client's viewer and window manager. */
export function useOpenPartyTab(): (tab: PartyTab) => void {
  const you = useSync((s) => s.store.you);
  const open = useOpenWindow();
  return useCallback((tab: PartyTab) => openPartyTab(tab, { you, open }), [you, open]);
}
