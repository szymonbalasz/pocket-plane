// Record-type registry with visibility (SYNC §8, FR-SYNC-09/18/19). Default deny.
import type { z } from "zod";
import type { Db } from "../db/client";
import type { RecordChange, Role } from "../events/types";

export type Visibility = "full" | "redacted" | "hidden";
export type Scope = "global" | "campaign" | "scene";

/** Connection context; fixed for the connection's life (FR-SYNC-03). */
export interface Viewer {
  connId: string;
  campaignId: string;
  role: Role;
  playerId: string | null;
}

export interface PresenceView {
  /** All presence records of a campaign (DM only). */
  list(campaignId: string): { playerId: string; online: boolean }[];
}

export interface SnapshotSource {
  db: Db;
  presence: PresenceView;
}

export interface RecordTypeDef<R> {
  type: string;
  scope: Scope;
  schema: z.ZodType<R>;
  /** Record id on the wire. */
  idOf(r: R): string;
  /** `campaign` / `scene` scope: the record's campaign (scope gate). */
  campaignOf?(r: R): string;
  /** Player visibility; reads record + viewer only. DM always gets `full`. */
  visibility(r: R, v: Viewer): Visibility;
  /** Required when `visibility` can return `redacted`. */
  redact?(r: R, v: Viewer): unknown;
  /** Bounded snapshot provider: this type's records for the viewer's campaign (pre-filter). */
  snapshot(src: SnapshotSource, v: Viewer): R[];
}

/** Type-erased registration (the registry works on unknown records). */
export type AnyRecordType = RecordTypeDef<unknown>;

export function defineRecordType<R>(def: RecordTypeDef<R>): AnyRecordType {
  return def as unknown as AnyRecordType;
}

export interface WireChange {
  type: string;
  id: string;
  op: "upsert" | "delete";
  data?: unknown;
}

export class RecordRegistry {
  private types = new Map<string, AnyRecordType>();

  register(def: AnyRecordType): void {
    if (this.types.has(def.type)) throw new Error(`Record type "${def.type}" registered twice`);
    this.types.set(def.type, def);
  }

  get(type: string): AnyRecordType | undefined {
    return this.types.get(type);
  }

  all(): AnyRecordType[] {
    return [...this.types.values()];
  }

  /** Scope gate + visibility fn. Unregistered → hidden for everyone (no scope to check). */
  view(type: string, record: unknown, v: Viewer): { vis: Visibility; data?: unknown } {
    const def = this.types.get(type);
    if (!def) return { vis: "hidden" };
    if (def.scope !== "global") {
      const cid = def.campaignOf?.(record);
      if (cid !== v.campaignId) return { vis: "hidden" };
    }
    if (v.role === "dm") return { vis: "full", data: record };
    const vis = def.visibility(record, v);
    if (vis === "hidden") return { vis };
    if (vis === "redacted") {
      if (!def.redact) return { vis: "hidden" };
      return { vis, data: def.redact(record, v) };
    }
    return { vis, data: record };
  }

  /** Transition matrix per connection (FR-SYNC-19). */
  filterChange(c: RecordChange, v: Viewer): WireChange | null {
    const before = c.before === null ? { vis: "hidden" as const } : this.view(c.type, c.before, v);
    const after = c.after === null ? { vis: "hidden" as const } : this.view(c.type, c.after, v);
    if (after.vis !== "hidden") return { type: c.type, id: c.id, op: "upsert", data: after.data };
    if (before.vis !== "hidden") return { type: c.type, id: c.id, op: "delete" };
    return null;
  }

  /** Snapshot records per type through the same filter (FR-SYNC-20). */
  snapshot(src: SnapshotSource, v: Viewer): Record<string, unknown[]> {
    const out: Record<string, unknown[]> = {};
    for (const def of this.types.values()) {
      const list: unknown[] = [];
      for (const r of def.snapshot(src, v)) {
        const seen = this.view(def.type, r, v);
        if (seen.vis !== "hidden") list.push(seen.data);
      }
      out[def.type] = list;
    }
    return out;
  }
}
