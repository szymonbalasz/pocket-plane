// Import pipeline core (FIX §9, FR-FIX-18–23, ADR-0015, ADR-0018, ADR-0046):
// validate all → upsert by global (source, sourceKey) → provenance. All-or-nothing.
// Per-kind stores (OQ-CMP-17): each importable kind plugs in its schema and the store that owns
// its table, events and record type (entities: `monster`, CON-03; compendium: its entry kinds).
// Outcomes `created` | `updated` (stored data hash differs, OQ-FIX-18) | `existing`.
import { createHash } from "node:crypto";
import type { Issue } from "@shared/protocol/codes";
import { z } from "zod";
import { type CommandEnv, defineCommand } from "../../commands/commands";
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

/** A record as the store writes it: parsed `data`, its hash, provenance. */
export interface StoreRow extends Provenance {
  kind: string;
  data: unknown;
  /** `dataHash(data)`; the store may persist it or recompute it in `find`. */
  dataHash: string;
}

/** What `find` returns: the row's id and the hash of its stored data. */
export interface StoredImport {
  id: string;
  dataHash: string;
}

/**
 * Write interface a kind's owner implements; writes go through the command's env (tx, ctx, emit).
 * A store emits its own domain events (e.g. entities: `EntityImported` per created definition).
 */
export interface ImportStore {
  /** Store name for messages and tests, e.g. `entities`. */
  name: string;
  find(tx: Tx, source: string, sourceKey: string): StoredImport | null;
  insert(env: CommandEnv, row: StoreRow & { id: string }): void;
  /** In-place update of a changed row (OQ-FIX-18); `id` from `find`. */
  update(env: CommandEnv, id: string, row: StoreRow): void;
}

export interface ImportKind {
  kind: string;
  /** Per-kind data schema (ADR-0009 registry; entities: `monster`). */
  schema: z.ZodType;
  store: ImportStore;
}

export class ImportRegistry {
  private kinds = new Map<string, ImportKind>();

  registerKind(k: ImportKind): void {
    if (this.kinds.has(k.kind)) throw new Error(`Import kind "${k.kind}" registered twice`);
    this.kinds.set(k.kind, k);
  }

  kind(name: string): ImportKind | undefined {
    return this.kinds.get(name);
  }

  names(): string[] {
    return [...this.kinds.keys()];
  }
}

export type ImportOutcomeKind = "created" | "updated" | "existing";
export type ImportOutcome = { sourceKey: string; outcome: ImportOutcomeKind; id: string };

/** Sorted-key JSON: equal data → equal text, whatever the key order (stored JSON included). */
export function stableJson(v: unknown): string {
  if (Array.isArray(v))
    return `[${v.map((x) => (x === undefined ? "null" : stableJson(x))).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

/** Upsert change detection (OQ-FIX-18, FR-CMP-07): SHA-256 of `stableJson`. */
export function dataHash(v: unknown): string {
  return createHash("sha256").update(stableJson(v)).digest("hex");
}

/** FR-FIX-18/19: every issue, with sourceKey + field path. No writes. */
export function batchIssues(reg: ImportRegistry, batch: ImportBatch): Issue[] {
  const issues: Issue[] = [];
  const seen = new Set<string>();
  batch.records.forEach((r) => {
    const k = reg.kind(r.kind);
    // Keys are unique per store (one table each); a kind's store is fixed.
    const key = `${k?.store.name ?? r.kind}\0${r.sourceKey}`;
    if (seen.has(key)) {
      issues.push({ path: [r.sourceKey], message: "Duplicate sourceKey in batch" });
    }
    seen.add(key);
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
  return issues;
}

export function parseBatch(raw: unknown): ImportBatch {
  const parsed = ImportBatch.safeParse(raw);
  if (!parsed.success)
    throw new CommandError("invalid", "Invalid import batch", zodIssues(parsed.error));
  return parsed.data;
}

/** FR-FIX-18/19: throws `invalid` with every issue. No writes. */
export function validateBatch(reg: ImportRegistry, raw: unknown): ImportBatch {
  const batch = parseBatch(raw);
  const issues = batchIssues(reg, batch);
  if (issues.length > 0) throw new CommandError("invalid", "Import batch rejected", issues);
  return batch;
}

/**
 * Upsert a validated batch inside the caller's transaction (FR-FIX-20, OQ-FIX-18): new key →
 * `created`; stored data hash differs → `updated` in place; else `existing`, nothing written.
 */
export function upsertBatch(
  reg: ImportRegistry,
  env: CommandEnv,
  batch: ImportBatch,
): ImportOutcome[] {
  const importedAt = env.ctx.clock.iso();
  return batch.records.map((r): ImportOutcome => {
    const kind = reg.kind(r.kind) as ImportKind;
    const data = kind.schema.parse(r.data);
    const row: StoreRow = {
      kind: r.kind,
      data,
      dataHash: dataHash(data),
      source: batch.source.key,
      sourceKey: r.sourceKey,
      licence: batch.source.licence,
      attribution: batch.source.attribution,
      importedAt,
    };
    const existing = kind.store.find(env.tx, batch.source.key, r.sourceKey);
    if (!existing) {
      const id = env.ctx.ids.next();
      kind.store.insert(env, { ...row, id });
      return { sourceKey: r.sourceKey, outcome: "created", id };
    }
    if (existing.dataHash === row.dataHash) {
      return { sourceKey: r.sourceKey, outcome: "existing", id: existing.id };
    }
    kind.store.update(env, existing.id, row);
    return { sourceKey: r.sourceKey, outcome: "updated", id: existing.id };
  });
}

/** Derived: imported definitions are read-only (FIX §8). */
export const isReadOnly = (p: { source: string | null }) => p.source !== null;

export function importBatchCommand(reg: ImportRegistry) {
  return defineCommand({
    name: "import.batch",
    input: z.unknown(),
    roles: ["dm"],
    execute(raw, env): ImportOutcome[] {
      return upsertBatch(reg, env, validateBatch(reg, raw));
    },
  });
}
