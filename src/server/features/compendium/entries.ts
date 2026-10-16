// `compendium_entry` rows (CMP §8): derived columns, the import pipeline's store for the
// compendium kinds (OQ-CMP-17, ADR-0046 "Pipeline"), reads. Entries are not a record type: no
// changes, no WS (CON-44); imported entries carry the source key, attribution lives on the source.
import {
  COMPENDIUM_KINDS,
  type CompendiumKind,
  EntryDraft,
  entryLine,
  entryNameKey,
} from "@shared/compendium/schemas";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "../../db/client";
import { compendiumEntry, entity } from "../../db/schema";
import type { ImportKind, ImportRegistry, ImportStore } from "../fixtures-adapters/import-pipeline";

export type EntryRow = typeof compendiumEntry.$inferSelect;

/** Import kind of a compendium kind; distinct from entities' `monster` (the definition). */
export const importKindOf = (k: CompendiumKind) => `cmp.${k}`;

/** Body keys that are data, not reading text (FR-CMP-29 presets). */
const NOT_TEXT = new Set(["preset", "presetKey"]);

function strings(v: unknown, out: string[]): void {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v !== null && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) if (!NOT_TEXT.has(k)) strings(x, out);
  }
}

/** `searchText` (FR-CMP-10): lower-case plain text of name, line and body; markdown-lite marks dropped. */
export function searchTextOf(d: EntryDraft, line: string): string {
  const parts = [d.name, line];
  strings(d.body, parts);
  return parts
    .join("\n")
    .replace(/[*|]/g, " ")
    .replace(/[ \t]+/g, " ")
    .toLowerCase();
}

/** Columns derived from a draft at write (CMP §8). */
export function derivedColumns(d: EntryDraft) {
  const line = entryLine(d);
  return {
    kind: d.kind,
    name: d.name,
    nameKey: entryNameKey(d.name),
    line,
    facets: d.facets,
    body: d.body,
    searchText: searchTextOf(d, line),
  };
}

/** FR-CMP-03: the monster entry's definition = the imported `entity` with the same provenance. */
function definitionIdOf(tx: Tx, source: string, sourceKey: string): string {
  const row = tx
    .select({ id: entity.id })
    .from(entity)
    .where(and(eq(entity.source, source), eq(entity.sourceKey, sourceKey)))
    .get();
  if (!row) throw new Error(`compendium: no imported definition for ${source}:${sourceKey}`);
  return row.id;
}

/** Imported entries (FR-CMP-02, -07): upsert by `(source, sourceKey)`; never emits. */
export const entryImportStore: ImportStore = {
  name: "compendium",
  find(tx, source, sourceKey) {
    const row = tx
      .select({ id: compendiumEntry.id, dataHash: compendiumEntry.dataHash })
      .from(compendiumEntry)
      .where(and(eq(compendiumEntry.source, source), eq(compendiumEntry.sourceKey, sourceKey)))
      .get();
    return row ?? null;
  },
  insert({ tx }, r) {
    const d = r.data as EntryDraft;
    tx.insert(compendiumEntry)
      .values({
        id: r.id,
        campaignId: null,
        ...derivedColumns(d),
        source: r.source,
        sourceKey: r.sourceKey,
        dataHash: r.dataHash,
        definitionId: d.kind === "monster" ? definitionIdOf(tx, r.source, r.sourceKey) : null,
        shared: false,
        derivedFromId: null,
        createdAt: r.importedAt,
        updatedAt: r.importedAt,
        importedAt: r.importedAt,
      })
      .run();
  },
  update({ tx }, id, r) {
    const d = r.data as EntryDraft;
    tx.update(compendiumEntry)
      .set({
        ...derivedColumns(d),
        dataHash: r.dataHash,
        updatedAt: r.importedAt,
        importedAt: r.importedAt,
      })
      .where(eq(compendiumEntry.id, id))
      .run();
  },
};

/** One import kind per compendium kind: the entry draft of exactly that kind (FR-CMP-01). */
export function entryImportKinds(): ImportKind[] {
  return COMPENDIUM_KINDS.map((k) => ({
    kind: importKindOf(k),
    schema: EntryDraft.refine((d) => d.kind === k, {
      message: `Expected a ${k} entry`,
      path: ["kind"],
    }) as z.ZodType,
    store: entryImportStore,
  }));
}

export function registerEntryImport(reg: ImportRegistry): void {
  for (const k of entryImportKinds()) reg.registerKind(k);
}

export function getEntry(tx: Tx, id: string): EntryRow | undefined {
  return tx.select().from(compendiumEntry).where(eq(compendiumEntry.id, id)).get();
}

export const EntryId = z.string().min(1).max(64);
