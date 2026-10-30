// compendium REST read shapes (CMP §9, FR-CMP-10–12): search query + filters, result summaries,
// the entry response. zod is the source of truth; query values arrive as strings.
import { Cr, MonsterStatBlock } from "@shared/entities/schemas";
import { z } from "zod";
import {
  CompendiumEntry,
  CompendiumKind,
  CompendiumSource,
  EntryName,
  ItemCategory,
  LINE_MAX,
  NAME_MAX,
  RULE_CHAPTER_MAX,
  RULE_SECTION_MAX,
  SpellSchool,
  SrdClass,
} from "./schemas";

/** FR-CMP-10: query text cap and page size. */
export const SEARCH_Q_MAX = 100;
export const SEARCH_PAGE = 50;
export const CURSOR_MAX = 512;
/** `sourceLabel` of a homebrew entry (FR-CMP-19). */
export const HOMEBREW_LABEL = "Homebrew";

/** FR-CMP-11: filter keys per kind; any other key (or a filter without `kind`) → `invalid`. */
export const FILTER_KEYS = {
  monster: ["crMin", "crMax", "type"],
  spell: ["level", "school", "className"],
  item: ["category", "rarity"],
  condition: [],
  feature: ["className", "subclass"],
  // Sprint 9 (FR-CMP-62, amends FR-CMP-11).
  rule: ["chapter", "section"],
} as const satisfies Record<CompendiumKind, readonly string[]>;
export const ALL_FILTER_KEYS = [
  "crMin",
  "crMax",
  "type",
  "level",
  "school",
  "className",
  "category",
  "rarity",
  "subclass",
  "chapter",
  "section",
] as const;
export type FilterKey = (typeof ALL_FILTER_KEYS)[number];

/**
 * `GET /api/compendium/search` query (FR-CMP-10 / -11 / -35). Strict: an unknown key → `invalid`.
 * `sameAs` lists one duplicate group's members and takes `q` only (anything else → `invalid`).
 */
export const SearchQuery = z
  .strictObject({
    q: z.string().max(SEARCH_Q_MAX).optional(),
    kind: CompendiumKind.optional(),
    cursor: z.string().min(1).max(CURSOR_MAX).optional(),
    sameAs: z.string().min(1).max(64).optional(),
    /** FR-CMPX-14: also lists this definition's entry when it is hidden (token → entry, FR-CMP-22). */
    definitionId: z.string().min(1).max(64).optional(),
    crMin: Cr.optional(),
    crMax: Cr.optional(),
    type: z.string().min(1).max(40).optional(),
    level: z
      .string()
      .regex(/^[0-9]$/, "Expected a spell level 0–9")
      .transform(Number)
      .optional(),
    school: SpellSchool.optional(),
    className: SrdClass.optional(),
    category: ItemCategory.optional(),
    rarity: z.string().min(1).max(100).optional(),
    subclass: z.string().min(1).max(NAME_MAX).optional(),
    chapter: z.string().min(1).max(RULE_CHAPTER_MAX).optional(),
    section: z.string().min(1).max(RULE_SECTION_MAX).optional(),
  })
  .superRefine((q, c) => {
    if (q.sameAs !== undefined) {
      for (const k of Object.keys(q)) {
        if (k === "sameAs" || k === "q" || q[k as keyof typeof q] === undefined) continue;
        c.addIssue({ code: "custom", path: [k], message: "sameAs takes only q" });
      }
      return;
    }
    if (q.definitionId !== undefined && q.kind !== "monster") {
      c.addIssue({ code: "custom", path: ["definitionId"], message: "Monsters only" });
    }
    const allowed: readonly string[] = q.kind === undefined ? [] : FILTER_KEYS[q.kind];
    for (const k of ALL_FILTER_KEYS) {
      if (q[k] === undefined || allowed.includes(k)) continue;
      c.addIssue({
        code: "custom",
        path: [k],
        message: q.kind === undefined ? "Filters need a kind" : `Not a ${q.kind} filter`,
      });
    }
  });
export type SearchQuery = z.infer<typeof SearchQuery>;

/** FR-CMP-35: a duplicate group row's member count (≥ 2; `sameAs` lists exactly that many). */
export const SummaryGroup = z.strictObject({ count: z.number().int().min(2) });

/**
 * One search result (FR-CMP-10). `definitionId`: monsters only (the imported definition).
 * `group`: a collapsed duplicate group (FR-CMP-35); `id` is its best member.
 */
export const EntrySummary = z.strictObject({
  id: z.string().min(1).max(64),
  kind: CompendiumKind,
  name: EntryName,
  /** Imported: the source's name (e.g. "SRD 5.1"); homebrew: "Homebrew". */
  sourceLabel: z.string().min(1).max(NAME_MAX),
  /** FR-CMPX-16: a book's abbreviation, the row's badge. */
  sourceAbbr: z.string().min(1).max(NAME_MAX).optional(),
  line: z.string().max(LINE_MAX),
  definitionId: z.string().min(1).max(64).optional(),
  group: SummaryGroup.optional(),
});
export type EntrySummary = z.infer<typeof EntrySummary>;

export const SearchResponse = z.strictObject({
  results: z.array(EntrySummary).max(SEARCH_PAGE),
  /** Opaque; absent on the last page. */
  nextCursor: z.string().max(CURSOR_MAX).nullable(),
});
export type SearchResponse = z.infer<typeof SearchResponse>;

/** Attribution of an imported entry's source (FR-CMP-04 / -12, CC BY 4.0). */
export const SourceAttribution = CompendiumSource.pick({
  key: true,
  name: true,
  licence: true,
  attribution: true,
  url: true,
  version: true,
}).extend({
  /** FR-CMPX-16: a book's abbreviation ("MM"); entry footer "‹Book› (‹abbr›)", FR-CMPX-18. */
  abbr: z.string().min(1).max(NAME_MAX).optional(),
});
export type SourceAttribution = z.infer<typeof SourceAttribution>;

/** `GET /api/compendium/credits`: every imported source the viewer reads an entry of (FR-CMPX-18). */
export const CreditsResponse = z.strictObject({ sources: z.array(SourceAttribution) });
export type CreditsResponse = z.infer<typeof CreditsResponse>;

/** A monster entry's playable stat block (its imported definition, FR-CMP-03 / -12). */
export const EntryDefinition = z.strictObject({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(NAME_MAX),
  statBlock: MonsterStatBlock,
});
export type EntryDefinition = z.infer<typeof EntryDefinition>;

/** `GET /api/compendium/entries/:id` (FR-CMP-12). `source` null = homebrew. */
export const EntryResponse = z.strictObject({
  entry: CompendiumEntry,
  source: SourceAttribution.nullable(),
  definition: EntryDefinition.optional(),
  /** FR-CMPX-15: the name of the preset this entry takes from one it replaces (no preset of its own). */
  inheritedPreset: z.string().min(1).max(NAME_MAX).optional(),
});
export type EntryResponse = z.infer<typeof EntryResponse>;
