// Convergence and leak-scan helpers (FR-SYNC-20) that honour windowed record types
// (ADR-0029, CON-39): for a windowed type only pinned rows and rows at or above the window
// floor are compared; older rows a client still holds are real, just not resent.
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
 * Both stores projected for FR-SYNC-20: `expect(c.live).toEqual(c.fresh)`.
 * `fresh` = a client that just took a snapshot, same viewer.
 */
export function convergence(
  s: Services,
  live: { store: RecordStore },
  fresh: { store: RecordStore },
): { live: RecordMap; fresh: RecordMap } {
  const ids = windowIdsFor(s, viewerOf(fresh.store));
  return {
    live: windowProjection(live.store.records, ids),
    fresh: windowProjection(fresh.store.records, ids),
  };
}

/**
 * Leak scan: every record a client holds must be one it may see now, exactly as the filter
 * renders it. Windowed types: the provider returns the whole log, so rows below the floor are
 * checked too (live changes reach them). Rows the provider doesn't return are left to
 * `convergence`. Pair with a raw-frame scan for secrets (`client.raw()`).
 * Returns `type/id: problem` lines; `[]` = clean.
 */
export function leakScan(s: Services, client: { store: RecordStore }): string[] {
  const v = viewerOf(client.store);
  const src = sourceOf(s);
  const problems: string[] = [];
  for (const [type, byId] of Object.entries(client.store.records)) {
    const def = s.records.get(type);
    if (!def) {
      if (Object.keys(byId).length > 0) problems.push(`${type}: unregistered type held`);
      continue;
    }
    if (def.audience === "dm" && v.role !== "dm") {
      if (Object.keys(byId).length > 0) problems.push(`${type}: dm-only type held`);
      continue;
    }
    const rows = new Map(def.snapshot(src, v).map((r) => [def.idOf(r), r] as const));
    for (const [id, held] of Object.entries(byId)) {
      const row = rows.get(id);
      if (row === undefined) continue;
      const seen = s.records.view(type, row, v);
      if (seen.vis === "hidden") problems.push(`${type}/${id}: hidden from this viewer`);
      else if (!Bun.deepEquals(JSON.parse(JSON.stringify(seen.data)), held)) {
        problems.push(`${type}/${id}: differs from the filtered record`);
      }
    }
  }
  return problems;
}
