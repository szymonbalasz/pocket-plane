// Props tool state and pointer rules (DM, FR-SCN-16–18): the chosen image, the selected prop, a
// move or resize gesture, the prop menu and the asset-picker request. The props layer publishes the
// shown scene's props here (what the tool hits); the tool sends intents and records undo entries
// (FR-SCN-15) on ack. No feature logic: the server decides (locked, caps, overlap). DOM-free.
import {
  backZ,
  frontZ,
  nextRotation,
  type PropBox,
  type PropHandle,
  propAt,
  resizeFromHandle,
} from "@shared/scene-tools/props";
import { SCN_INTENTS, type ScenePropRecord } from "@shared/scene-tools/schemas";
import { create } from "zustand";
import type { ToolCancelReason, ToolGrid, ToolPointer } from "../scenes-map/tools";
import { type PropFieldsBefore, prevFields, recordUndo, type Send } from "./prop-undo";

/** The Props tool's registry id (`canvas-tools.ts`); rail button `map-tool-props`. */
export const PROPS_TOOL_ID = "props";

export type PropGesture =
  | {
      kind: "move";
      propId: string;
      start: { col: number; row: number };
      from: PropBox;
      box: PropBox;
    }
  | { kind: "resize"; propId: string; handle: PropHandle; from: PropBox; box: PropBox };

/** What the DM's asset picker is open for: the next placement, or a prop's image (menu "Image…"). */
export type PickTarget = { kind: "place" } | { kind: "image"; propId: string };

export interface PropToolState {
  /** The shown scene and its props as drawn (DM: every one; DM-only items off → no hidden). */
  sceneId: string | null;
  props: readonly ScenePropRecord[];
  /** FR-SCN-16: the image the next click places. */
  imageId: string | null;
  selectedId: string | null;
  gesture: PropGesture | null;
  menu: { propId: string; at: { x: number; y: number } } | null;
  picking: PickTarget | null;
}

const initial: PropToolState = {
  sceneId: null,
  props: [],
  imageId: null,
  selectedId: null,
  gesture: null,
  menu: null,
  picking: null,
};

export const usePropTool = create<PropToolState>(() => initial);

/** The props layer publishes the shown scene's props; a scene switch drops selection and menu. */
export function publishProps(sceneId: string | null, props: readonly ScenePropRecord[]): void {
  const s = usePropTool.getState();
  if (s.sceneId !== sceneId) {
    usePropTool.setState({ sceneId, props, selectedId: null, gesture: null, menu: null });
    return;
  }
  const keep = (id: string | null) => (id && props.some((p) => p.id === id) ? id : null);
  usePropTool.setState({
    props,
    selectedId: keep(s.selectedId),
    gesture: s.gesture && keep(s.gesture.propId) ? s.gesture : null,
    menu: s.menu && keep(s.menu.propId) ? s.menu : null,
  });
}

export const propById = (id: string | null | undefined): ScenePropRecord | null =>
  usePropTool.getState().props.find((p) => p.id === id) ?? null;

/** The box a prop is drawn at: its gesture box while one is in progress. */
export function shownBox(p: ScenePropRecord, g: PropGesture | null): PropBox {
  return g && g.propId === p.id ? g.box : { col: p.col, row: p.row, w: p.w, h: p.h };
}

const sameBox = (a: PropBox, b: PropBox) =>
  a.col === b.col && a.row === b.row && a.w === b.w && a.h === b.h;

/** Handle grab radius, in cells, around a selected prop's corner (FR-SCN-17). */
export const HANDLE_REACH = 0.3;

/** The corner handle of `box` under map point `(x, y)`, if any. */
export function handleAt(box: PropBox, g: ToolGrid, x: number, y: number): PropHandle | null {
  const cs = g.gridCellSize;
  const left = g.gridOffsetX + box.col * cs;
  const top = g.gridOffsetY + box.row * cs;
  const corners: [PropHandle, number, number][] = [
    ["nw", left, top],
    ["ne", left + box.w * cs, top],
    ["sw", left, top + box.h * cs],
    ["se", left + box.w * cs, top + box.h * cs],
  ];
  const reach = HANDLE_REACH * cs;
  for (const [h, cx, cy] of corners) {
    if (Math.abs(x - cx) <= reach && Math.abs(y - cy) <= reach) return h;
  }
  return null;
}

// ---------- actions (each records its undo entry on ack, FR-SCN-15) ----------

export async function placePropAt(
  send: Send,
  sceneId: string,
  assetId: string,
  cell: { col: number; row: number },
): Promise<string> {
  const r = (await send(SCN_INTENTS.placeProp, { sceneId, assetId, ...cell })) as {
    propId: string;
  };
  recordUndo(sceneId, { op: "place", propId: r.propId });
  return r.propId;
}

/** `scn.updateProp` with only the fields that change; nothing changes → nothing sent. */
export async function updatePropFields(
  send: Send,
  p: ScenePropRecord,
  change: PropFieldsBefore,
): Promise<void> {
  const prev = prevFields(p, change);
  if (!prev) return;
  const input: Record<string, unknown> = { propId: p.id };
  for (const k of Object.keys(prev)) input[k] = change[k as keyof PropFieldsBefore];
  await send(SCN_INTENTS.updateProp, input);
  recordUndo(p.sceneId, { op: "update", propId: p.id, prev });
}

