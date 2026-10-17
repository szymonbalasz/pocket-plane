// Compendium window logic (FR-CMP-18–22), pure: tabs per role, Filters fields, search params,
// labels, stat block numbers, the notation category of monster text, Stat block routing.
import { FILTER_KEYS, type FilterKey } from "@shared/compendium/rest";
import {
  type CompendiumKind,
  ITEM_CATEGORIES,
  SPELL_SCHOOLS,
  SRD_CLASSES,
} from "@shared/compendium/schemas";
import { abilityMod, CR_VALUES, xpForCr } from "@shared/entities/schemas";
import type { SearchParams } from "./search";

export const CMP_KIND = "cmp.compendium";
/** FR-CMP-18: the window's search waits this long after the last keystroke. */
export const WINDOW_DEBOUNCE_MS = 200;

export type CmpTab = "all" | CompendiumKind;
export type Role = "dm" | "player";

const TABS: readonly CmpTab[] = ["all", "monster", "spell", "item", "condition", "feature"];
/** FR-CMP-18: DM All, Monsters, Spells, Items, Conditions, Features; players no Monsters. */
export const tabsFor = (role: Role): CmpTab[] =>
  TABS.filter((t) => role === "dm" || t !== "monster");

export const TAB_LABEL: Record<CmpTab, string> = {
  all: "All",
  monster: "Monsters",
  spell: "Spells",
  item: "Items",
  condition: "Conditions",
  feature: "Features",
};

export interface FilterField {
  key: FilterKey;
  label: string;
  /** Select options (value = label unless given); absent → a text input. */
  options?: readonly { value: string; label: string }[];
}

const opts = (values: readonly string[], label: (v: string) => string = (v) => v) =>
  values.map((value) => ({ value, label: label(value) }));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const RARITIES = ["common", "uncommon", "rare", "very rare", "legendary", "artifact"];
const LEVELS = Array.from({ length: 10 }, (_, i) => String(i));

/** FR-CMP-11 filters per kind, as the Filters popover shows them. */
export const FILTER_FIELDS: Record<CompendiumKind, readonly FilterField[]> = {
  monster: [
    { key: "crMin", label: "CR from", options: opts(CR_VALUES) },
    { key: "crMax", label: "CR to", options: opts(CR_VALUES) },
    { key: "type", label: "Type" },
  ],
  spell: [
    { key: "level", label: "Level", options: opts(LEVELS, (v) => (v === "0" ? "Cantrip" : v)) },
    { key: "school", label: "School", options: opts(SPELL_SCHOOLS, cap) },
    { key: "className", label: "Class", options: opts(SRD_CLASSES) },
  ],
  item: [
    { key: "category", label: "Category", options: opts(ITEM_CATEGORIES, cap) },
    { key: "rarity", label: "Rarity", options: opts(RARITIES, cap) },
  ],
  condition: [],
  feature: [
    { key: "className", label: "Class", options: opts(SRD_CLASSES) },
    { key: "subclass", label: "Subclass" },
  ],
};

export type Filters = Partial<Record<FilterKey, string>>;

/** Query of the window: trimmed `q`; kind and its own non-empty filters only (FR-CMP-11). */
export function searchParams(q: string, tab: CmpTab, filters: Filters): SearchParams {
  const out: SearchParams = {};
  const text = q.trim();
  if (text !== "") out.q = text;
  if (tab === "all") return out;
  out.kind = tab;
  const allowed: readonly FilterKey[] = FILTER_KEYS[tab];
  for (const k of allowed) {
    const v = filters[k]?.trim();
    if (v) out[k] = v;
  }
  return out;
}

/**
 * FR-CMP-35: a group's members, with the list's own `q` so the expanded rows are exactly the
 * `group.count` that matched (`sameAs` takes `q` only: never kind or filters).
 */
export function groupParams(id: string, q: string): SearchParams {
  const text = q.trim();
  return text === "" ? { sameAs: id } : { sameAs: id, q: text };
}

/**
 * Copy of an empty result list (CMP §7): a search with no match says every word must match
 * (FR-CMP-33); nothing at all without a query or filters: nothing imported / set up yet.
 */
export function emptyText(q: string, unfiltered: boolean, role: Role): string {
  if (unfiltered) {
    return role === "dm" ? "Nothing imported yet" : "The DM hasn't set up the compendium yet";
  }
  const text = q.trim();
  return text === "" ? "No matches" : `No matches for ‘${text}’. Every word must match.`;
}

/** Active filters of a tab (badge count on the Filters button). */
export const activeFilterCount = (tab: CmpTab, filters: Filters) =>
  tab === "all" ? 0 : Object.keys(searchParams("", tab, filters)).length - 1;

/** Result Badge (CMP §7): `SRD` for SRD sources, else the label (`Homebrew`, `Fixture`, …). */
export const badgeLabel = (sourceLabel: string) => {
  const name = sourceName(sourceLabel);
  return /^SRD\b/.test(name) ? "SRD" : name;
};

/** Display names of source keys without a `compendium_source` row (entryless definitions). */
const SOURCE_NAMES: Readonly<Record<string, string>> = { "srd-5.1": "SRD 5.1", fixture: "Fixture" };

/** A source key or label as people read it: `fixture` → `Fixture`, `srd-5.1` → `SRD 5.1`. */
export function sourceName(source: string): string {
  return SOURCE_NAMES[source] ?? source;
}

/**
 * FR-CMP-19 footer: imported "SRD 5.1 · CC BY 4.0"; homebrew "Homebrew" (+ "Shared" / "DM only"
 * for the DM).
 */
export function footerLabel(
  source: { name: string; licence: string } | null,
  shared: boolean,
  role: Role,
): string {
  if (source) return `${source.name} · ${source.licence}`;
  if (role !== "dm") return "Homebrew";
  return `Homebrew · ${shared ? "Shared" : "DM only"}`;
}

/** `+2` / `−1` (U+2212, as stat blocks print it). */
export const signed = (n: number) => (n < 0 ? `−${-n}` : `+${n}`);

/** One ability box: "14 (+2)". */
export const scoreText = (score: number) => `${score} (${signed(abilityMod(score))})`;

/** "1/4 (50 XP)" (FR-ENT-03). */
export function crText(cr: string): string {
  let xp: number | null = null;
  try {
    xp = xpForCr(cr);
  } catch {
    xp = null;
  }
  return xp === null ? cr : `${cr} (${xp.toLocaleString("en-US")} XP)`;
}

/** FR-CMP-26: a monster's notation is an attack roll when it has a `1d20`, else damage. */
export const diceCategory = (expression: string): "attack" | "damage" =>
  /(^|[^0-9])1d20(?![0-9])/i.test(expression) ? "attack" : "damage";

/** FR-CMP-22: a campaign (custom) definition → its NPC sheet; any other (imported) → the entry. */
export function statBlockRoute(
  definitionId: string,
  campaignDefinitionIds: ReadonlySet<string>,
): "sheet" | "compendium" {
  return campaignDefinitionIds.has(definitionId) ? "sheet" : "compendium";
}

/**
 * The entry of an imported definition among monster search results: an entry linking it, else
 * `null` (an entryless imported definition, listed with `id = definitionId`: stat block only).
 */
export function entryForDefinition(
  definitionId: string,
  results: readonly { id: string; definitionId?: string }[],
): string | null {
  const hit = results.find((r) => r.definitionId === definitionId && r.id !== definitionId);
  return hit ? hit.id : null;
}

/** An entryless imported definition's search row (`id = definitionId`, GET would 404). */
export const isEntryless = (r: { id: string; definitionId?: string }) => r.definitionId === r.id;
