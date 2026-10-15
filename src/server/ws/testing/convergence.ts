// Convergence and leak-scan helpers (FR-SYNC-20) that honour windowed record types
// (ADR-0029, CON-39): for a windowed type only pinned rows and rows at or above the window
// floor are compared; older rows a client still holds are real, just not resent. For the
// DM's `dmWindow` types (ADR-0041) only the active scene + the loaded scenes are compared.
import type { ServerFrame } from "@shared/protocol/frames";
import { LoadSceneResult } from "@shared/protocol/scene-window";
import type { RecordMap, RecordStore } from "@shared/protocol/store";
import { type WindowIds, windowProjection } from "@shared/protocol/window";
import type { Services } from "../../services";
import { Hub } from "../hub";
import type { SnapshotSource, Viewer } from "../records";

/** Viewer of a test client, from its snapshot's `you`. */
export function viewerOf(store: RecordStore): Viewer {
  if (!store.you) throw new Error("Client has no snapshot yet");
  return { connId: "test", ...store.you };
}

/** The hub's snapshot source (live presence); no hub → nobody online. */
export function sourceOf(s: Services): SnapshotSource {
  const presence = s.hub instanceof Hub ? s.hub.presenceView() : { list: () => [] };
  return { db: s.db, presence };
}

/** Pre-filter cut IDs per windowed type for this viewer (same floor for every viewer). */
export function windowIdsFor(s: Services, v: Viewer): WindowIds {
  return s.records.windowIds(sourceOf(s), v);
}

/**
 * ADR-0041 projection: for the DM, `dmWindow` types keep only rows of `scenes` (the active
 * scene + the loaded ones). Players: unchanged (the scene gate already limits them).
 */
export function sceneWindowProjection(
  s: Services,
  v: Viewer,
  records: RecordMap,
  scenes: ReadonlySet<string>,
): RecordMap {
  if (v.role !== "dm") return records;
  const out: RecordMap = { ...records };
  for (const def of s.records.dmWindowed()) {
    const byId = records[def.type];
    if (!byId) continue;
    const kept: Record<string, unknown> = {};
    for (const [id, r] of Object.entries(byId)) {
      const sceneId = def.sceneOf?.(r);
      if (sceneId !== undefined && scenes.has(sceneId)) kept[id] = r;
    }
    out[def.type] = kept;
  }
  return out;
}

/** A client as the helpers see it; the harness's `TestClient` fits. */
export interface ClientView {
  store: RecordStore;
  /** Scenes loaded with `sync.loadScene` since the last snapshot (ADR-0041). */
  loadedScenes?: readonly string[];
  /** Every frame received; the leak scan also reads `ack.records`. */
  frames?: readonly ServerFrame[];
}

/**
 * Both stores projected for FR-SYNC-20: `expect(c.live).toEqual(c.fresh)`.
 * `fresh` = a client that just took a snapshot, same viewer. DM `dmWindow` types compare on the
 * active scene + `loaded` (default: `live.loadedScenes`); `fresh` must load the same scenes.
 */
export function convergence(
  s: Services,
  live: ClientView,
  fresh: ClientView,
  loaded: readonly string[] = live.loadedScenes ?? [],
): { live: RecordMap; fresh: RecordMap } {
  const v = viewerOf(fresh.store);
  const ids = windowIdsFor(s, v);
  const scenes = new Set(loaded);
  const active = s.records.activeSceneOf(v.campaignId);
  if (active !== null) scenes.add(active);
  const project = (r: RecordMap) => sceneWindowProjection(s, v, windowProjection(r, ids), scenes);
  return { live: project(live.store.records), fresh: project(fresh.store.records) };
}

/**
 * Leak scan: every record a client holds must be one it may see now, exactly as the filter
 * renders it. Windowed types: the provider returns the whole log, so rows below the floor are
 * checked too (live changes reach them). Rows the provider doesn't return are left to
 * `convergence`. Also scans every `ack.records` the client received (`sync.loadScene`,
 * ADR-0041). Pair with a raw-frame scan for secrets (`client.raw()`).
 * Returns `type/id: problem` lines; `[]` = clean.
 */
export function leakScan(s: Services, client: ClientView): string[] {
  const v = viewerOf(client.store);
  const problems = scanRecords(s, v, client.store.records, "");
  for (const f of client.frames ?? []) {
    if (f.type !== "ack") continue;
    const loaded = LoadSceneResult.safeParse(f.result);
    if (!loaded.success) continue;
    const byType: RecordMap = {};
    for (const [type, list] of Object.entries(loaded.data.records)) {
      const byId: Record<string, unknown> = {};
      for (const r of list) byId[String((r as { id?: unknown }).id)] = r;
      byType[type] = byId;
    }
    problems.push(...scanRecords(s, v, byType, `ack ${f.intentId}: `, true));
  }
  return problems;
}

/**
 * `past`: records from an earlier frame (an ack), so values may be stale by now; only
 * visibility and fields beyond the filtered record count as leaks.
 */
function scanRecords(
  s: Services,
  v: Viewer,
  records: RecordMap,
  prefix: string,
  past = false,
): string[] {
  const src = sourceOf(s);
  const problems: string[] = [];
  for (const [type, byId] of Object.entries(records)) {
    const def = s.records.get(type);
    if (!def) {
      if (Object.keys(byId).length > 0) problems.push(`${prefix}${type}: unregistered type held`);
      continue;
    }
    if (def.audience === "dm" && v.role !== "dm") {
      if (Object.keys(byId).length > 0) problems.push(`${prefix}${type}: dm-only type held`);
      continue;
    }
    const rows = new Map(def.snapshot(src, v).map((r) => [def.idOf(r), r] as const));
    for (const [id, held] of Object.entries(byId)) {
      const row = rows.get(id);
      if (row === undefined) continue;
      const seen = s.records.view(type, row, v);
      if (seen.vis === "hidden") problems.push(`${prefix}${type}/${id}: hidden from this viewer`);
      else if (past) {
        const allowed = new Set(Object.keys(JSON.parse(JSON.stringify(seen.data)) as object));
        const extra = Object.keys(held as object).filter((k) => !allowed.has(k));
        if (extra.length > 0)
          problems.push(`${prefix}${type}/${id}: extra fields ${extra.join(", ")}`);
      } else if (!Bun.deepEquals(JSON.parse(JSON.stringify(seen.data)), held)) {
        problems.push(`${prefix}${type}/${id}: differs from the filtered record`);
      }
    }
  }
  return problems;
}
