// Record-type registry with visibility (SYNC §8, FR-SYNC-09/18/19). Default deny.

import { LAZY_MODES, type LazyMode } from "@shared/protocol/lazy";
import {
  DM_WINDOW_ACTIVE_SCENE,
  DM_WINDOW_VIEW_AS,
  DM_WINDOWS,
  type DmWindow,
  VIEW_AS_PARTY,
} from "@shared/protocol/scene-window";
import { cutWindow, type RecordWindow, type WindowIds } from "@shared/protocol/window";
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
   * The DM's `full` wire record: strips server-only copies (e.g. `seenBy`, FR-FOG-10, ADR-0042)
   * that the visibility fns read but no wire carries. Absent = the record as is.
   */
  dmRedact?(r: R): unknown;
  /**
   * Derived type (ADR-0042, e.g. `vision`): no table; `snapshot` computes the rows from the DB
   * and commands list before / after themselves. Same filter and transition matrix otherwise.
   */
  derived?: boolean;
  /**
   * Bounded snapshot provider: this type's records for the viewer's campaign (pre-filter).
   * Scene scope: return every scene's rows of the campaign; the scene gate filters.
   * Windowed types return the whole log; the registry cuts it (ADR-0029).
   * `scope.sceneId` (a scene load, ADR-0041 / FR-FOG-43): only that scene's rows are used, so a
   * provider may return just those (derived types should).
   */
  snapshot(src: SnapshotSource, v: Viewer, scope?: { sceneId: string }): R[];
  /**
   * Append-only logs (ADR-0029, CON-38): snapshot = pinned rows + newest `size` by `orderBy`,
   * cut before the scope gate and visibility filter, so the floor is the same for every viewer.
   */
  window?: RecordWindow<R>;
  /**
   * Scene scope only. `active-scene` (ADR-0041): the DM snapshot holds only the active scene's
   * rows (none if no scene is active); the DM loads another scene's with `sync.loadScene`.
   * `view-as` (FR-FOG-43): the DM snapshot holds none; `sync.loadScene {sceneId, viewAs}` loads
   * one player's rows of one scene. Live events and players are unchanged either way.
   */
  dmWindow?: DmWindow;
  /**
   * Lazy type (ADR-0045, FR-SYNC-30): campaign or global scope only, never with `window` /
   * `dmWindow`. Omitted from every snapshot (DM included); loaded with `sync.load {type, ids?}`.
   * `all`: whole-type and id loads; `ids`: id loads only. Live events unchanged.
   */
  lazy?: LazyMode;
  /**
   * Optional id-load provider (`sync.load {ids}`): rows among `ids` (pre-filter; may include
   * other campaigns' rows, the scope gate filters). Absent → `snapshot` rows filtered by id.
   */
  byIds?(src: SnapshotSource, v: Viewer, ids: readonly string[]): R[];
}

/** Active scene id of a campaign, or null (CON-22). Must be a cheap in-memory read. */
export type ActiveSceneResolver = (campaignId: string) => string | null;

/** The campaign a scene belongs to, or null when no such scene exists (`sync.loadScene`). */
export type SceneCampaignResolver = (sceneId: string) => string | null;

/** The campaign a player belongs to, or null when no such player exists (FR-FOG-43). */
export type PlayerCampaignResolver = (playerId: string) => string | null;

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

/**
 * One change through the transition matrix for one connection (FR-SYNC-19): a wire change,
 * `"same"` (visible → visible with identical wire data: dropped, ADR-0042 / OQ-FOG-37) or null
 * (hidden → hidden).
 */
export type FilteredChange = WireChange | "same" | null;

export class RecordRegistry {
  private types = new Map<string, AnyRecordType>();
  /** No provider (before scenes-map registers one) → no active scene → players see no scene records. */
  private activeScene: ActiveSceneResolver = () => null;
  private activeSceneProvided = false;
  /** No provider → no scene exists → every `sync.loadScene` is `not_found`. */
  private sceneCampaign: SceneCampaignResolver = () => null;
  private sceneCampaignProvided = false;
  /** No provider → no player exists → every `sync.loadScene {viewAs}` is `not_found`. */
  private playerCampaign: PlayerCampaignResolver = () => null;
  private playerCampaignProvided = false;

