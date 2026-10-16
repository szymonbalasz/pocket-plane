// `cmp.import` / `cmp.importRecorded` (FR-CMP-07–09): adapter → pipeline core, one transaction:
// validate all → upsert the source row, definitions (entities' store) and entries (ours) by
// `(source, sourceKey)` → per record created | updated | existing. Any error → nothing written,
// every issue returned. Changed definitions run entities' hooks (FR-CMP-08). Then one
// `CompendiumImported`, only if something was written. No route here (C3 adds it).
import { COMPENDIUM_KINDS, type CompendiumKind } from "@shared/compendium/schemas";
import { CompendiumImported, type ImportCounts } from "@shared/events/compendium";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { conflict, invalid } from "../../commands/errors";
import { compendiumSource } from "../../db/schema";
import { activeCampaign } from "../campaign-management/commands";
import { startedEncounter } from "../combat-tracker/rows";
import {
  batchIssues,
  type ImportBatch,
  type ImportOutcome,
  type ImportOutcomeKind,
  type ImportRegistry,
  SourceDescriptor,
  upsertBatch,
} from "../fixtures-adapters/import-pipeline";
import {
  type AdapterResult,
  type AdapterWarning,
  adaptOpen5e,
  OPEN5E_ENDPOINTS,
} from "./adapter/open5e";
import { importKindOf } from "./entries";
import { BUNDLED_SOURCE_KEYS, bundledSource } from "./sources";

export const IMPORT = "cmp.import";
export const IMPORT_RECORDED = "cmp.importRecorded";
/** FR-CMP-07: the one-transaction write pauses every command, combat included. */
export const END_COMBAT_FIRST = "End combat first";

export const ImportInput = z.strictObject({ source: z.enum(BUNDLED_SOURCE_KEYS) });

/** Internal twin (fixtures, tests): a source descriptor + version + recorded responses. */
export const ImportRecordedInput = z.strictObject({
  source: SourceDescriptor,
  version: z.string().min(1).max(128),
  responses: z.partialRecord(z.enum(OPEN5E_ENDPOINTS), z.array(z.unknown()).readonly()),
});

export interface ImportResult {
  source: string;
  version: string;
  counts: ImportCounts;
  warnings: AdapterWarning[];
  /** False → nothing written, no event, no log entry (FR-CMP-08, -31). */
  changed: boolean;
}

const zeroCounts = (): ImportCounts =>
  Object.fromEntries(
    COMPENDIUM_KINDS.map((k) => [k, { created: 0, updated: 0, existing: 0 }]),
  ) as ImportCounts;

const RANK: Record<ImportOutcomeKind, number> = { existing: 0, updated: 1, created: 2 };

/** The adapter's records as one batch: a monster is its definition, then its entry (FR-CMP-03). */
function toBatch(source: SourceDescriptor, adapted: AdapterResult): ImportBatch {
  return {
    source,
    records: adapted.records.flatMap((r) => {
      const entry = { kind: importKindOf(r.kind), sourceKey: r.sourceKey, data: r.data };
      return r.kind === "monster"
        ? [{ kind: "monster", sourceKey: r.sourceKey, data: r.definition }, entry]
        : [entry];
    }),
  };
}

/** Counts per kind × outcome; a monster's definition and entry count once, as the stronger. */
function countOutcomes(adapted: AdapterResult, outcomes: ImportOutcome[]): ImportCounts {
  const best = new Map<string, ImportOutcomeKind>();
  for (const o of outcomes) {
    const prev = best.get(o.sourceKey);
    if (!prev || RANK[o.outcome] > RANK[prev]) best.set(o.sourceKey, o.outcome);
  }
  const counts = zeroCounts();
  for (const r of adapted.records) counts[r.kind][best.get(r.sourceKey) ?? "existing"]++;
  return counts;
}

export function runImport(
  reg: ImportRegistry,
  env: CommandEnv,
  input: { source: SourceDescriptor; version: string; adapted: AdapterResult },
): ImportResult {
  const { source, version, adapted } = input;
  const batch = toBatch(source, adapted);
  const issues = batchIssues(reg, batch);
  if (issues.length > 0) throw invalid("Import rejected", issues);

  const { tx, ctx } = env;
  const now = ctx.clock.iso();
  const row = {
    name: source.name,
    licence: source.licence,
    attribution: source.attribution,
    url: source.url ?? null,
    version,
  };
  const stored = tx
    .select()
    .from(compendiumSource)
    .where(eq(compendiumSource.key, source.key))
    .get();
  // Entries reference the source row (FK): a new source is written first.
  if (!stored) {
    tx.insert(compendiumSource)
      .values({ key: source.key, ...row, importedAt: now, counts: {} })
      .run();
  }
  const sourceChanged =
    !stored || (Object.keys(row) as (keyof typeof row)[]).some((k) => stored[k] !== row[k]);

  const outcomes = upsertBatch(reg, env, batch);
  const counts = countOutcomes(adapted, outcomes);
  const changed =
    sourceChanged || outcomes.some((o) => o.outcome === "created" || o.outcome === "updated");
  if (changed) {
    tx.update(compendiumSource)
      .set({
        ...row,
        importedAt: now,
        counts: { ...adapted.counts } as Record<CompendiumKind, number>,
      })
      .where(eq(compendiumSource.key, source.key))
      .run();
    env.emit({
      type: CompendiumImported.type,
      campaignId: null,
      payload: { source: source.key, version, counts },
      changes: [],
    });
  }
  return { source: source.key, version, counts, warnings: adapted.warnings, changed };
}

/** `cmp.import {source}` (DM): a bundled source by key; refused while an encounter is started. */
export function importCommand(reg: ImportRegistry) {
  return defineCommand({
    name: IMPORT,
    input: ImportInput,
    execute({ source }, env): ImportResult {
      const active = activeCampaign(env.tx);
      if (active && startedEncounter(env.tx, active.id)) throw conflict(END_COMBAT_FIRST);
      const { bundled, adapted } = bundledSource(source);
      return runImport(reg, env, { source: bundled.source, version: bundled.version, adapted });
    },
  });
}

/** `cmp.importRecorded` (internal: fixtures, tests; no encounter check). */
export function importRecordedCommand(reg: ImportRegistry) {
  return defineCommand({
    name: IMPORT_RECORDED,
    input: ImportRecordedInput,
    execute({ source, version, responses }, env): ImportResult {
      return runImport(reg, env, { source, version, adapted: adaptOpen5e(responses) });
    },
  });
}
