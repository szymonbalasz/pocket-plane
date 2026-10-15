// Row ↔ record mapping for fog-of-war (FOG §8, §9). A `fog` record = the scene's `scene_fog` row
// + its undo stack's depth and latest entry (DM wire); wire `id` = `sceneId`.
import type { FogRecord, FogUndoInfo } from "@shared/fog-of-war/schemas";
import { asc, eq } from "drizzle-orm";
import { sceneFog, sceneFogEdit } from "../../db/schema";
import type { SceneRead } from "../scenes-map/visibility-hooks";

type FogRow = typeof sceneFog.$inferSelect;
type EditRow = Pick<typeof sceneFogEdit.$inferSelect, "id" | "sceneId" | "kind">;

export function toFogRecord(r: FogRow, undo: FogUndoInfo | null): FogRecord {
  return {
    id: r.sceneId,
    campaignId: r.campaignId,
    fill: r.fill,
    box: [r.col0, r.row0, r.cols, r.rows],
    runs: r.runs,
    undo,
  };
}

/** Undo info per scene from its entries in `seq` order (latest = last). */
function undoByScene(edits: readonly EditRow[]): Map<string, FogUndoInfo> {
  const out = new Map<string, FogUndoInfo>();
  for (const e of edits) {
    const n = (out.get(e.sceneId)?.n ?? 0) + 1;
    out.set(e.sceneId, { n, editId: e.id, kind: e.kind });
  }
  return out;
}

const editColumns = { id: sceneFogEdit.id, sceneId: sceneFogEdit.sceneId, kind: sceneFogEdit.kind };

/** The `fog` record of a scene, or null (no row = every cell clear, FR-FOG-01). */
export function readFogRecord(read: SceneRead, sceneId: string): FogRecord | null {
  const row = read.select().from(sceneFog).where(eq(sceneFog.sceneId, sceneId)).get();
  if (!row) return null;
  const edits = read
    .select(editColumns)
    .from(sceneFogEdit)
    .where(eq(sceneFogEdit.sceneId, sceneId))
    .orderBy(asc(sceneFogEdit.seq))
    .all();
  return toFogRecord(row, undoByScene(edits).get(sceneId) ?? null);
}

/** Every scene's `fog` record of a campaign (snapshot; ≤ 1 row + 20 entries per scene). */
export function campaignFogRecords(read: SceneRead, campaignId: string): FogRecord[] {
  const rows = read
    .select()
    .from(sceneFog)
    .where(eq(sceneFog.campaignId, campaignId))
    .orderBy(asc(sceneFog.sceneId))
    .all();
  if (rows.length === 0) return [];
  const undo = undoByScene(
    read
      .select(editColumns)
      .from(sceneFogEdit)
      .where(eq(sceneFogEdit.campaignId, campaignId))
      .orderBy(asc(sceneFogEdit.seq))
      .all(),
  );
  return rows.map((r) => toFogRecord(r, undo.get(r.sceneId) ?? null));
}
