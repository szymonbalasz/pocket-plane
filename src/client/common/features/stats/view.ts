// The Stats window's view state per viewer (campaign + DM / player): tab, picked fight, picked
// session, Highlights open, Luck scope. Page memory only, never sent or stored (STATS §8: client
// view state); `openStatsAwards` (FR-SHELL-94) and `openStatsFight` (FR-STATS-34) write it as a
// click would, so an open window switches at once.
import { createStore } from "zustand";
import type { StatsTab } from "./logic";

export interface StatsView {
  tab: StatsTab;
  /** Null = the server's default fight (FR-STATS-15). */
  fightKey: string | null;
  /** Null = the newest session. */
  sessionFromN: number | null;
  /** FR-STATS-36: Highlights open; null = the default (open on an ended fight, closed on a started one). */
  highlightsOpen: boolean | null;
  /** FR-STATS-40: Luck scope; null = the newest session. */
  luckScope: number | "campaign" | null;
}

export const DEFAULT_VIEW: StatsView = {
  tab: "fight",
  fightKey: null,
  sessionFromN: null,
  highlightsOpen: null,
  luckScope: null,
};

export const viewKey = (you: { campaignId: string; role: string; playerId: string | null }) =>
  `${you.campaignId}.${you.role === "dm" ? "dm" : (you.playerId ?? "unknown")}`;

export function createViewState() {
  const state = createStore<{ views: Readonly<Record<string, StatsView>> }>(() => ({ views: {} }));
  return {
    state,
    get: (key: string | null): StatsView =>
      (key ? state.getState().views[key] : undefined) ?? DEFAULT_VIEW,
    set(key: string | null, patch: Partial<StatsView>) {
      if (!key) return;
      const { views } = state.getState();
      state.setState({ views: { ...views, [key]: { ...(views[key] ?? DEFAULT_VIEW), ...patch } } });
    },
  };
}

export type ViewState = ReturnType<typeof createViewState>;

let page: ViewState | null = null;
/** The page's view state, made on first use. */
export const statsViews = () => {
  page ??= createViewState();
  return page;
};
