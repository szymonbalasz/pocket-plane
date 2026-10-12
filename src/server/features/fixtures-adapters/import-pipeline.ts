// Import pipeline core (FIX §9, FR-FIX-18–23, ADR-0015, ADR-0018):
// validate all → insert by global (source, sourceKey) → provenance. All-or-nothing.
// The definition table, kinds and the definition domain event are owned by entities (CON-03):
// they plug in through `ImportRegistry` (`src/server/features/entities/import-store.ts`).
import type { DomainEventDef } from "@shared/events";
import type { Issue } from "@shared/protocol/codes";
import { z } from "zod";
import { defineCommand } from "../../commands/commands";
import { CommandError, zodIssues } from "../../commands/errors";
import type { Tx } from "../../db/client";

export const SourceDescriptor = z.object({
  key: z.string().min(1).max(64),
  name: z.string().min(1),
  licence: z.string().min(1),
  attribution: z.string().min(1),
  url: z.url().optional(),
});
export type SourceDescriptor = z.infer<typeof SourceDescriptor>;

export const ImportRecord = z.object({
  kind: z.string().min(1),
  sourceKey: z.string().min(1).max(200),
  data: z.unknown(),
});

export const ImportBatch = z.object({
  source: SourceDescriptor,
  records: z.array(ImportRecord),
});
export type ImportBatch = z.infer<typeof ImportBatch>;

export interface Provenance {
  source: string;
  sourceKey: string;
  licence: string;
  attribution: string;
  importedAt: string;
}

export interface DefinitionKind {
  kind: string;
  /** Per-kind data schema (ADR-0009 registry; MVP: `monster`, owned by entities). */
  schema: z.ZodType;
}

/** Insert interface the definition owner implements; writes go through the command's tx. */
export interface DefinitionStore {
  /** Sync record type of a definition (e.g. `definition`). */
  recordType: string;
  /** Domain event emitted per created definition; logged with campaignId null. */
  createdEvent: DomainEventDef;
  find(tx: Tx, source: string, sourceKey: string): { id: string } | null;
  insert(
    tx: Tx,
    row: { id: string; kind: string; data: unknown } & Provenance,
  ): { record: unknown; payload: unknown };
}

export class ImportRegistry {
  private kinds = new Map<string, DefinitionKind>();
  store: DefinitionStore | null = null;

  registerKind(k: DefinitionKind): void {
    if (this.kinds.has(k.kind)) throw new Error(`Import kind "${k.kind}" registered twice`);
    this.kinds.set(k.kind, k);
  }

  kind(name: string): DefinitionKind | undefined {
    return this.kinds.get(name);
  }
}

export type ImportOutcome = { sourceKey: string; outcome: "created" | "existing"; id: string };

/** FR-FIX-18/19: every error, with sourceKey + field path. No writes. */
export function validateBatch(reg: ImportRegistry, raw: unknown): ImportBatch {
  const parsed = ImportBatch.safeParse(raw);
  if (!parsed.success)
    throw new CommandError("invalid", "Invalid import batch", zodIssues(parsed.error));
  const batch = parsed.data;
  const issues: Issue[] = [];
  const seen = new Set<string>();
  batch.records.forEach((r) => {
    if (seen.has(r.sourceKey)) {
      issues.push({ path: [r.sourceKey], message: "Duplicate sourceKey in batch" });
    }
    seen.add(r.sourceKey);
    const k = reg.kind(r.kind);
    if (!k) {
      issues.push({ path: [r.sourceKey, "kind"], message: `Unknown kind "${r.kind}"` });
      return;
    }
    const d = k.schema.safeParse(r.data);
    if (!d.success) {
      for (const i of zodIssues(d.error)) {
        issues.push({ path: [r.sourceKey, "data", ...i.path], message: i.message });
      }
    }
  });
  if (issues.length > 0) throw new CommandError("invalid", "Import batch rejected", issues);
  return batch;
}

/** Derived: imported definitions are read-only (FIX §8). */
export const isReadOnly = (p: { source: string | null }) => p.source !== null;

export function importBatchCommand(reg: ImportRegistry) {
  return defineCommand({
    name: "import.batch",
    input: z.unknown(),
    roles: ["dm"],
    execute(raw, { tx, ctx, emit }): ImportOutcome[] {
      const batch = validateBatch(reg, raw);
      const store = reg.store;
      if (!store) throw new CommandError("invalid", "No definition store registered");
      const importedAt = ctx.clock.iso();
      return batch.records.map((r) => {
        const existing = store.find(tx, batch.source.key, r.sourceKey);
        if (existing) return { sourceKey: r.sourceKey, outcome: "existing", id: existing.id };
        const kind = reg.kind(r.kind) as DefinitionKind;
        const id = ctx.ids.next();
        const { record, payload } = store.insert(tx, {
          id,
          kind: r.kind,
          data: kind.schema.parse(r.data),
          source: batch.source.key,
          sourceKey: r.sourceKey,
          licence: batch.source.licence,
          attribution: batch.source.attribution,
          importedAt,
        });
        emit({
          type: store.createdEvent.type,
          campaignId: null,
          payload,
          changes: [{ type: store.recordType, id, before: null, after: record }],
        });
        return { sourceKey: r.sourceKey, outcome: "created", id };
      });
    },
  });
}
