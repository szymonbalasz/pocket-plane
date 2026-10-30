// The DM's editing state on an overview (FR-OVW-16–21), generic over kind. Client memory only, never
// sent. The canvas publishes what the Select tool hits (as the props layer does); a gesture's preview
// is what the canvas draws until the drop's ack, so nothing is optimistic (ADR-0021): the record
// moves when the server's frame arrives, which is before the ack. DOM-free for `bun test`.
import { create } from "zustand";
import type { Box } from "../scenes-map/camera";
import {
  emptySelection,
  type SelectionAction,
  type SelectionState,
  selectionReducer,
} from "../scenes-map/selection-logic";
import { type ItemHandle, movedBy, type OverviewView } from "./item-edit";
import type { OverviewItemView } from "./item-layout";

type Point = { x: number; y: number };

export type ItemGesture =
  /** A plain press on empty canvas or a locked item: a click clears or selects, a drag pans. */
  | { kind: "press"; itemId: string | null; screen: Point }
  /** A Ctrl- or Shift-press: a click toggles the item under it, a drag is a box. */
  | { kind: "box"; itemId: string | null; screen: Point; start: Point; at: Point }
  /** Every selected unlocked item, `dx, dy` units from its record. */
  | {
      kind: "move";
      anchorId: string;
      ids: readonly string[];
      screen: Point;
      start: Point;
      dx: number;
      dy: number;
      moved: boolean;
      sending: boolean;
    }
  | { kind: "resize"; itemId: string; handle: ItemHandle; from: Box; box: Box; sending: boolean };

/** What the DM's asset picker is open for: a placement, or an item's Image… (FR-OVW-22, -23, -32). */
export type ItemPick =
  | { kind: "place" }
  | { kind: "miniature"; text: string; ownerPlayerId: string | null }
  | { kind: "image"; itemId: string };

export interface OverviewEditorState {
  overviewId: string | null;
  items: readonly OverviewItemView[];
  /** `tokenIds` holds item IDs: the map's reducer, as FR-OVW-16 follows FR-MAP-31, -32. */
  selection: SelectionState;
  gesture: ItemGesture | null;
  /** A handle's cursor while hovering it. */
  cursor: string | null;
  menu: { itemId: string; at: Point } | null;
  picking: ItemPick | null;
  /** FR-OVW-32: the miniature whose Name dialog is open. */
  naming: string | null;
  /** FR-OVW-21: the items a confirm is open for. */
  confirmDelete: readonly string[] | null;
  /** FR-OVW-22: this overview's first image is on its way; the camera fits when it lands. */
  fitOnArrival: string | null;
  view: OverviewView;
  /** FR-OVW-30: grows when a label font has loaded; the selection outlines re-measure on it. */
  fontRev: number;
}

export const initialEditor: OverviewEditorState = {
  overviewId: null,
  items: [],
  selection: emptySelection,
  gesture: null,
  cursor: null,
  menu: null,
  picking: null,
  naming: null,
  confirmDelete: null,
  fitOnArrival: null,
  view: { x: 0, y: 0, scale: 1, w: 0, h: 0 },
  fontRev: 0,
};

export const useOverviewEditor = create<OverviewEditorState>(() => initialEditor);

export function dispatchItemSelection(a: SelectionAction): void {
  useOverviewEditor.setState((s) => {
    const selection = selectionReducer(s.selection, a);
    return selection === s.selection ? s : { selection };
  });
}

/** The canvas publishes the viewed overview's items. Another overview drops all of this. */
export function publishItems(overviewId: string, items: readonly OverviewItemView[]): void {
  const s = useOverviewEditor.getState();
  if (s.overviewId !== overviewId) {
    useOverviewEditor.setState({
      ...initialEditor,
      overviewId,
      items,
      view: s.view,
      fontRev: s.fontRev,
    });
    return;
  }
  const present = new Set(items.map((i) => i.id));
  useOverviewEditor.setState({
    items,
    selection: selectionReducer(s.selection, { type: "prune", present }),
    menu: s.menu && present.has(s.menu.itemId) ? s.menu : null,
  });
}

export const itemOf = (id: string | null | undefined): OverviewItemView | null =>
  useOverviewEditor.getState().items.find((i) => i.id === id) ?? null;

/** The selected items, in selection order. */
export function selectedItems(): OverviewItemView[] {
  const s = useOverviewEditor.getState();
  const out: OverviewItemView[] = [];
  for (const id of s.selection.tokenIds) {
    const item = s.items.find((i) => i.id === id);
    if (item) out.push(item);
  }
  return out;
}

/** The gesture that changes how items are drawn; others re-render nothing on the canvas. */
export const drawnGesture = (s: Pick<OverviewEditorState, "gesture">) =>
  s.gesture?.kind === "move" || s.gesture?.kind === "resize" ? s.gesture : null;

export type ItemPreview = Partial<Pick<OverviewItemView, "x" | "y" | "w" | "h">>;

/** Where a gesture draws this item; undefined if it doesn't touch it. */
export function previewOf(
  g: ReturnType<typeof drawnGesture>,
  item: OverviewItemView,
): ItemPreview | undefined {
  if (g?.kind === "move") return g.ids.includes(item.id) ? movedBy(item, g.dx, g.dy) : undefined;
  if (g?.kind === "resize" && g.itemId === item.id) return g.box;
  return undefined;
}
