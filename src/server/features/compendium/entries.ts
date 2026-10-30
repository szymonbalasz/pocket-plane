// `compendium_entry` rows (CMP §8): derived columns, the import pipeline's store for the
// compendium kinds (OQ-CMP-17, ADR-0046 "Pipeline"), reads. Entries are not a record type: no
// changes, no WS (CON-44); imported entries carry the source key, attribution lives on the source.
import { builtinPreset, type ResolvedPreset, resolvePreset } from "@shared/compendium/presets";
import {
  ArtPath,
  COMPENDIUM_KINDS,
  type CompendiumKind,
  EntryDraft,
  entryLine,
  entryNameKey,
  REPLACES_MAX,
  ReplacedRef,
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

/**
 * FR-CMP-03: the monster entry's definition = the imported `entity` with the same provenance;
 * null for an entry-only monster (FR-CMPX-08).
 */
function definitionIdOf(tx: Tx, source: string, sourceKey: string): string | null {
  const row = tx
    .select({ id: entity.id })
    .from(entity)
    .where(and(eq(entity.source, source), eq(entity.sourceKey, sourceKey)))
    .get();
  return row?.id ?? null;
}

/**
 * What the pipeline validates, hashes and hands to the store for one imported entry: the draft,
 * plus `replaces` / `artPath` only when set, so an entry without them keeps its stored hash.
 */
export type EntryImportData = EntryDraft & { replaces?: string[]; artPath?: string };

const EntryLinks = z.object({
  replaces: z.array(ReplacedRef).max(REPLACES_MAX).optional(),
  artPath: ArtPath.optional(),
});

function entryImportSchema(k: CompendiumKind): z.ZodType<EntryImportData> {
  return z.unknown().transform((raw, c): EntryImportData => {
    const { replaces, artPath, ...rest } = (raw ?? {}) as Record<string, unknown>;
    const links = EntryLinks.safeParse({ replaces, artPath });
    const draft = EntryDraft.safeParse(rest);
    for (const i of [...(links.error?.issues ?? []), ...(draft.error?.issues ?? [])]) {
      c.addIssue({ code: "custom", path: i.path, message: i.message });
    }
    if (draft.data && draft.data.kind !== k) {
      c.addIssue({ code: "custom", path: ["kind"], message: `Expected a ${k} entry` });
    }
    if (!links.data || !draft.data) return z.NEVER;
    const refs = [...new Set(links.data.replaces ?? [])].sort();
    return {
      ...draft.data,
      ...(refs.length > 0 ? { replaces: refs } : {}),
      ...(links.data.artPath !== undefined ? { artPath: links.data.artPath } : {}),
    };
  });
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
    const { replaces = [], artPath = null, ...d } = r.data as EntryImportData;
    tx.insert(compendiumEntry)
      .values({
        id: r.id,
        campaignId: null,
        ...derivedColumns(d as EntryDraft),
        replaces,
        artPath,
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
    const { replaces = [], artPath = null, ...d } = r.data as EntryImportData;
    tx.update(compendiumEntry)
      .set({
        ...derivedColumns(d as EntryDraft),
        replaces,
        artPath,
        dataHash: r.dataHash,
        // FR-CMPX-08: a later release can give an entry-only monster its numbers.
        ...(d.kind === "monster"
          ? { definitionId: definitionIdOf(tx, r.source, r.sourceKey) }
          : {}),
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
    schema: entryImportSchema(k),
    store: entryImportStore,
  }));
}

export function registerEntryImport(reg: ImportRegistry): void {
  for (const k of entryImportKinds()) reg.registerKind(k);
}

export function getEntry(tx: Tx, id: string): EntryRow | undefined {
  return tx.select().from(compendiumEntry).where(eq(compendiumEntry.id, id)).get();
}

/**
 * FR-CMPX-15: an entry with no preset of its own takes the preset of an entry it replaces, nearest
 * first, along `replaces` chains. A ref whose entry isn't imported still finds the built-in that
 * lists it (the PHB's Hunter's Mark with no SRD imported). Derived at each read, never stored.
 */
export function inheritedPreset(tx: Pick<Tx, "select">, e: EntryRow): ResolvedPreset | null {
  if (e.kind !== "feature" && e.kind !== "spell") return null;
  const seen = new Set<string>();
  const todo = [...e.replaces];
  for (const ref of todo) {
    if (seen.has(ref)) continue;
    seen.add(ref);
    const i = ref.indexOf(":");
    const row = tx
      .select()
      .from(compendiumEntry)
      .where(
        and(
          eq(compendiumEntry.source, ref.slice(0, i)),
          eq(compendiumEntry.sourceKey, ref.slice(i + 1)),
        ),
      )
      .get();
    const preset = row ? resolvePreset(row) : builtinPreset(ref);
    if (preset) return preset;
    if (row) todo.push(...row.replaces);
  }
  return null;
}

export const EntryId = z.string().min(1).max(64);
