// Active-scene window (ADR-0041): flagged scene-scoped types reach the DM snapshot for the
// active scene only; the DM client loads another scene's rows with `sync.loadScene`.
// Pure; shared by the server hub, the clients and the test harness.
import { z } from "zod";
import type { RecordMap, RecordStore } from "./store";

/** Registration flag values (scene scope only). */
export const DM_WINDOW_ACTIVE_SCENE = "active-scene";
/**
 * FR-FOG-43 (ADR-0042, seams S1): one player's rows, never in the DM snapshot; the DM loads
 * them with `sync.loadScene {sceneId, viewAs}`. Players get their own rows as usual.
 */
export const DM_WINDOW_VIEW_AS = "view-as";
export const DM_WINDOWS = [DM_WINDOW_ACTIVE_SCENE, DM_WINDOW_VIEW_AS] as const;
export type DmWindow = (typeof DM_WINDOWS)[number];

/** WS intent, DM only, read-only; answered by the hub in frame order (not a command). */
export const SYNC_LOAD_SCENE = "sync.loadScene";

/**
 * `viewAs` absent: the scene's `active-scene` rows. `viewAs` = a player of the campaign: that
 * player's `view-as` rows of the scene only (FR-FOG-43); another campaign's → `not_found`.
 */
export const LoadScenePayload = z.object({
  sceneId: z.string().min(1).max(64),
  viewAs: z.string().min(1).max(64).optional(),
});
export type LoadScenePayload = z.infer<typeof LoadScenePayload>;

/** `ack.result`: every flagged type's rows of that scene, filtered as in a snapshot. */
export const LoadSceneResult = z.object({ records: z.record(z.string(), z.array(z.unknown())) });
export type LoadSceneResult = z.infer<typeof LoadSceneResult>;

/** scenes-map's `scene` record type; the snapshot's window is its `active` row. */
const SCENE_RECORD_TYPE = "scene";

/** The active scene of a store (the scene a fresh DM snapshot is windowed to), or null. */
export function activeSceneIn(store: RecordStore): string | null {
  for (const r of Object.values(store.records[SCENE_RECORD_TYPE] ?? {})) {
    const s = r as { id?: unknown; active?: unknown };
    if (s.active === true && typeof s.id === "string") return s.id;
  }
  return null;
}

/**
 * Applies a load result: upserts every row by id. Equal to replacing the scene's rows: the
 * hub answers in frame order, so every change committed before the read already reached the
 * store as an event (a row the store holds for that scene is the DB's, or a delete removed it).
 */
export function mergeRecords(s: RecordStore, loaded: LoadSceneResult["records"]): RecordStore {
  const records: RecordMap = { ...s.records };
  for (const [type, list] of Object.entries(loaded)) {
    const byId = { ...(records[type] ?? {}) };
    for (const r of list) {
      const id = (r as { id?: unknown }).id;
      if (typeof id === "string") byId[id] = r;
    }
    records[type] = byId;
  }
  return { ...s, records };
}

/** The DM client's loaded-scene set; reset to the active scene by every snapshot. */
export interface SceneWindowState {
  loaded: readonly string[];
  loading: readonly string[];
}

export const sceneWindowAfterSnapshot = (store: RecordStore): SceneWindowState => {
  const active = activeSceneIn(store);
  return { loaded: active === null ? [] : [active], loading: [] };
};

/** One `(sceneId, playerId)` pair (FR-FOG-43). */
export interface ViewAsPair {
  sceneId: string;
  playerId: string;
}

/**
 * The DM client's View-as state (FR-FOG-43): at most one loaded pair and one load in flight;
 * `types` = the `view-as` types of the last load ack (the rows a new pair replaces). Reset by
 * every snapshot (the client reloads if View as is still on).
 */
export interface ViewAsState {
  loaded: ViewAsPair | null;
  loading: ViewAsPair | null;
  types: readonly string[];
}

export const viewAsAfterSnapshot = (): ViewAsState => ({ loaded: null, loading: null, types: [] });

export const samePair = (a: ViewAsPair | null, b: ViewAsPair | null): boolean =>
  a !== null && b !== null && a.sceneId === b.sceneId && a.playerId === b.playerId;

/** Drops every row of `types` (the previous pair's view-as rows). */
export function dropTypes(s: RecordStore, types: readonly string[]): RecordStore {
  if (types.length === 0) return s;
  const records: RecordMap = { ...s.records };
  for (const t of types) records[t] = {};
  return { ...s, records };
}
