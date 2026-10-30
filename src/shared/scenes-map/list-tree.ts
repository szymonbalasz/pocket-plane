// The Scenes list as a tree (FR-MAP-02, FR-MAP-116): folders nest, and each level holds folders,
// scenes and overviews in one order. Pure; the server's move command and the DM client share it.
import { byNameThenSeq } from "./geometry";

/** FR-MAP-02: a root folder is level 1. */
export const FOLDER_DEPTH_MAX = 5;

export interface TreeFolder {
  id: string;
  name: string;
  seq: number;
  parentId?: string | null;
  position?: number;
}

export interface TreeItem {
  name: string;
  seq: number;
  folderId: string | null;
  position?: number;
}

/**
 * FR-MAP-116 order within a level: `position`, then folders before scenes, then name
 * (case-insensitive), tiebreak `seq`. A level never arranged has every position 0, so it reads
 * folders first, each by name (FR-MAP-02).
 */
export function listOrder(
  a: { position?: number; isFolder: boolean; name: string; seq: number },
  b: { position?: number; isFolder: boolean; name: string; seq: number },
): number {
  return (
    (a.position ?? 0) - (b.position ?? 0) ||
    Number(b.isFolder) - Number(a.isFolder) ||
    byNameThenSeq(a, b)
  );
}

export type SceneTreeNode<F, S> =
  | { folder: F; children: SceneTreeNode<F, S>[]; item?: undefined }
  | { item: S; folder?: undefined; children?: undefined };

/** A folder or item whose parent is unknown sits at the root. */
export function sceneTree<F extends TreeFolder, S extends TreeItem>(
  folders: readonly F[],
  items: readonly S[],
): SceneTreeNode<F, S>[] {
  const known = new Set(folders.map((f) => f.id));
  const level = (parent: string | null | undefined) =>
    parent && known.has(parent) ? parent : null;
  const sorted = [
    ...folders.map((f) => ({ ...sortKey(f, true), parent: level(f.parentId), folder: f })),
    ...items.map((i) => ({ ...sortKey(i, false), parent: level(i.folderId), item: i })),
  ].sort(listOrder);
  const build = (parent: string | null): SceneTreeNode<F, S>[] =>
    sorted
      .filter((e) => e.parent === parent)
      .map((e) =>
        "folder" in e && e.folder
          ? { folder: e.folder, children: build(e.folder.id) }
          : { item: (e as { item: S }).item },
      );
  return build(null);
}

const sortKey = (e: { name: string; seq: number; position?: number }, isFolder: boolean) => ({
  name: e.name,
  seq: e.seq,
  position: e.position,
  isFolder,
});

/** Flattened list order (FR-MAP-08 default: the first scene). */
export function sceneOrder<F extends TreeFolder, S extends TreeItem>(
  folders: readonly F[],
  items: readonly S[],
): S[] {
  const walk = (nodes: readonly SceneTreeNode<F, S>[]): S[] =>
    nodes.flatMap((n) => (n.item ? [n.item] : walk(n.children ?? [])));
  return walk(sceneTree(folders, items));
}

/** 1 for a root folder; 0 for the root itself. */
export function folderDepth(folders: readonly TreeFolder[], id: string | null): number {
  const byId = new Map(folders.map((f) => [f.id, f]));
  let depth = 0;
  let at = id ? byId.get(id) : undefined;
  while (at && depth <= folders.length) {
    depth++;
    at = at.parentId ? byId.get(at.parentId) : undefined;
  }
  return depth;
}

/** The folder and every folder below it. */
export function folderSubtree(folders: readonly TreeFolder[], id: string): Set<string> {
  const out = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const f of folders) {
      if (f.parentId && out.has(f.parentId) && !out.has(f.id)) {
        out.add(f.id);
        grew = true;
      }
    }
  }
  return out;
}

/** Levels the folder's subtree spans: 1 for a folder with no subfolders. */
function folderHeight(folders: readonly TreeFolder[], id: string): number {
  const base = folderDepth(folders, id);
  return (
    Math.max(...[...folderSubtree(folders, id)].map((f) => folderDepth(folders, f))) - base + 1
  );
}

/** A new folder fits under `parentId` (FR-MAP-02). */
export const canNestIn = (folders: readonly TreeFolder[], parentId: string | null): boolean =>
  folderDepth(folders, parentId) < FOLDER_DEPTH_MAX;

/** FR-MAP-02: never into itself or a descendant, and the subtree still fits the depth cap. */
export function canMoveFolder(
  folders: readonly TreeFolder[],
  id: string,
  parentId: string | null,
): boolean {
  if (parentId !== null && folderSubtree(folders, id).has(parentId)) return false;
  return folderDepth(folders, parentId) + folderHeight(folders, id) <= FOLDER_DEPTH_MAX;
}

/**
 * FR-MAP-116 Move up / down: `beforeId` for one step within the level's `siblings` (ids in list
 * order); null step = already at that end.
 */
export function moveSteps(
  siblings: readonly string[],
  id: string,
): { up: { beforeId: string } | null; down: { beforeId: string | null } | null } {
  const i = siblings.indexOf(id);
  const prev = i > 0 ? siblings[i - 1] : undefined;
  return {
    up: prev === undefined ? null : { beforeId: prev },
    down: i < 0 || i === siblings.length - 1 ? null : { beforeId: siblings[i + 2] ?? null },
  };
}
