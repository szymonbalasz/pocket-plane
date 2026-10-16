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
  SpellSchool,
  SrdClass,
} from "./schemas";

/** FR-CMP-10: query text cap and page size. */
export const SEARCH_Q_MAX = 100;
export const SEARCH_PAGE = 50;
/** FR-CMP-10: below this length the body text is not searched (names only). */
export const TEXT_MATCH_MIN = 3;
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
] as const;
export type FilterKey = (typeof ALL_FILTER_KEYS)[number];

/** `GET /api/compendium/search` query (FR-CMP-10 / -11). Strict: an unknown key → `invalid`. */
export const SearchQuery = z
  .strictObject({
    q: z.string().max(SEARCH_Q_MAX).optional(),
    kind: CompendiumKind.optional(),
    cursor: z.string().min(1).max(CURSOR_MAX).optional(),
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
  })
  .superRefine((q, c) => {
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

/** One search result (FR-CMP-10). `definitionId`: monsters only (the imported definition). */
export const EntrySummary = z.strictObject({
  id: z.string().min(1).max(64),
  kind: CompendiumKind,
  name: EntryName,
  /** Imported: the source's name (e.g. "SRD 5.1"); homebrew: "Homebrew". */
  sourceLabel: z.string().min(1).max(NAME_MAX),
  line: z.string().max(LINE_MAX),
  definitionId: z.string().min(1).max(64).optional(),
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
});
export type SourceAttribution = z.infer<typeof SourceAttribution>;

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
});
export type EntryResponse = z.infer<typeof EntryResponse>;
