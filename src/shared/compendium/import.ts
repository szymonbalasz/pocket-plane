// compendium import REST shapes (CMP §9, FR-CMP-20): the DM's sources list (import panel) and
// `POST /api/compendium/import`. zod is the source of truth.
import { ImportCounts } from "@shared/events/compendium";
import { z } from "zod";
import { type CompendiumKind, CompendiumSource } from "./schemas";

/**
 * `POST /api/compendium/import` body: a source key, never data or a path (OQ-CMP-17, FR-CMPX-02).
 * `run`: the same value on each book of one Import / Update, which adapts from one folder read;
 * `last` on its last book ends the run (the server's log line, the read dropped).
 */
export const ImportRequest = z.strictObject({
  source: z.string().min(1).max(64),
  run: z.string().min(1).max(64).optional(),
  last: z.literal(true).optional(),
});
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

/** One book of the 5etools folder (FR-CMPX-02); `imported*`: its stored source row. */
export const BookStatus = z.strictObject({
  key: z.string().min(1).max(64),
  name: z.string().min(1),
  abbr: z.string().min(1),
  counts: z.strictObject({
    monster: z.number().int().min(0),
    spell: z.number().int().min(0),
    item: z.number().int().min(0),
  }),
  importedVersion: z.string().min(1).optional(),
  importedAt: z.string().min(1).optional(),
});
export type BookStatus = z.infer<typeof BookStatus>;

/** FR-CMPX-17, spec §9: the DM's 5etools folder. `path`, `issues`: only for `not-found`. */
export const FiveEtoolsStatus = z.strictObject({
  state: z.enum(["not-configured", "not-found", "ready"]),
  path: z.string().optional(),
  issues: z.array(z.string()).optional(),
  /** The release, as shown ("1.217.1"). */
  release: z.string().optional(),
  /** FR-CMPX-03: differs from a book's `importedVersion` → **Update**. */
  version: z.string().optional(),
  books: z.array(BookStatus),
});
export type FiveEtoolsStatus = z.infer<typeof FiveEtoolsStatus>;

/** `GET /api/compendium/sources` (DM). */
export const SourcesResponse = z.strictObject({
  sources: z.array(SourceStatus),
  fiveEtools: FiveEtoolsStatus,
});
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

/** FR-CMPX-19: a book's `data-state` in the 5etools list. */
export function bookPanelState(
  b: Pick<BookStatus, "importedVersion">,
  version: string | undefined,
): "new" | "imported" | "outdated" {
  if (b.importedVersion === undefined) return "new";
  return b.importedVersion === version ? "imported" : "outdated";
}

/** FR-CMPX-17 Toast after a run: totals over its books, then the warning count. */
export function booksSummary(results: readonly ImportResponse[]): string {
  let existing = 0;
  let created = 0;
  let updated = 0;
  let warnings = 0;
  for (const r of results) {
    warnings += r.warnings.length;
    for (const c of Object.values(r.counts)) {
      created += c.created;
      updated += c.updated;
      existing += c.existing;
    }
  }
  const changed = created + updated;
  const n = (v: number) => v.toLocaleString("en-US");
  const books = `${results.length} ${results.length === 1 ? "book" : "books"}`;
  const totals =
    changed === 0
      ? `0 changed · ${n(existing)} unchanged`
      : `${n(created)} new · ${n(updated)} updated · ${n(existing)} unchanged`;
  const warned = `${n(warnings)} ${warnings === 1 ? "warning" : "warnings"}`;
  return `${books}: ${totals} · ${warned}`;
}

/** The import panel's state for one source (FR-CMP-20). */
export function sourcePanelState(s: SourceStatus): "empty" | "current" | "update" {
  if (s.imported === null) return "empty";
  return s.imported.version === s.bundledVersion ? "current" : "update";
}