  register(def: AnyRecordType): void {
    if (this.types.has(def.type)) throw new Error(`Record type "${def.type}" registered twice`);
    if (def.scope !== "global" && !def.campaignOf) {
      throw new Error(`Record type "${def.type}" (scope ${def.scope}) needs campaignOf`);
    }
    if (def.scope === "scene" && !def.sceneOf) {
      throw new Error(`Record type "${def.type}" (scope scene) needs sceneOf (CON-22)`);
    }
    if (def.dmWindow !== undefined) {
      if (!(DM_WINDOWS as readonly string[]).includes(def.dmWindow)) {
        throw new Error(
          `Record type "${def.type}" dmWindow must be one of ${DM_WINDOWS.join(", ")}`,
        );
      }
      if (def.scope !== "scene") {
        throw new Error(`Record type "${def.type}" dmWindow needs scope scene (ADR-0041)`);
      }
    }
    if (def.lazy !== undefined) {
      if (!(LAZY_MODES as readonly string[]).includes(def.lazy)) {
        throw new Error(`Record type "${def.type}" lazy must be one of ${LAZY_MODES.join(", ")}`);
      }
      if (def.scope === "scene") {
        throw new Error(
          `Record type "${def.type}" lazy needs scope campaign or global (scene types use dmWindow, ADR-0045)`,
        );
      }
      if (def.window || def.dmWindow !== undefined) {
        throw new Error(`Record type "${def.type}" lazy excludes window / dmWindow (ADR-0045)`);
      }
    }
    if (def.window) {
      const { orderBy, size } = def.window;
      if (typeof orderBy !== "string" || orderBy === "") {
        throw new Error(`Record type "${def.type}" window needs orderBy (ADR-0029)`);
      }
      if (!Number.isInteger(size) || size < 1) {
        throw new Error(`Record type "${def.type}" window size must be an integer ≥ 1 (ADR-0029)`);
      }
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

  /** One provider per server (scenes-map's scene table). `replace`: test fixtures only. */
  provideSceneCampaign(fn: SceneCampaignResolver, opts: { replace?: boolean } = {}): void {
    if (this.sceneCampaignProvided && !opts.replace) {
      throw new Error("Scene-campaign resolver provided twice");
    }
    this.sceneCampaignProvided = true;
    this.sceneCampaign = fn;
  }

  sceneCampaignOf(sceneId: string): string | null {
    return this.sceneCampaign(sceneId);
  }

  /** One provider per server (campaign-management's player table). `replace`: tests only. */
  providePlayerCampaign(fn: PlayerCampaignResolver, opts: { replace?: boolean } = {}): void {
    if (this.playerCampaignProvided && !opts.replace) {
      throw new Error("Player-campaign resolver provided twice");
    }
    this.playerCampaignProvided = true;
    this.playerCampaign = fn;
  }

  playerCampaignOf(playerId: string): string | null {
    return this.playerCampaign(playerId);
  }

  /** Types registered with `dmWindow: "active-scene"` (ADR-0041). */
  dmWindowed(): AnyRecordType[] {
    return [...this.types.values()].filter((d) => d.dmWindow === DM_WINDOW_ACTIVE_SCENE);
  }

  /** Types registered with `dmWindow: "view-as"` (FR-FOG-43). */
  viewAsTypes(): AnyRecordType[] {
    return [...this.types.values()].filter((d) => d.dmWindow === DM_WINDOW_VIEW_AS);
  }

  /**
   * Scenes whose flagged rows a fresh DM snapshot holds: the active scene, or none. Null for
   * players (the scene gate already limits them; nothing is windowed).
   */
  dmWindowScene(v: Viewer): string | null {
    return v.role === "dm" ? this.activeSceneOf(v.campaignId) : null;
  }

  /** Types registered `lazy` (ADR-0045). */
  lazyTypes(): AnyRecordType[] {
    return [...this.types.values()].filter((d) => d.lazy !== undefined);
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
    if (v.role === "dm") return { vis: "full", data: def.dmRedact ? def.dmRedact(record) : record };
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

  /**
   * Transition matrix per connection (FR-SYNC-19, amended by ADR-0042 / OQ-FOG-37): hidden →
   * visible = upsert; visible → hidden = delete; visible → visible = upsert, or `"same"` when
   * the wire data is identical for this connection (stateless before / after compare, per
   * change); hidden → hidden = null.
   */
  classifyChange(c: RecordChange, v: Viewer): FilteredChange {
    const before = c.before === null ? { vis: "hidden" as const } : this.view(c.type, c.before, v);
    const after = c.after === null ? { vis: "hidden" as const } : this.view(c.type, c.after, v);
    if (after.vis !== "hidden") {
      if (before.vis !== "hidden" && Bun.deepEquals(before.data, after.data, true)) return "same";
      return { type: c.type, id: c.id, op: "upsert", data: after.data };
    }
    if (before.vis !== "hidden") return { type: c.type, id: c.id, op: "delete" };
    return null;
  }

  /** `classifyChange` as a wire change, or null (dropped: hidden → hidden or identical). */
  filterChange(c: RecordChange, v: Viewer): WireChange | null {
    const w = this.classifyChange(c, v);
    return w === "same" ? null : w;
  }

  /**
   * One event's changes for one connection: `touched` = some change passed the matrix (an
   * event whose only changes were identical upserts still goes out, empty, keeping `seq`).
   */
  filterChanges(
    changes: readonly RecordChange[],
    v: Viewer,
  ): { changes: WireChange[]; touched: boolean } {
    const out: WireChange[] = [];
    let touched = false;
    for (const c of changes) {
      const w = this.classifyChange(c, v);
      if (w === null) continue;
      touched = true;
      if (w !== "same") out.push(w);
    }
    return { changes: out, touched };
  }

  /**
   * Provider rows, cut to the window for windowed types (ADR-0029) and, for the DM, to the
   * active scene for `dmWindow` types (ADR-0041); pre-filter.
   */
  private snapshotRows(def: AnyRecordType, src: SnapshotSource, v: Viewer): unknown[] {
    if (def.dmWindow === DM_WINDOW_VIEW_AS && v.role === "dm") return [];
    let rows = def.snapshot(src, v);
    if (def.dmWindow === DM_WINDOW_ACTIVE_SCENE && v.role === "dm") {
      const active = this.dmWindowScene(v);
      rows = active === null ? [] : rows.filter((r) => def.sceneOf?.(r) === active);
    }
    return def.window ? cutWindow(rows, def.window).rows : rows;
  }

  /**
   * `sync.loadScene` result (ADR-0041): every `dmWindow` type's rows of one scene, through the
   * scope gate and the visibility fn as in a snapshot. The caller checks the scene belongs to
   * the viewer's campaign.
   */
  loadScene(src: SnapshotSource, v: Viewer, sceneId: string): Record<string, unknown[]> {
    const out: Record<string, unknown[]> = {};
    for (const def of this.dmWindowed()) {
      if (def.audience === "dm" && v.role !== "dm") continue;
      const list: unknown[] = [];
      for (const r of def.snapshot(src, v, { sceneId })) {
        if (def.sceneOf?.(r) !== sceneId) continue;
        const seen = this.view(def.type, r, v);
        if (seen.vis !== "hidden") list.push(seen.data);
      }
      out[def.type] = list;
    }
    return out;
  }

  /**
   * `sync.loadScene {sceneId, viewAs}` result (FR-FOG-43): every `view-as` type's rows of one
   * scene that player `viewAs` may see (their visibility fn as that player; no active-scene
   * gate: the DM previews any scene), rendered as the DM's wire. `viewAs: "party"` (sprint 4):
   * every row of the scene (every player's). DM only; the caller checks the scene and the
   * player belong to the viewer's campaign.
   */
  loadViewAs(
    src: SnapshotSource,
    v: Viewer,
    sceneId: string,
    viewAs: string,
  ): Record<string, unknown[]> {
    if (viewAs === VIEW_AS_PARTY) {
      const out: Record<string, unknown[]> = {};
      for (const def of this.viewAsTypes()) {
        out[def.type] = def
          .snapshot(src, v, { sceneId })
          .filter((r) => def.sceneOf?.(r) === sceneId && def.campaignOf?.(r) === v.campaignId)
          .map((r) => this.view(def.type, r, v).data);
      }
      return out;
    }
    const as: Viewer = {
      connId: v.connId,
      campaignId: v.campaignId,
      role: "player",
      playerId: viewAs,
    };
    const out: Record<string, unknown[]> = {};
    for (const def of this.viewAsTypes()) {
      const list: unknown[] = [];
      for (const r of def.snapshot(src, as, { sceneId })) {
        if (def.sceneOf?.(r) !== sceneId || def.campaignOf?.(r) !== v.campaignId) continue;
        if (def.visibility(r, as) === "hidden") continue;
        list.push(this.view(def.type, r, v).data);
      }
      out[def.type] = list;
    }
    return out;
  }

  /**
   * `sync.load` result (ADR-0045, FR-SYNC-32): every row of a lazy type (`ids` undefined) or
   * the rows among `ids`, through the scope gate and the visibility fn exactly as a snapshot
   * would send them. Ids not visible or not existing are simply absent. The caller validates
   * the type, mode and audience (FR-SYNC-31).
   */
  load(
    src: SnapshotSource,
    v: Viewer,
    type: string,
    ids?: readonly string[],
  ): Record<string, unknown[]> {
    const def = this.types.get(type);
    if (!def || def.lazy === undefined) throw new Error(`Record type "${type}" is not lazy`);
    let rows: unknown[];
    if (ids === undefined) rows = def.snapshot(src, v);
    else {
      const want = new Set(ids);
      const found = def.byIds ? def.byIds(src, v, ids) : def.snapshot(src, v);
      rows = found.filter((r) => want.has(def.idOf(r)));
    }
    const list: unknown[] = [];
    for (const r of rows) {
      const seen = this.view(type, r, v);
      if (seen.vis !== "hidden") list.push(seen.data);
    }
    return { [type]: list };
  }

  /**
   * Per windowed type the viewer receives: the record IDs the snapshot is cut to (pinned +
   * newest `size`, pre-filter) and the floor. Convergence and leak-scan helpers use it.
   */
  windowCuts(
    src: SnapshotSource,
    v: Viewer,
  ): Record<string, { ids: string[]; floor: number | null }> {
    const out: Record<string, { ids: string[]; floor: number | null }> = {};
    for (const def of this.types.values()) {
      if (!def.window) continue;
      if (def.audience === "dm" && v.role !== "dm") continue;
      const cut = cutWindow(def.snapshot(src, v), def.window);
      out[def.type] = { ids: cut.rows.map((r) => def.idOf(r)), floor: cut.floor };
    }
    return out;
  }

  /** `windowCuts` as the ID map `windowProjection` takes. */
  windowIds(src: SnapshotSource, v: Viewer): WindowIds {
    const out: Record<string, string[]> = {};
    for (const [type, cut] of Object.entries(this.windowCuts(src, v))) out[type] = cut.ids;
    return out;
  }

  /** Snapshot records per type through the same filter (FR-SYNC-20). Lazy types: never. */
  snapshot(src: SnapshotSource, v: Viewer): Record<string, unknown[]> {
    const out: Record<string, unknown[]> = {};
    for (const def of this.types.values()) {
      if (def.lazy !== undefined) continue;
      if (def.audience === "dm" && v.role !== "dm") continue;
      const list: unknown[] = [];
      for (const r of this.snapshotRows(def, src, v)) {
        const seen = this.view(def.type, r, v);
        if (seen.vis !== "hidden") list.push(seen.data);
      }
      out[def.type] = list;
    }
    return out;
  }
}
