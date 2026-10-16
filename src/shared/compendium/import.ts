// compendium import REST shapes (CMP §9, FR-CMP-20): the DM's sources list (import panel) and
// `POST /api/compendium/import`. zod is the source of truth.
import { ImportCounts } from "@shared/events/compendium";
import { z } from "zod";
import { type CompendiumKind, CompendiumSource } from "./schemas";

/** `POST /api/compendium/import` body: a bundled source key, never data (OQ-CMP-17). */
export const ImportRequest = z.strictObject({ source: z.string().min(1).max(64) });
export type ImportRequest = z.infer<typeof ImportRequest>;

export const ImportWarning = z.strictObject({
  sourceKey: z.string(),
  field: z.string(),
  message: z.string(),
});

/** `200` of the import (FR-CMP-07): counts per kind × outcome, adapter warnings. */
export const ImportResponse = z.strictObject({
  source: z.string(),
  version: z.string(),
  counts: ImportCounts,
  warnings: z.array(ImportWarning),
});
export type ImportResponse = z.infer<typeof ImportResponse>;

/** One bundled source for the import panel: what the repo ships vs what the DB holds. */
export const SourceStatus = z.strictObject({
  key: z.string().min(1).max(64),
  name: z.string().min(1),
  /** Version of the bundled files (+ adapter); differs from `imported.version` → **Update**. */
  bundledVersion: z.string().min(1),
  imported: CompendiumSource.pick({ version: true, importedAt: true, counts: true }).nullable(),
});
export type SourceStatus = z.infer<typeof SourceStatus>;

/** `GET /api/compendium/sources` (DM). */
export const SourcesResponse = z.strictObject({ sources: z.array(SourceStatus) });
export type SourcesResponse = z.infer<typeof SourcesResponse>;

/** Entries of the last import, all kinds (panel status "SRD 5.1 · N entries"). */
export function entryTotal(counts: Partial<Record<CompendiumKind, number>>): number {
  return Object.values(counts).reduce<number>((n, c) => n + (c ?? 0), 0);
}

/** Toast line of an import: "1,076 new · 3 updated · 55 unchanged". */
export function importSummary(counts: ImportCounts): string {
  let created = 0;
  let updated = 0;
  let existing = 0;
  for (const c of Object.values(counts)) {
    created += c.created;
    updated += c.updated;
    existing += c.existing;
  }
  const n = (v: number) => v.toLocaleString("en-US");
  return `${n(created)} new · ${n(updated)} updated · ${n(existing)} unchanged`;
}

/** The import panel's state for one source (FR-CMP-20). */
export function sourcePanelState(s: SourceStatus): "empty" | "current" | "update" {
  if (s.imported === null) return "empty";
  return s.imported.version === s.bundledVersion ? "current" : "update";
}
