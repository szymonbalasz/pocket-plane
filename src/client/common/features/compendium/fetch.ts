// Compendium window reads (FR-CMP-18, -23): result pages with **More**, one entry, an imported
// definition's entry, a duplicate group's members (FR-CMP-35). On demand only (open, search, Back, the DM's own writes), never pushed.
// Search goes through C2's `searchCompendium`; DM and player differ only in the `Api` credential.
import { EntryResponse, type EntrySummary } from "@shared/compendium/rest";
import { useEffect, useRef, useState } from "react";
import { type Api, ApiError, call } from "../../api";
import { entryForDefinition, groupParams } from "./logic";
import { type ApiSource, eagerApi, type SearchParams, searchCompendium } from "./search";

const source = (api: Api): ApiSource => eagerApi(api);

export async function fetchEntry(api: Api, id: string): Promise<EntryResponse> {
  const body = await call<unknown>(api.api.compendium.entries[":id"].$get({ param: { id } }));
  return EntryResponse.parse(body);
}

export type LoadState = "loading" | "ready" | "error";

/** Error copy of a failed read: a gone entry (404) reads as such (CMP §11). */
export function readError(err: unknown): string {
  if (err instanceof ApiError && err.status === 404) return "No longer available";
  if (err instanceof ApiError) return err.message;
  return "Couldn't load the compendium";
}

export interface Results {
  results: EntrySummary[];
  hasMore: boolean;
  state: LoadState;
  error: string | null;
  /** The query the shown results answer (group members are fetched with its `q`, FR-CMP-35). */
  params: SearchParams;
  /** Next page (**More**); no-op while loading or on the last page. */
  more(): void;
}

/**
 * Debounced result pages: the first page `debounceMs` after `params` change, and again when
 * `nonce` bumps (open, Back, own writes; at once). A refetch reloads as many results as were
 * shown (pages chained by cursor) so Back keeps the list. Stale answers are dropped.
 */
export function useResults(
  api: Api,
  params: SearchParams,
  nonce: number,
  debounceMs: number,
): Results {
  const key = JSON.stringify(params);
  const [results, setResults] = useState<EntrySummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [shownParams, setShownParams] = useState<SearchParams>({});
  const shown = useRef({ key: "", count: 0 });
  const gen = useRef(0);
  const lastKey = useRef<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `nonce` is the refetch trigger
  useEffect(() => {
    const my = ++gen.current;
    const sameQuery = lastKey.current === key;
    lastKey.current = key;
    const want = sameQuery ? Math.max(shown.current.count, 1) : 1;
    setState("loading");
    const run = async () => {
      const q = JSON.parse(key) as SearchParams;
      let all: EntrySummary[] = [];
      let next: string | null = null;
      do {
        const page = await searchCompendium(source(api), next ? { ...q, cursor: next } : q);
        all = all.concat(page.results);
        next = page.nextCursor;
      } while (next && all.length < want);
      return { all, next };
    };
    const t = setTimeout(
      () => {
        run().then(
          ({ all, next }) => {
            if (gen.current !== my) return;
            shown.current = { key, count: all.length };
            setResults(all);
            setShownParams(JSON.parse(key) as SearchParams);
            setCursor(next);
            setError(null);
            setState("ready");
          },
          (err: unknown) => {
            if (gen.current !== my) return;
            setError(readError(err));
            setState("error");
          },
        );
      },
      sameQuery ? 0 : debounceMs,
    );
    return () => clearTimeout(t);
  }, [api, key, nonce, debounceMs]);

  const more = () => {
    if (state === "loading" || !cursor) return;
    const my = ++gen.current;
    setState("loading");
    const q = JSON.parse(key) as SearchParams;
    searchCompendium(source(api), { ...q, cursor }).then(
      (page) => {
        if (gen.current !== my) return;
        setResults((r) => {
          const all = r.concat(page.results);
          shown.current = { key, count: all.length };
          return all;
        });
        setCursor(page.nextCursor);
        setState("ready");
      },
      (err: unknown) => {
        if (gen.current !== my) return;
        setError(readError(err));
        setState("error");
      },
    );
  };

  return { results, hasMore: cursor !== null, state, error, params: shownParams, more };
}

export type MembersRead =
  | { state: "loading" }
  | { state: "error"; error: string }
  | { state: "ready"; members: EntrySummary[] };

/** FR-CMP-35: the members of the group whose best member is `id`, matching the list's `q`. */
export async function fetchGroupMembers(api: Api, id: string, q: string): Promise<EntrySummary[]> {
  const page = await searchCompendium(source(api), groupParams(id, q));
  return page.results;
}

/**
 * An expanded group's members, fetched when it opens and again on `nonce` (Back, own writes);
 * the last members stay shown while a refetch runs.
 */
export function useGroupMembers(api: Api, id: string, q: string, nonce: number): MembersRead {
  const [read, setRead] = useState<MembersRead>({ state: "loading" });
  // biome-ignore lint/correctness/useExhaustiveDependencies: `nonce` is the refetch trigger
  useEffect(() => {
    let live = true;
    setRead((r) => (r.state === "ready" ? r : { state: "loading" }));
    fetchGroupMembers(api, id, q).then(
      (members) => live && setRead({ state: "ready", members }),
      (err: unknown) => live && setRead({ state: "error", error: readError(err) }),
    );
    return () => {
      live = false;
    };
  }, [api, id, q, nonce]);
  return read;
}

export type EntryRead =
  | { state: "loading" }
  | { state: "error"; error: string }
  | { state: "ready"; data: EntryResponse };

/** One entry, fetched when `id` or `nonce` changes (open, Back to it, own writes). */
export function useEntry(api: Api, id: string | null, nonce: number): EntryRead {
  const [read, setRead] = useState<EntryRead>({ state: "loading" });
  // biome-ignore lint/correctness/useExhaustiveDependencies: `nonce` is the refetch trigger
  useEffect(() => {
    if (id === null) return;
    let live = true;
    setRead((r) => (r.state === "ready" && r.data.entry.id === id ? r : { state: "loading" }));
    fetchEntry(api, id).then(
      (data) => live && setRead({ state: "ready", data }),
      (err: unknown) => live && setRead({ state: "error", error: readError(err) }),
    );
    return () => {
      live = false;
    };
  }, [api, id, nonce]);
  return read;
}

export type DefinitionEntry =
  | { state: "loading" }
  | { state: "error"; error: string }
  /** `entryId` null: an imported definition without an entry (stat block only). */
  | { state: "ready"; entryId: string | null };

/**
 * FR-CMP-22: the entry of an imported definition, found by a DM monster search on its name (the
 * search lists the definition's entry, or the definition itself when it has none).
 */
export function useDefinitionEntry(
  api: Api,
  definitionId: string | null,
  name: string | null,
): DefinitionEntry {
  const [out, setOut] = useState<DefinitionEntry>({ state: "loading" });
  useEffect(() => {
    if (definitionId === null || name === null) {
      setOut({ state: "loading" });
      return;
    }
    let live = true;
    searchCompendium(source(api), { q: name, kind: "monster" }).then(
      (page) =>
        live && setOut({ state: "ready", entryId: entryForDefinition(definitionId, page.results) }),
      (err: unknown) => live && setOut({ state: "error", error: readError(err) }),
    );
    return () => {
      live = false;
    };
  }, [api, definitionId, name]);
  return out;
}
