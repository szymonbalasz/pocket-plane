// FR-MAP-116: where a drag over the Scenes list lands. Pure: the rows on screen (minus the dragged
// entry and everything below it) in content coordinates, the pointer's y, and which parents fit.
import type { SceneTreeNode } from "@shared/scenes-map/list-tree";
import type { ListEntryKind } from "@shared/scenes-map/schemas";

/** A row on screen; `open` = a folder showing its contents. */
export interface FlatRow {
  kind: ListEntryKind;
  id: string;
  parentId: string | null;
  depth: number;
  open: boolean;
}

export interface RowBox extends FlatRow {
  top: number;
  bottom: number;
}

export interface Drop {
  parentId: string | null;
  beforeId: string | null;
  /** The folder a drop goes into, highlighted; null = the line marks the spot. */
  into: string | null;
  /** The line's y and indent level (unused while `into`). */
  y: number;
  depth: number;
}

/** The share of a folder row, at each end, that means "beside" rather than "into". */
const FOLDER_EDGE = 0.25;

/** The rows on screen: a closed folder's contents aren't. */
export function flatRows<F extends { id: string }, S extends { id: string; kind: ListEntryKind }>(
  tree: readonly SceneTreeNode<F, S>[],
  isClosed: (folderId: string) => boolean,
  parentId: string | null = null,
  depth = 0,
): FlatRow[] {
  return tree.flatMap((n): FlatRow[] => {
    const { folder, children, item } = n;
    if (!folder) {
      const { kind, id } = item as S;
      return [{ kind, id, parentId, depth, open: false }];
    }
    const open = !isClosed(folder.id);
    const row: FlatRow = { kind: "folder", id: folder.id, parentId, depth, open };
    return open ? [row, ...flatRows(children ?? [], isClosed, folder.id, depth + 1)] : [row];
  });
}

/** The spot just after `boxes[i]` at its level: its next sibling, skipping what sits below it. */
function nextSibling(boxes: readonly RowBox[], i: number): string | null {
  const depth = boxes[i]?.depth ?? 0;
  for (const b of boxes.slice(i + 1)) {
    if (b.depth < depth) return null;
    if (b.depth === depth) return b.id;
  }
  return null;
}

/** Null = no valid spot here (the parent can't take the entry). */
export function dropAt(
  boxes: readonly RowBox[],
  y: number,
  fits: (parentId: string | null) => boolean,
): Drop | null {
  const last = boxes.at(-1);
  if (!last)
    return fits(null) ? { parentId: null, beforeId: null, into: null, y: 0, depth: 0 } : null;
  const i = boxes.findIndex((b) => y <= b.bottom);
  // Past the last row: the end of the root.
  if (i < 0) {
    return fits(null)
      ? { parentId: null, beforeId: null, into: null, y: last.bottom, depth: 0 }
      : null;
  }
  const b = boxes[i] as RowBox;
  const height = Math.max(1, b.bottom - b.top);
  const frac = (y - b.top) / height;
  // Only a folder that can take the entry has a middle; anything else splits in two.
  const edge = b.kind === "folder" && fits(b.id) ? FOLDER_EDGE : 0.5;
  let drop: Drop;
  if (frac < edge) {
    drop = { parentId: b.parentId, beforeId: b.id, into: null, y: b.top, depth: b.depth };
  } else if (frac >= 1 - edge) {
    drop = b.open
      ? {
          // Just below an open folder's own row: first inside it.
          parentId: b.id,
          beforeId: boxes[i + 1]?.parentId === b.id ? (boxes[i + 1]?.id ?? null) : null,
          into: null,
          y: b.bottom,
          depth: b.depth + 1,
        }
      : {
          parentId: b.parentId,
          beforeId: nextSibling(boxes, i),
          into: null,
          y: b.bottom,
          depth: b.depth,
        };
  } else {
    drop = { parentId: b.id, beforeId: null, into: b.id, y: b.top, depth: b.depth };
  }
  return fits(drop.parentId) ? drop : null;
}
