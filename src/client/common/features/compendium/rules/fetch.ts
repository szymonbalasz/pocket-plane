// Rules window reads (FR-CMP-65, -66, -73): the page index, one page's cards, the merged search
// and single cards (search results, Pinned, a card on no page) by entry id. On demand only (open,
// page change, search, the DM's own writes); the browser revalidates with the ETag. Pages already
// loaded stay readable when a later fetch fails (offline: CMP §11): the last good answer is kept
// per page for this page load.
import type { EntrySummary } from "@shared/compendium/rest";
import {
  CONDITIONS_SECTION,
  type RuleCardBody,
  RulesIndexResponse,
  RulesPageResponse,
} from "@shared/compendium/rules";
import { fold } from "@shared/search/match";
import { useEffect, useState } from "react";
import { type Api, ApiError, call } from "../../../api";
import { fetchEntry } from "../fetch";
import { eagerApi, searchCompendium } from "../search";
import { mergeRuleResults, RULES_DEBOUNCE_MS, rulesError } from "./logic";

export type RulesRead<T> =
  | { state: "loading" }
  | { state: "offline" | "error"; retry(): void }
  | { state: "ready"; data: T };

export async function fetchRulesIndex(api: Api): Promise<RulesIndexResponse> {
  return RulesIndexResponse.parse(await call<unknown>(api.api.compendium.rules.$get()));
}

export async function fetchRulesPage(api: Api, pageId: string): Promise<RulesPageResponse> {
  const body = await call<unknown>(api.api.compendium.rules[":pageId"].$get({ param: { pageId } }));
  return RulesPageResponse.parse(body);
}

/** A card from its entry (search results, Pinned, a card on no page). */
export async function fetchRuleCard(api: Api, id: string): Promise<RuleCardBody> {
  const { entry } = await fetchEntry(api, id);
  const f = (entry.facets ?? {}) as { section?: unknown };
  const b = (entry.body ?? {}) as { text?: unknown };
  return {
    id: entry.id,
    name: entry.name,
    section:
      entry.kind === "condition"
        ? CONDITIONS_SECTION
        : typeof f.section === "string"
          ? f.section
          : "",
    text: typeof b.text === "string" ? b.text : "",
    house: entry.source === null,
    shared: entry.source !== null || entry.shared,
  };
}

const kept = new Map<string, unknown>();

/** One read keyed by `key`, refetched on `nonce`; a failure keeps the last good answer. */
function useKeptRead<T>(api: Api, key: string | null, nonce: number, load: () => Promise<T>) {
  const [read, setRead] = useState<RulesRead<T>>({ state: "loading" });
  const [retries, setRetries] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `nonce` / `retries` trigger refetches; `load` follows `key`
  useEffect(() => {
    if (key === null) return;
    let live = true;
    const held = kept.get(key) as T | undefined;
    setRead(held === undefined ? { state: "loading" } : { state: "ready", data: held });
    load().then(
      (data) => {
        kept.set(key, data);
        if (live) setRead({ state: "ready", data });
      },
      (err: unknown) => {
        if (!live || kept.has(key)) return;
        setRead({ state: rulesError(err), retry: () => setRetries((n) => n + 1) });
      },
    );
    return () => {
      live = false;
    };
  }, [api, key, nonce, retries]);
  return read;
}

export const useRulesIndex = (api: Api, nonce: number) =>
  useKeptRead(api, "index", nonce, () => fetchRulesIndex(api));

export const useRulesPage = (api: Api, pageId: string | null, nonce: number) =>
  useKeptRead(api, pageId === null ? null : `page:${pageId}`, nonce, () =>
    fetchRulesPage(api, pageId ?? ""),
  );

/**
 * Cards by id (Pinned, a card on no page), in `ids` order; ids answering 404 are reported to
 * `onGone` (stale pins leave the list) and left out.
 */
export function useRuleCards(
  api: Api,
  ids: readonly string[],
  nonce: number,
  onGone?: (ids: string[]) => void,
) {
  const key = ids.length === 0 ? "cards:" : `cards:${ids.join(",")}`;
  return useKeptRead(api, key, nonce, async () => {
    const gone: string[] = [];
    const cards = await Promise.all(
      ids.map((id) =>
        fetchRuleCard(api, id).catch((err: unknown) => {
          if (err instanceof ApiError && err.status === 404) {
            gone.push(id);
            return null;
          }
          throw err;
        }),
      ),
    );
    if (gone.length > 0) onGone?.(gone);
    return cards.filter((c): c is RuleCardBody => c !== null);
  });
}

/** FR-CMP-66 search: `kind=rule` and `kind=condition`, debounced, merged; empty `q` → none. */
export function useRuleSearch(api: Api, q: string) {
  const text = q.trim();
  const [read, setRead] = useState<RulesRead<EntrySummary[]> | null>(null);
  const [retries, setRetries] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `retries` triggers a refetch
  useEffect(() => {
    if (text === "") {
      setRead(null);
      return;
    }
    let live = true;
    setRead({ state: "loading" });
    const source = eagerApi(api);
    const t = setTimeout(() => {
      Promise.all([
        searchCompendium(source, { q: text, kind: "rule" }),
        searchCompendium(source, { q: text, kind: "condition" }),
      ]).then(
        ([rules, conditions]) =>
          live &&
          setRead({
            state: "ready",
            data: mergeRuleResults(text, rules.results, conditions.results),
          }),
        (err: unknown) =>
          live && setRead({ state: rulesError(err), retry: () => setRetries((n) => n + 1) }),
      );
    }, RULES_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [api, text, retries]);
  return read;
}

/**
 * BL-102: the entry an Open5e `srd:<slug>` reference names: a condition, else a rule card, whose
 * name folds to the slug's words (the viewer's visibility, FR-CMP-14); null = none.
 */
export async function resolveRuleRef(api: Api, slug: string): Promise<string | null> {
  const words = slug.replaceAll("-", " ");
  const source = eagerApi(api);
  for (const kind of ["condition", "rule"] as const) {
    const page = await searchCompendium(source, { q: words, kind });
    const hit = page.results.find((r) => fold(r.name) === fold(words));
    if (hit) return hit.id;
  }
  return null;
}
