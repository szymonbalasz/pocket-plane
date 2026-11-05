// FR-NOTES-22 client side: `GET /api/notes/search?q=` over this page's REST client (DM: secret,
// player: `Authorization: Player <link token>`), and a debounced hook for the Notes window's
// search box. Results are read on demand, never pushed.
import { NoteSearchResponse } from "@shared/linked-notes/search";
import { queryWords } from "@shared/search/match";
import { useEffect, useState } from "react";
import { type Api, call } from "../../api";

/** As compendium lookups (FR-CMP-17): one request this long after the last keystroke. */
export const NOTE_SEARCH_DEBOUNCE_MS = 150;

export async function searchNotes(api: Api, q: string): Promise<NoteSearchResponse> {
  const body = await call<unknown>(api.api.notes.search.$get({ query: { q } }));
  return NoteSearchResponse.parse(body);
}

/** A query the box searches for: some word survives folding (else the list shows, no request). */
export const isSearch = (q: string): boolean => queryWords(q).length > 0;

/** While a query is shown, it is searched again this often (others' typing reaches no event here). */
export const NOTE_SEARCH_REFRESH_MS = 3_000;

export interface NoteSearch {
  /**
   * The latest settled results while the box holds a query: kept while the next request runs
   * (no blank while typing) and after an error; null before the first answer or with no query.
   */
  page: NoteSearchResponse | null;
  state: "idle" | "loading" | "ready" | "error";
}

const visible = (): boolean =>
  typeof document === "undefined" || document.visibilityState !== "hidden";

/**
 * Debounced search: one request `debounceMs` after `q` or `refresh` (the note list: a title, a
 * new note, the bin) last changed, and again every `refreshMs` while the page is visible, so
 * results on screen follow others' typing. A stale answer is dropped. No query (`isSearch`) →
 * `idle`, no request, results cleared. `retry` re-sends the current query.
 */
export function useNoteSearch(
  api: Api,
  q: string,
  refresh: unknown,
  { debounceMs = NOTE_SEARCH_DEBOUNCE_MS, refreshMs = NOTE_SEARCH_REFRESH_MS } = {},
): NoteSearch & { retry(): void } {
  const [out, setOut] = useState<NoteSearch>({ page: null, state: "idle" });
  const [tick, setTick] = useState(0);
  const query = q.trim();
  const active = isSearch(query);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      if (visible()) setTick((n) => n + 1);
    }, refreshMs);
    return () => clearInterval(t);
  }, [active, refreshMs]);
  useEffect(() => {
    void refresh;
    void tick;
    if (!active) {
      setOut({ page: null, state: "idle" });
      return;
    }
    let live = true;
    setOut((o) => ({ page: o.page, state: "loading" }));
    const t = setTimeout(() => {
      searchNotes(api, query).then(
        (page) => live && setOut({ page, state: "ready" }),
        () => live && setOut((o) => ({ page: o.page, state: "error" })),
      );
    }, debounceMs);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [api, query, active, refresh, tick, debounceMs]);
  return { ...out, retry: () => setTick((n) => n + 1) };
}