export async function setHidden(send: Send, p: ScenePropRecord, hidden: boolean): Promise<void> {
  if (p.hidden === hidden) return;
  await send(SCN_INTENTS.setPropHidden, { propId: p.id, hidden });
  recordUndo(p.sceneId, { op: "hidden", propId: p.id, prev: p.hidden });
}

export async function duplicate(send: Send, p: ScenePropRecord): Promise<string> {
  const r = (await send(SCN_INTENTS.duplicateProp, { propId: p.id })) as { propId: string };
  recordUndo(p.sceneId, { op: "place", propId: r.propId });
  return r.propId;
}

export async function remove(send: Send, p: ScenePropRecord): Promise<void> {
  await send(SCN_INTENTS.deleteProp, { propId: p.id });
  recordUndo(p.sceneId, { op: "delete", prev: p });
}

/** Menu entries (FR-SCN-17) as `scn.updateProp` changes. */
export const rotateChange = (p: ScenePropRecord): PropFieldsBefore => ({
  rotation: nextRotation(p.rotation),
});

export function zChange(
  props: readonly ScenePropRecord[],
  p: ScenePropRecord,
  to: "front" | "back",
): PropFieldsBefore | null {
  const z = to === "front" ? frontZ(props, p.id) : backZ(props, p.id);
  return z === null ? null : { z };
}

// ---------- pointer (the canvas tool's handlers, FR-SCN-06) ----------

/** Called with an intent's rejection (the panel shows it with `toastReject`). */
export type OnReject = (err: unknown) => void;

export function propPointer(onReject: OnReject) {
  const settle = (p: Promise<unknown>) => p.catch(onReject);
  return {
    /**
     * Left press: a corner handle of the selected (unlocked) prop → resize; a prop → select it and
     * move it unless locked ("a locked drag does nothing"); empty cell with an image chosen → place
     * there (FR-SCN-16); else clear the selection.
     */
    down(e: ToolPointer) {
      const s = usePropTool.getState();
      const sel = s.props.find((p) => p.id === s.selectedId) ?? null;
      const from = (p: ScenePropRecord): PropBox => ({ col: p.col, row: p.row, w: p.w, h: p.h });
      const handle = sel && !sel.locked ? handleAt(from(sel), e.grid, e.x, e.y) : null;
      if (sel && handle) {
        usePropTool.setState({
          menu: null,
          gesture: { kind: "resize", propId: sel.id, handle, from: from(sel), box: from(sel) },
        });
        return;
      }
      const hit = propAt(s.props, e.cell);
      if (hit) {
        usePropTool.setState({
          selectedId: hit.id,
          menu: null,
          gesture: hit.locked
            ? null
            : { kind: "move", propId: hit.id, start: e.cell, from: from(hit), box: from(hit) },
        });
        return;
      }
      usePropTool.setState({ selectedId: null, menu: null, gesture: null });
      if (s.imageId) {
        settle(
          placePropAt(e.intent, e.scene.id, s.imageId, e.cell).then((id) => {
            if (usePropTool.getState().sceneId === e.scene.id) {
              usePropTool.setState({ selectedId: id });
            }
          }),
        );
      }
    },
    move(e: ToolPointer) {
      const g = usePropTool.getState().gesture;
      if (!g) return;
      const box =
        g.kind === "move"
          ? {
              ...g.from,
              col: g.from.col + e.cell.col - g.start.col,
              row: g.from.row + e.cell.row - g.start.row,
            }
          : resizeFromHandle(g.from, g.handle, e.cell);
      if (!sameBox(box, g.box)) usePropTool.setState({ gesture: { ...g, box } });
    },
    /** Release: send the move / resize; the gesture box shows until the intent settles. */
    up(e: ToolPointer) {
      const g = usePropTool.getState().gesture;
      const p = g ? propById(g.propId) : null;
      if (!g || !p || sameBox(g.box, g.from)) {
        usePropTool.setState({ gesture: null });
        return;
      }
      const change = g.kind === "move" ? { col: g.box.col, row: g.box.row } : { ...g.box };
      const done = () => {
        if (usePropTool.getState().gesture === g) usePropTool.setState({ gesture: null });
      };
      settle(updatePropFields(e.intent, p, change).finally(done));
    },
    /** Esc / tool / scene / live: drop a gesture; Esc then clears the selection. */
    cancel(reason: ToolCancelReason): boolean {
      const s = usePropTool.getState();
      if (s.gesture) {
        usePropTool.setState({ gesture: null });
        return true;
      }
      if (reason === "escape") {
        if (!s.selectedId && !s.menu) return false;
        usePropTool.setState({ selectedId: null, menu: null });
        return true;
      }
      usePropTool.setState({ selectedId: null, menu: null, picking: null });
      return false;
    },
  };
}
