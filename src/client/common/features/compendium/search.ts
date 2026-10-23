// FR-CMP-10 client side: `GET /api/compendium/search` over the Hono RPC client (DM: secret,
// player: `Authorization: Player`, set by the client's `Api`), and a debounced hook for lookups
// and the Creatures window (FR-CMP-17: 150 ms). Results are read on demand, never pushed (FR-CMP-23).
import { type SearchQuery, SearchResponse } from "@shared/compendium/rest";
import { useEffect, useState } from "react";
import { type Api, call } from "../../api";
import { loadChunk } from "../../lib/lazy-chunk";

/** FR-CMP-17: lookups and the Creatures window wait this long after the last keystroke. */
export const LOOKUP_DEBOUNCE_MS = 150;

/**
 * The client's REST client, or a loader of it (the DM session module reads localStorage at
 * import, so DM code imports it lazily to keep registries testable). Tagged, never told apart by
 * `typeof`: a Hono client is a callable proxy (`typeof` is "function"). Build one with `eagerApi`
 * / `lazyApi` once per module (hooks depend on its identity).
 */
export type ApiSource =
  | { readonly kind: "api"; readonly api: Api }
  | { readonly kind: "lazy"; readonly load: () => Promise<Api> };

export const eagerApi = (api: Api): ApiSource => ({ kind: "api", api });
/** Loads through `loadChunk` (FR-SHELL-176): a stale chunk → the caller's error + the stale notice. */
export const lazyApi = (load: () => Promise<Api>): ApiSource => ({
  kind: "lazy",
  load: () => loadChunk(load, { notice: true }),
});

export async function resolveApi(source: ApiSource): Promise<Api> {
  return source.kind === "api" ? source.api : source.load();
}

/** Query values as the URL carries them (strings); undefined keys are left out. */
export type SearchParams = { [K in keyof SearchQuery]?: string };

export async function searchCompendium(
  source: ApiSource,
  params: SearchParams,
): Promise<SearchResponse> {
  const api = await resolveApi(source);
  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) if (v !== undefined) query[k] = v;
  const body = await call<unknown>(api.api.compendium.search.$get({ query }));
  return SearchResponse.parse(body);
}

export interface CompendiumSearch {
  /** Results of the latest settled request (kept while the next one runs). */
  page: SearchResponse | null;
  state: "idle" | "loading" | "ready" | "error";
}

export interface SearchOptions {
  /** Off → no request, `idle` (e.g. an empty lookup input, or a player client). */
  enabled?: boolean;
  debounceMs?: number;
}

/**
 * Debounced search: one request `debounceMs` after `params` last changed; a stale answer (params
 * changed meanwhile) is dropped. Errors leave the last page and report `error`.
 */
export function useCompendiumSearch(
  api: ApiSource,
  params: SearchParams,
  { enabled = true, debounceMs = LOOKUP_DEBOUNCE_MS }: SearchOptions = {},
): CompendiumSearch {
  const key = JSON.stringify(params);
  const [out, setOut] = useState<CompendiumSearch>({ page: null, state: "idle" });
  useEffect(() => {
    if (!enabled) {
      setOut({ page: null, state: "idle" });
      return;
    }
    let live = true;
    setOut((o) => ({ page: o.page, state: "loading" }));
    const t = setTimeout(() => {
      searchCompendium(api, JSON.parse(key) as SearchParams).then(
        (page) => live && setOut({ page, state: "ready" }),
        () => live && setOut((o) => ({ page: o.page, state: "error" })),
      );
    }, debounceMs);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [api, key, enabled, debounceMs]);
  return out;
}
