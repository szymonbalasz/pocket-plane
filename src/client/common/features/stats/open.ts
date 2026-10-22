// FR-SHELL-94 `openStatsAwards(fromN)` (the `openPartyTab` pattern): stores the view
// `{tab: "session", fromN}` for the viewer's key, then opens, restores or fronts `stats.board` as a
// feature open. Callers: the live `stats-awards` frame (runtime) and the notification's Open.
// FR-STATS-34 `openStatsFight(encounterId)`: the same on the Fight tab, that fight, Highlights open
// (the live `stats-fight-summary` frame and its Open); the placer's ladder places it.
import type { You } from "@shared/protocol/frames";
import { useCallback } from "react";
import { useSync } from "../../sync/store";
import type { OpenBy } from "../play-shell/manager";
import { useOpenWindow } from "../play-shell/ShellContext";
import { STATS_WINDOW_KIND } from "./logic";
import { statsViews, type ViewState, viewKey } from "./view";

export type OpenWindowFn = (kind: string, instance?: string, opts?: { by?: OpenBy }) => void;

export function openStatsAwards(
  fromN: number,
  deps: { you: You | null; open: OpenWindowFn; views?: ViewState },
) {
  (deps.views ?? statsViews()).set(deps.you ? viewKey(deps.you) : null, {
    tab: "session",
    sessionFromN: fromN,
  });
  deps.open(STATS_WINDOW_KIND, "main", { by: "feature" });
}

/** `openStatsAwards` bound to this client's viewer and window manager. */
export function useOpenStatsAwards(): (fromN: number) => void {
  const you = useSync((s) => s.store.you);
  const open = useOpenWindow();
  return useCallback((fromN: number) => openStatsAwards(fromN, { you, open }), [you, open]);
}

export function openStatsFight(
  encounterId: string,
  deps: { you: You | null; open: OpenWindowFn; views?: ViewState },
) {
  (deps.views ?? statsViews()).set(deps.you ? viewKey(deps.you) : null, {
    tab: "fight",
    fightKey: encounterId,
    highlightsOpen: true,
  });
  deps.open(STATS_WINDOW_KIND, "main", { by: "feature" });
}

/** `openStatsFight` bound to this client's viewer and window manager. */
export function useOpenStatsFight(): (encounterId: string) => void {
  const you = useSync((s) => s.store.you);
  const open = useOpenWindow();
  return useCallback(
    (encounterId: string) => openStatsFight(encounterId, { you, open }),
    [you, open],
  );
}
