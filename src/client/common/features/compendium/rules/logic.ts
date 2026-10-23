// Rules window logic (FR-CMP-63–73), pure: the kind, the page of a card, the narrow layout, the
// merged search (rule cards + conditions, both clients), the empty state and its copy.
import type { EntrySummary } from "@shared/compendium/rest";
import type { RulesIndexResponse } from "@shared/compendium/rules";
import { HOUSE_PAGE_ID, PINNED_PAGE_ID, RULE_PAGE_TABS } from "@shared/compendium/rules-pages";
import { foldName, nameTier, queryWords } from "@shared/search/match";
import { ApiError, NETWORK_STATUS } from "../../../api";

export const RULES_KIND = "cmp.rules";
/** FR-CMP-66: the search waits this long after the last keystroke (as FR-CMP-10's window). */
export const RULES_DEBOUNCE_MS = 200;
/** FR-CMP-66: page Tabs from this window width; a Select below it. */
export const RULES_TABS_MIN_W = 420;

export type RulesRole = "dm" | "player";

/** Every tab, in order: the curated pages, House rules, Pinned (FR-CMP-64). */
export const RULES_TABS = RULE_PAGE_TABS;
export const DEFAULT_PAGE = RULES_TABS[0]?.id ?? "combat";

/** FR-CMP-69: the first page (curated or House rules) listing `entryId`; null = on no page. */
export function pageOfCard(index: RulesIndexResponse | null, entryId: string): string | null {
  for (const p of index?.pages ?? []) if (p.cards.some((c) => c.id === entryId)) return p.id;
  return null;
}

/** FR-CMP-73: no imported card on any page → nothing imported (or imported before sections). */
export function rulesEmpty(index: RulesIndexResponse): boolean {
  return !index.pages.some((p) => p.id !== HOUSE_PAGE_ID && p.cards.length > 0);
}

export const EMPTY_COPY: Record<RulesRole, string> = {
  dm: "Import SRD 5.1 in the Compendium to fill the rules",
  player: "The DM hasn't set up the rules yet",
};

/** FR-CMP-73: offline (no connection) vs any other failure (Retry). */
export function rulesError(err: unknown): "offline" | "error" {
  return err instanceof ApiError && err.status === NETWORK_STATUS ? "offline" : "error";
}

/**
 * FR-CMP-66 search = compendium search over rule cards and conditions (the Conditions page is
 * the `condition` kind): one list, name matches (tiers 0–3, the shared matcher) before text
 * matches, then each server page's order, rules before conditions on a tie.
 */
export function mergeRuleResults(
  q: string,
  rules: readonly EntrySummary[],
  conditions: readonly EntrySummary[],
): EntrySummary[] {
  const words = queryWords(q);
  const tagged = [...rules, ...conditions].map((r, i) => ({
    r,
    i,
    tier: nameTier(foldName(r.name), words) ?? 9,
  }));
  tagged.sort((a, b) => a.tier - b.tier || a.i - b.i);
  return tagged.map((t) => t.r);
}

export const isPinnedPage = (pageId: string) => pageId === PINNED_PAGE_ID;
