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
  /** `dm` = never sent to players, not even as an empty snapshot list. */
  audience?: "dm";
  schema: z.ZodType<R>;
  /** Record id on the wire. */
  idOf(r: R): string;
  /** `campaign` / `scene` scope: the record's campaign (scope gate). */
  campaignOf?(r: R): string;
  /**
   * Required for `scene` scope: the record's scene (CON-22). Players see a scene-scoped record
   * only while its scene is the campaign's active scene; DM sees every scene of the campaign.
   */
  sceneOf?(r: R): string;
  /** Player visibility; reads record + viewer only. DM always gets `full`. */
  visibility(r: R, v: Viewer): Visibility;
  /** Required when `visibility` can return `redacted`. */
  redact?(r: R, v: Viewer): unknown;
  /**
   * Bounded snapshot provider: this type's records for the viewer's campaign (pre-filter).
   * Scene scope: return every scene's rows of the campaign; the scene gate filters.
   */
  snapshot(src: SnapshotSource, v: Viewer): R[];
}

/** Active scene id of a campaign, or null (CON-22). Must be a cheap in-memory read. */
export type ActiveSceneResolver = (campaignId: string) => string | null;

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
  /** No provider (before scenes-map registers one) → no active scene → players see no scene records. */
  private activeScene: ActiveSceneResolver = () => null;
  private activeSceneProvided = false;

  register(def: AnyRecordType): void {
    if (this.types.has(def.type)) throw new Error(`Record type "${def.type}" registered twice`);
    if (def.scope !== "global" && !def.campaignOf) {
      throw new Error(`Record type "${def.type}" (scope ${def.scope}) needs campaignOf`);
    }
    if (def.scope === "scene" && !def.sceneOf) {
      throw new Error(`Record type "${def.type}" (scope scene) needs sceneOf (CON-22)`);
    }
    this.types.set(def.type, def);
  }

  /** One provider per server (scenes-map's active-scene cache). `replace`: test fixtures only. */
  provideActiveScene(fn: ActiveSceneResolver, opts: { replace?: boolean } = {}): void {
    if (this.activeSceneProvided && !opts.replace) {
      throw new Error("Active-scene resolver provided twice");
    }
    this.activeSceneProvided = true;
    this.activeScene = fn;
  }

  activeSceneOf(campaignId: string): string | null {
    return this.activeScene(campaignId);
  }

  get(type: string): AnyRecordType | undefined {
    return this.types.get(type);
  }

  all(): AnyRecordType[] {
    return [...this.types.values()];
  }

  /**
   * Scope gates + visibility fn. Unregistered → hidden for everyone (no scope to check).
   * Shared by snapshots and live events (FR-SYNC-20), so the scene gate feeds the transition
   * matrix: a scene-scoped record off the active scene is `hidden` for players (CON-22).
   */
  view(type: string, record: unknown, v: Viewer): { vis: Visibility; data?: unknown } {
    const def = this.types.get(type);
    if (!def) return { vis: "hidden" };
    if (def.scope !== "global") {
      const cid = def.campaignOf?.(record);
      if (cid !== v.campaignId) return { vis: "hidden" };
    }
    if (v.role === "dm") return { vis: "full", data: record };
    if (def.audience === "dm") return { vis: "hidden" };
    if (def.scope === "scene") {
      const active = this.activeSceneOf(v.campaignId);
      if (active === null || def.sceneOf?.(record) !== active) return { vis: "hidden" };
    }
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
      if (def.audience === "dm" && v.role !== "dm") continue;
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
