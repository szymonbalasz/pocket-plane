// The Recap window's view state per viewer (campaign + DM / player): the picked session (null =
// the newest). Page memory only, never sent or stored (RECAP §8: view state). `openRecap` writes it
// as a pick would, then opens, restores or fronts `recap.session` (instance `main`): `by: "feature"`
// for a share and history Open (FR-RECAP-21: placed only if untouched, seams S4 / S14), `by:
// "user"` for the palette and Stats' Recap button.
import type { You } from "@shared/protocol/frames";
import { RECAP_WINDOW_KIND } from "@shared/session-recap/schemas";
import { useCallback, useSyncExternalStore } from "react";
import { createStore } from "zustand";
import { useSync } from "../../sync/store";
import type { OpenBy } from "../play-shell/manager";
import { useOpenWindow } from "../play-shell/ShellContext";
import { viewKey } from "../stats/view";

export interface RecapView {
  /** Null = the newest session. */
  fromN: number | null;
}

export function createRecapViews() {
  const state = createStore<{ views: Readonly<Record<string, RecapView>> }>(() => ({ views: {} }));
  return {
    state,
    get: (key: string | null): RecapView =>
      (key ? state.getState().views[key] : undefined) ?? { fromN: null },
    set(key: string | null, view: RecapView) {
      if (!key) return;
      state.setState({ views: { ...state.getState().views, [key]: view } });
    },
  };
}

export type RecapViews = ReturnType<typeof createRecapViews>;

let page: RecapViews | null = null;
/** The page's view state, made on first use. */
export const recapViews = () => {
  page ??= createRecapViews();
  return page;
};

export type OpenWindowFn = (kind: string, instance?: string, opts?: { by?: OpenBy }) => void;

export function openRecap(
  fromN: number | null,
  deps: { you: You | null; open: OpenWindowFn; by: OpenBy; views?: RecapViews },
) {
  (deps.views ?? recapViews()).set(deps.you ? viewKey(deps.you) : null, { fromN });
  deps.open(RECAP_WINDOW_KIND, "main", { by: deps.by });
}

/** `openRecap` bound to this client's viewer and window manager. */
export function useOpenRecap(): (fromN: number | null, by: OpenBy) => void {
  const you = useSync((s) => s.store.you);
  const open = useOpenWindow();
  return useCallback(
    (fromN: number | null, by: OpenBy) => openRecap(fromN, { you, open, by }),
    [you, open],
  );
}

export type RecapOpener = (fromN: number | null, by: OpenBy) => void;

/**
 * FR-STATS-79: the page's Recap opener, set by the Recap runtime (`recap.session`'s companion,
 * mounted only while the kind is registered and available on this client) and read by Stats'
 * Session tab, which shows its Recap button only while one is set.
 */
export const recapOpener = createStore<{ open: RecapOpener | null }>(() => ({ open: null }));

export function useRecapOpener(): RecapOpener | null {
  const read = () => recapOpener.getState().open;
  return useSyncExternalStore(recapOpener.subscribe, read, read);
}
