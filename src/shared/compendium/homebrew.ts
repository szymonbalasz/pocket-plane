// compendium C4 boundary shapes (CMP §9, FR-CMP-24/25/27/28): homebrew REST bodies, derive a
// monster, and the `cmp.addToSheet` intent. zod is the source of truth.
import { CreateEntityBody, EntityRecord } from "@shared/entities/schemas";
import { z } from "zod";
import { EntryDraft } from "./schemas";

const Id = z.string().min(1).max(64);

export const CMP_INTENTS = { addToSheet: "cmp.addToSheet" } as const;

/** `POST` / `PUT /api/compendium/entries[/:id]` (FR-CMP-24): homebrew create / whole replace. */
export const PutEntryBody = z.strictObject({
  entry: EntryDraft,
  shared: z.boolean().default(false),
  /** A visible entry (Clone's base); informational, no link (FR-CMP-25). */
  derivedFromId: Id.nullable().default(null),
});
export type PutEntryBody = z.output<typeof PutEntryBody>;

export const PutEntryResponse = z.strictObject({ entryId: Id });
export type PutEntryResponse = z.infer<typeof PutEntryResponse>;

/** The creature form's monster body (FR-CBT-43); `derivedFromId` comes from the entry. */
export const DeriveEntity = CreateEntityBody.options[0].omit({ derivedFromId: true });

/** `POST /api/compendium/derive-monster` (FR-CMP-27). */
export const DeriveMonsterBody = z.strictObject({
  entryId: Id,
  entity: DeriveEntity,
  /** Copy traits / actions text into the NPC sheet's Features. */
  copyText: z.boolean().default(true),
});
export type DeriveMonsterBody = z.output<typeof DeriveMonsterBody>;

export const DeriveMonsterResponse = z.strictObject({ entity: EntityRecord });
export type DeriveMonsterResponse = z.infer<typeof DeriveMonsterResponse>;

/** FR-CMP-27: copied Features rows. */
export const DERIVE_ROWS_MAX = 30;
export const DERIVE_NAME_MAX = 60;
/** FR-CMP-28 / -27: feature row text and source caps (CHARX §8.2). */
export const ROW_TEXT_MAX = 600;
export const ROW_SOURCE_MAX = 40;

/** `cmp.addToSheet` (FR-CMP-28): DM any campaign character; a player their own, unless locked. */
export const AddToSheetIntent = z.strictObject({ entryId: Id, characterId: Id });
export type AddToSheetIntent = z.infer<typeof AddToSheetIntent>;

export const AddToSheetResult = z.strictObject({
  list: z.enum(["spells", "items", "features"]),
  rowId: Id,
  /** Set when FR-CMP-29 resolved a trigger preset. */
  triggerId: Id.optional(),
});
export type AddToSheetResult = z.infer<typeof AddToSheetResult>;

/** Kinds with **Add to sheet** (FR-CMP-28), and the sheet list each lands in. */
export const SHEET_LIST_OF = { spell: "spells", item: "items", feature: "features" } as const;
export type SheetableKind = keyof typeof SHEET_LIST_OF;
export const isSheetable = (k: string): k is SheetableKind => k in SHEET_LIST_OF;

/** Text clipped to `max` chars with "…" (FR-CMP-27 / -28). */
export function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}
