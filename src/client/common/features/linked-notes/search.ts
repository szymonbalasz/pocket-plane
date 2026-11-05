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

export interface NoteSearch {
  /** Results of the latest settled request for the current query, else null. */
  page: NoteSearchResponse | null;
  state: "idle" | "loading" | "ready" | "error";
}

/**
 * Debounced search: one request `debounceMs` after `q` (or `refresh`: the note list changed)
 * last changed; a stale answer is dropped. Not a search (`isSearch`) → `idle`, no request.
 * `retry` re-sends the current query.
 */
export function useNoteSearch(
  api: Api,
  q: string,
  refresh: unknown,
  debounceMs = NOTE_SEARCH_DEBOUNCE_MS,
): NoteSearch & { retry(): void } {
  const [out, setOut] = useState<NoteSearch>({ page: null, state: "idle" });
  const [attempt, setAttempt] = useState(0);
  const query = q.trim();
  const active = isSearch(query);
  useEffect(() => {
    void refresh;
    void attempt;
    if (!active) {
      setOut({ page: null, state: "idle" });
      return;
    }
    let live = true;
    setOut((o) => ({ page: o.page, state: "loading" }));
    const t = setTimeout(() => {
      searchNotes(api, query).then(
        (page) => live && setOut({ page, state: "ready" }),
        () => live && setOut({ page: null, state: "error" }),
      );
    }, debounceMs);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [api, query, active, refresh, attempt, debounceMs]);
  return { ...out, retry: () => setAttempt((n) => n + 1) };
}
