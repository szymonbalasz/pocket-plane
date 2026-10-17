// Row ↔ record mapping for fog-of-war (FOG §8, §9). A `fog` record = the scene's `scene_fog` row
// (base mask, shapes, darkness, Explored setting) + its undo stack's depth and latest entry; wire
// `id` = `sceneId`. The server record keeps each darkness shape's `seenBy` (FR-FOG-44) for the
// player filter; `dmRedact` strips it. `rev` and `visionStale` stay server-side.
// `fog-explored` = one `fog_explored` row, wire id `sceneId:playerId` (FR-FOG-37).
import {
  type FogExploredRecord,
  type FogRecord,
  type FogUndoInfo,
  scenePlayerId,
  type VisionRecord,
} from "@shared/fog-of-war/schemas";
import type { DarknessRow } from "@shared/fog-of-war/shapes";
import type { PlayerVision } from "@shared/fog-of-war/vision";
import { and, asc, eq } from "drizzle-orm";
import { fogExplored, sceneFog, sceneFogEdit } from "../../db/schema";
import type { SceneRead } from "../scenes-map/visibility-hooks";

type FogRow = typeof sceneFog.$inferSelect;
type EditRow = Pick<typeof sceneFogEdit.$inferSelect, "id" | "sceneId" | "kind" | "undoneAt">;
type ExploredRow = typeof fogExplored.$inferSelect;

/** The server's `fog` record: darkness shapes keep their server-only `seenBy`. */
export type ServerFogRecord = Omit<FogRecord, "darkness"> & { darkness: DarknessRow[] };

/** A scene's undo / redo info (FR-FOG-07 / -56). */
interface StackInfo {
  undo: FogUndoInfo | null;
  redo?: FogUndoInfo;
}

export function toFogRecord(r: FogRow, stack: StackInfo = { undo: null }): ServerFogRecord {
  return {
    id: r.sceneId,
    campaignId: r.campaignId,
    fill: r.fill,
    box: [r.col0, r.row0, r.cols, r.rows],
    runs: r.runs,
    shapes: r.shapes,
    darkness: r.darkness,
    explored: r.explored,
    undo: stack.undo,
    ...(stack.redo ? { redo: stack.redo } : {}),
  };
}

/** A darkness shape as any wire carries it: never `seenBy` (FR-FOG-44). */
export function wireDarkness({
  seenBy: _seenBy,
  ...d
}: DarknessRow): FogRecord["darkness"][number] {
  return d as FogRecord["darkness"][number];
}

/** FOG §9 DM wire: the record without darkness `seenBy`. */
export function dmFogRecord(r: ServerFogRecord): FogRecord {
  return { ...r, darkness: r.darkness.map(wireDarkness) };
}

/**
 * Undo / redo info per scene from its entries in `seq` order: undo = the latest entry not undone
 * and the stack depth; redo (FR-FOG-56) = the first undone entry (the most recently undone) and
 * the redo depth (undone entries always follow the others in `seq` order).
 */
function undoByScene(edits: readonly EditRow[]): Map<string, StackInfo> {
  const out = new Map<string, StackInfo>();
  for (const e of edits) {
    const cur = out.get(e.sceneId) ?? { undo: null };
    if (e.undoneAt === null) {
      cur.undo = { n: (cur.undo?.n ?? 0) + 1, editId: e.id, kind: e.kind };
    } else if (cur.redo) cur.redo = { ...cur.redo, n: cur.redo.n + 1 };
    else cur.redo = { n: 1, editId: e.id, kind: e.kind };
    out.set(e.sceneId, cur);
  }
  return out;
}

const editColumns = {
  id: sceneFogEdit.id,
  sceneId: sceneFogEdit.sceneId,
  kind: sceneFogEdit.kind,
  undoneAt: sceneFogEdit.undoneAt,
};

/** The `fog` record of a scene, or null (no row = every cell clear, FR-FOG-01). */
export function readFogRecord(read: SceneRead, sceneId: string): ServerFogRecord | null {
  const row = read.select().from(sceneFog).where(eq(sceneFog.sceneId, sceneId)).get();
  if (!row) return null;
  const edits = read
    .select(editColumns)
    .from(sceneFogEdit)
    .where(eq(sceneFogEdit.sceneId, sceneId))
    .orderBy(asc(sceneFogEdit.seq))
    .all();
  return toFogRecord(row, undoByScene(edits).get(sceneId));
}

/** Every scene's `fog` record of a campaign (snapshot; ≤ 1 row + 20 entries per scene). */
export function campaignFogRecords(read: SceneRead, campaignId: string): ServerFogRecord[] {
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
  return rows.map((r) => toFogRecord(r, undo.get(r.sceneId)));
}

export function toExploredRecord(r: ExploredRow): FogExploredRecord {
  return {
    id: scenePlayerId(r.sceneId, r.playerId),
    sceneId: r.sceneId,
    playerId: r.playerId,
    box: [r.col0, r.row0, r.cols, r.rows],
    runs: r.runs,
  };
}

/** Server rows carry `campaignId` for the scope gate; the wire record doesn't. */
export type ServerExploredRecord = FogExploredRecord & { campaignId: string };

const serverExplored = (r: ExploredRow): ServerExploredRecord => ({
  ...toExploredRecord(r),
  campaignId: r.campaignId,
});

/** Every `fog-explored` row of a scene (scene delete lists them, FR-FOG-23). */
export function sceneExploredRecords(read: SceneRead, sceneId: string): ServerExploredRecord[] {
  return read
    .select()
    .from(fogExplored)
    .where(eq(fogExplored.sceneId, sceneId))
    .orderBy(asc(fogExplored.playerId))
    .all()
    .map(serverExplored);
}

/** Every `fog-explored` row of a campaign (snapshot provider; the scene gate filters). */
export function campaignExploredRecords(
  read: SceneRead,
  campaignId: string,
): ServerExploredRecord[] {
  return read
    .select()
    .from(fogExplored)
    .where(eq(fogExplored.campaignId, campaignId))
    .orderBy(asc(fogExplored.sceneId), asc(fogExplored.playerId))
    .all()
    .map(serverExplored);
}

/** One player's `fog-explored` row on a scene, or null. */
export function readExploredRecord(
  read: SceneRead,
  sceneId: string,
  playerId: string,
): ServerExploredRecord | null {
  const r = read
    .select()
    .from(fogExplored)
    .where(and(eq(fogExplored.sceneId, sceneId), eq(fogExplored.playerId, playerId)))
    .get();
  return r ? serverExplored(r) : null;
}

/**
 * Server `vision` rows carry `campaignId` for the scope gate (FR-FOG-39) and the server-only
 * `shared` flag (party vision on at compute time: other players get it redacted, FR-FOG-51).
 */
export type ServerVisionRecord = VisionRecord & { campaignId: string; shared: boolean };

/** FR-FOG-39: the derived `vision` record of one player's sight (`inv` omitted when empty). */
export function toVisionRecord(
  scene: { sceneId: string; campaignId: string },
  playerId: string,
  v: PlayerVision,
  shared: boolean,
): ServerVisionRecord {
  return {
    id: scenePlayerId(scene.sceneId, playerId),
    sceneId: scene.sceneId,
    playerId,
    campaignId: scene.campaignId,
    shared,
    blind: v.blind,
    see: v.see,
    dark: v.dark,
    ...(v.inv.length > 0 ? { inv: v.inv } : {}),
    src: v.src,
  };
}
