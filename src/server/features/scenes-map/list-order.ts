// The Scenes list's order on the server (FR-MAP-116): the entries of one level across the scene,
// overview and folder tables, and writing a level back. Positions are dense from 1 once a level is
// arranged; a level never arranged stays at 0 and reads by name.
import { listOrder } from "@shared/scenes-map/list-tree";
import type { ListEntryKind } from "@shared/scenes-map/schemas";
import { and, eq, isNull } from "drizzle-orm";
import type { CommandEnv } from "../../commands/commands";
import type { Tx } from "../../db/client";
import { overview, scene, sceneFolder } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { overviewChange, readOverview } from "../overview-scenes/rows";
import { folderChange, readFolder, readScene, sceneChange } from "./rows";

export interface ListEntry {
  kind: ListEntryKind;
  id: string;
  parentId: string | null;
  position: number;
  isFolder: boolean;
  name: string;
  seq: number;
}

/** The entries directly in `parentId` (null = root), in list order. */
export function entriesIn(tx: Tx, cid: string, parentId: string | null): ListEntry[] {
  const folders = tx
    .select()
    .from(sceneFolder)
    .where(
      and(
        eq(sceneFolder.campaignId, cid),
        parentId === null ? isNull(sceneFolder.parentId) : eq(sceneFolder.parentId, parentId),
      ),
    )
    .all();
  const scenes = tx
    .select()
    .from(scene)
    .where(
      and(
        eq(scene.campaignId, cid),
        parentId === null ? isNull(scene.folderId) : eq(scene.folderId, parentId),
      ),
    )
    .all();
  const overviews = tx
    .select()
    .from(overview)
    .where(
      and(
        eq(overview.campaignId, cid),
        parentId === null ? isNull(overview.folderId) : eq(overview.folderId, parentId),
      ),
    )
    .all();
  const entry = (kind: ListEntryKind, parent: string | null, r: (typeof folders)[number]) => ({
    kind,
    id: r.id,
    parentId: parent,
    position: r.position,
    isFolder: kind === "folder",
    name: r.name,
    seq: r.seq,
  });
  return [
    ...folders.map((f) => entry("folder", f.parentId, f)),
    ...scenes.map((s) => entry("scene", s.folderId, { ...s, parentId: s.folderId })),
    ...overviews.map((o) => entry("overview", o.folderId, { ...o, parentId: o.folderId })),
  ].sort(listOrder);
}

/**
 * Position of an entry joining `parentId`: last in an arranged level; 0 in a level never arranged,
 * where it stays in name order.
 */
export function nextPosition(tx: Tx, cid: string, parentId: string | null): number {
  const top = Math.max(0, ...entriesIn(tx, cid, parentId).map((e) => e.position));
  return top === 0 ? 0 : top + 1;
}

/**
 * Writes `entries` as the level `parentId`, in that order (`numbered`) or keeping positions.
 * Only rows that change are written and returned.
 */
export function placeEntries(
  { tx, ctx }: Pick<CommandEnv, "tx" | "ctx">,
  entries: readonly ListEntry[],
  parentId: string | null,
  numbered: boolean,
): RecordChange[] {
  const updatedAt = ctx.clock.iso();
  return entries.flatMap((e, i) => {
    const position = numbered ? i + 1 : e.position;
    if (position === e.position && parentId === e.parentId) return [];
    if (e.kind === "scene") {
      const before = readScene(tx, e.id);
      tx.update(scene)
        .set({ folderId: parentId, position, updatedAt })
        .where(eq(scene.id, e.id))
        .run();
      return [sceneChange(before, readScene(tx, e.id))];
    }
    if (e.kind === "overview") {
      const before = readOverview(tx, e.id);
      tx.update(overview)
        .set({ folderId: parentId, position, updatedAt })
        .where(eq(overview.id, e.id))
        .run();
      return [overviewChange(before, readOverview(tx, e.id))];
    }
    const before = readFolder(tx, e.id);
    tx.update(sceneFolder)
      .set({ parentId, position, updatedAt })
      .where(eq(sceneFolder.id, e.id))
      .run();
    return [folderChange(before, readFolder(tx, e.id))];
  });
}
