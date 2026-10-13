// DM selection + targeting API (FR-MAP-31–33; protocol §26). Client memory only: never persisted
// or sent; a reload clears it. Features (combat's attack popup, FR-CBT-33) read and edit the
// selection and switch targeting on while they pick targets.
import {
  emptySelection,
  type SelectionAction,
  type SelectionState,
  selectionReducer,
} from "@ui/features/scenes-map/selection-logic";
import { type MapTool, useMapTool } from "@ui/features/scenes-map/tool-store";
import { create } from "zustand";

interface State {
  selection: SelectionState;
  targeting: boolean;
  /** Tool to restore when targeting ends. */
  toolBefore: MapTool | null;
}

const useSelectionStore = create<State>(() => ({
  selection: emptySelection,
  targeting: false,
  toolBefore: null,
}));

/** scenes-map internal: apply a selection action (canvas gestures, scene change, pruning). */
export function dispatchSelection(a: SelectionAction): void {
  useSelectionStore.setState((s) => {
    const next = selectionReducer(s.selection, a);
    return next === s.selection ? s : { selection: next };
  });
}

/** `{sceneId, tokenIds}`: the viewed scene and its selected token ids, in selection order. */
export function useMapSelection(): SelectionState {
  return useSelectionStore((s) => s.selection);
}

/** Non-hook read (event handlers). */
export const getMapSelection = (): SelectionState => useSelectionStore.getState().selection;

/** Replace the selection (ids on the viewed scene; others drop out on the next prune). */
export function setMapSelection(ids: readonly string[]): void {
  dispatchSelection({ type: "set", ids });
}

export function toggleMapSelection(id: string): void {
  dispatchSelection({ type: "toggle", id });
}

/**
 * FR-MAP-33: while on, the tool is forced to Select (restored when off), the canvas shows a
 * crosshair and token drag is off; click, Ctrl/Shift-click and box still edit the selection.
 */
export function setTargeting(on: boolean): void {
  const s = useSelectionStore.getState();
  if (s.targeting === on) return;
  const tools = useMapTool.getState();
  if (on) {
    useSelectionStore.setState({ targeting: true, toolBefore: tools.tool });
    tools.setTool("select");
  } else {
    useSelectionStore.setState({ targeting: false, toolBefore: null });
    if (s.toolBefore) tools.setTool(s.toolBefore);
  }
}

export function useTargeting(): boolean {
  return useSelectionStore((s) => s.targeting);
}
