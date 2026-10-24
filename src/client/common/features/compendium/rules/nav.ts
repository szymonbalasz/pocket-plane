// Rules window navigation (FR-CMP-66, -69; CMP §7): the shown page, the search text, which cards
// are open per page (client memory for the session), the card an `openRules` asked for and a
// refetch nonce (window open, the DM's own house-rule writes). One window per client, so one
// store per client bundle. Never sent or stored.
import { useSyncExternalStore } from "react";
import { createStore } from "zustand";
import { DEFAULT_PAGE } from "./logic";

export interface RulesNav {
  page: string;
  q: string;
  /** Page id (or `search` / `card`) → the ids of its open cards. */
  open: Record<string, readonly string[]>;
  /** FR-CMP-69: a card to show; the window resolves its page, opens and scrolls to it. */
  target: string | null;
  /** FR-CMP-69: a card on no page, shown alone in the search view. */
  single: string | null;
  /** A placed target to scroll into view once its card renders (then cleared). */
  scrollTo: string | null;
  nonce: number;
}

const initial = (): RulesNav => ({
  page: DEFAULT_PAGE,
  q: "",
  open: {},
  target: null,
  single: null,
  scrollTo: null,
  nonce: 0,
});

export const rulesNav = createStore<RulesNav>(initial);

/** The current state on the server pass too (static-markup tests; the app renders client-side). */
export function useRulesNav<T>(select: (s: RulesNav) => T): T {
  const get = () => select(rulesNav.getState());
  return useSyncExternalStore(rulesNav.subscribe, get, get);
}

export const setRulesPage = (page: string) => rulesNav.setState({ page, single: null });
export const setRulesQuery = (q: string) => rulesNav.setState({ q, single: null });

/** Open / close one card on `where` (a page id, `search` or `card`). */
export function setCardOpen(where: string, id: string, open: boolean) {
  rulesNav.setState((s) => {
    const was = s.open[where] ?? [];
    const next = open ? (was.includes(id) ? was : [...was, id]) : was.filter((x) => x !== id);
    return { open: { ...s.open, [where]: next } };
  });
}

/** FR-CMP-69: ask the window to show `entryId` (resolved once the page index is known). */
export const targetCard = (entryId: string) =>
  rulesNav.setState((s) => ({ target: entryId, q: "", nonce: s.nonce + 1 }));

/** The window placed the target: on `page` (open it there) or alone (`page` null). */
export function placeTarget(entryId: string, page: string | null) {
  rulesNav.setState((s) =>
    page === null
      ? { target: null, single: entryId, scrollTo: null, open: { ...s.open, card: [entryId] } }
      : {
          target: null,
          single: null,
          scrollTo: entryId,
          page,
          open: {
            ...s.open,
            [page]: (s.open[page] ?? []).includes(entryId)
              ? (s.open[page] ?? [])
              : [...(s.open[page] ?? []), entryId],
          },
        },
  );
}

export const clearSingle = () => rulesNav.setState({ single: null });
export const scrolled = () => rulesNav.setState({ scrollTo: null });
export const refetchRules = () => rulesNav.setState((s) => ({ nonce: s.nonce + 1 }));
export const resetRulesNav = () => rulesNav.setState(initial());

/** Gap kept above a landed card's heading (px). */
export const LAND_GAP = 4;

/**
 * FR-CMP-66 / -69 (BL-98): the scroll offset that puts a card's heading at the top of its
 * scroller (`LAND_GAP` above it), clamped to the scrollable range. Tops are viewport y's.
 */
export function landScrollTop(
  scroller: { top: number; scrollTop: number; scrollHeight: number; clientHeight: number },
  cardTop: number,
): number {
  const want = scroller.scrollTop + cardTop - scroller.top - LAND_GAP;
  return Math.max(0, Math.min(want, scroller.scrollHeight - scroller.clientHeight));
}
