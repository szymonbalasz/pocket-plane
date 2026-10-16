// Domain events of the compendium (CMP §9). All logged; none undoable. Entries and sources are
// not record types: these events carry no changes of their own (only `imported-entity` does).
import { COMPENDIUM_KINDS, CompendiumKind } from "@shared/compendium/schemas";
import { z } from "zod";
import { defineEvent } from "./types";

export const IMPORT_OUTCOMES = ["created", "updated", "existing"] as const;
export const ImportOutcomeKind = z.enum(IMPORT_OUTCOMES);
export type ImportOutcomeKind = z.infer<typeof ImportOutcomeKind>;

const count = z.number().int().min(0);
/** FR-CMP-07: entries per kind × outcome. */
export const ImportCounts = z.strictObject(
  Object.fromEntries(
    COMPENDIUM_KINDS.map((k) => [
      k,
      z.strictObject({ created: count, updated: count, existing: count }),
    ]),
  ) as Record<
    CompendiumKind,
    z.ZodObject<{ created: typeof count; updated: typeof count; existing: typeof count }>
  >,
);
export type ImportCounts = z.infer<typeof ImportCounts>;

/** `cmp.import` / `cmp.importRecorded` (FR-CMP-08): once, after the definition events, iff something changed. Log campaignId null. */
export const CompendiumImported = defineEvent({
  type: "CompendiumImported",
  payload: z.strictObject({ source: z.string(), version: z.string(), counts: ImportCounts }),
  logged: true,
  undoable: false,
});

/** Homebrew create / whole replace (FR-CMP-24). */
export const CompendiumEntrySaved = defineEvent({
  type: "CompendiumEntrySaved",
  payload: z.strictObject({ entryId: z.string(), kind: CompendiumKind, shared: z.boolean() }),
  logged: true,
  undoable: false,
});

/** Homebrew delete (FR-CMP-25; emitted from C4). */
export const CompendiumEntryDeleted = defineEvent({
  type: "CompendiumEntryDeleted",
  payload: z.strictObject({ entryId: z.string() }),
  logged: true,
  undoable: false,
});
