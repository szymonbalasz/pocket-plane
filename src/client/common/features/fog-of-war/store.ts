// Fog tool state (FR-FOG-17–19, -22): bar choices, the gesture, the refusal hint, and the stage
// pointer handlers MapCanvas dispatches to (`canvas-tools.ts`). The server decides everything: a
// finished shape is sent as `fog.edit`; its draft stays until the event or reject (FR-FOG-18).
import { FOG_INTENTS, type FogEditInput, type FogOp } from "@shared/fog-of-war/schemas";
import { create } from "zustand";
import type { ToolCancelReason, ToolPointer, ToolPointerHandlers } from "../scenes-map/tools";
import {
  type FogDraft,
  type FogShapeMode,
  GESTURE_HINTS,
  type GesturePoint,
  type GestureState,
  type GestureStep,
  gestureCancel,
  gestureDown,
  gestureMove,
  gestureSettled,
  gestureUp,
  idleGesture,
  type Screen,
} from "./gesture";

/** Tool-store value; rail test id `map-tool-fog`. */
export const FOG_TOOL_ID = "fog";

export interface FogHint {
  text: string;
  at: Screen;
  /** Bumped per hint, so the same text again restarts its timer. */
  n: number;
}

interface FogToolState {
  op: FogOp;
  shape: FogShapeMode;
  /** The DM's shown scene (published by the fog layer): the bar's target. */
  sceneId: string | null;
  gesture: GestureState;
  hint: FogHint | null;
}

export const useFogTool = create<FogToolState>(() => ({
  op: "reveal",
  shape: "rect",
  sceneId: null,
  gesture: idleGesture,
  hint: null,
}));

/** Sends one intent; resolves on `ack`, rejects on `reject` (a `ToolPointer.intent`). */
export type IntentSender = (name: string, input: unknown) => Promise<unknown>;
type RejectHandler = (err: unknown) => void;

/** Where keys (Enter) send a closed polygon: the latest pointer event's scene and sender. */
let target: { sceneId: string; intent: IntentSender } | null = null;
let onReject: RejectHandler = (err) => console.error(err);

/** Reject → Toast; set by the fog bar (the store stays DOM- and toast-free for tests). */
export function setFogRejectHandler(h: RejectHandler): void {
  onReject = h;
}

/** A Reveal / Hide or Rectangle / Polygon switch drops the shape being drawn (FR-FOG-22). */
export function setFogMode(next: { op?: FogOp; shape?: FogShapeMode }): void {
  useFogTool.setState((s) => ({ ...next, gesture: gestureCancel(s.gesture, "escape").state }));
}

function send(shape: FogEditInput["shape"], sent: FogDraft | null): void {
  const t = target;
  if (!t) return;
  const input: FogEditInput = { sceneId: t.sceneId, op: useFogTool.getState().op, shape };
  const settle = () => useFogTool.setState((s) => ({ gesture: gestureSettled(s.gesture, sent) }));
  t.intent(FOG_INTENTS.edit, input).then(settle, (err) => {
    settle();
    onReject(err);
  });
}

let hints = 0;

/** Applies a gesture step: new state, then the hint and / or the send. */
export function applyFogStep(step: GestureStep, at: Screen | null): void {
  useFogTool.setState({ gesture: step.state });
  if (step.hint) {
    hints += 1;
    useFogTool.setState({
      hint: { text: GESTURE_HINTS[step.hint], at: at ?? { x: 0, y: 0 }, n: hints },
    });
  }
  if (step.send) send(step.send, step.state.draft);
}

const pointOf = (e: ToolPointer): GesturePoint => ({
  cell: e.cell,
  vertex: e.vertex,
  screen: e.screen,
  clicks: e.clicks,
});

function on(
  e: ToolPointer,
  fn: (s: GestureState, mode: FogShapeMode, p: GesturePoint) => GestureStep,
): void {
  if (e.client !== "dm") return;
  target = { sceneId: e.scene.id, intent: e.intent };
  const s = useFogTool.getState();
  applyFogStep(fn(s.gesture, s.shape, pointOf(e)), e.screen);
}

/** FR-FOG-17: stage pointer events of the active Fog tool (MapCanvas, FR-SCN-06). */
export const fogPointer: ToolPointerHandlers = {
  down: (e) => on(e, gestureDown),
  move: (e) => on(e, gestureMove),
  up: (e) => on(e, gestureUp),
  cancel(reason: ToolCancelReason) {
    const { state, dropped } = gestureCancel(useFogTool.getState().gesture, reason);
    useFogTool.setState({ gesture: state, ...(reason === "escape" ? {} : { hint: null }) });
    return dropped;
  },
};
