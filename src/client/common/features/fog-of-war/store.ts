// Fog tool state (FR-FOG-17–19, -22, -41, -42): bar choices, the gesture, the refusal hint, the
// darkness menu, and the stage pointer handlers MapCanvas dispatches to (`canvas-tools.ts`). The
// server decides everything: a finished shape is sent as `fog.edit` (Reveal / Fog / Explored) or
// `fog.placeDarkness` (Darkness); a darkness drag as `fog.moveDarkness`, Delete / Remove as
// `fog.removeDarkness`. A sent draft or move stays until the event or reject (FR-FOG-18).
// Sprint 4: the brush (FR-FOG-55): its radius (kept per browser) and the pointer's grid point
// while Brush is picked (the cursor ring / stamp highlight), kept outside the gesture so hovering
// redraws only the cursor; each sent stroke is one `fog.edit`.
import {
  FOG_INTENTS,
  FOG_TYPE,
  type FogEditInput,
  type FogMoveDarknessInput,
  type FogPlaceDarknessInput,
  type FogRecord,
  type FogRemoveDarknessInput,
} from "@shared/fog-of-war/schemas";
import type { FogBrushGeom } from "@shared/fog-of-war/shapes";
import type { DiagonalRule } from "@shared/scene-tools/schemas";
import { create } from "zustand";
import type { ToolCancelReason, ToolPointer, ToolPointerHandlers } from "../scenes-map/tools";
import { BRUSH_FT, type BrushDraft, clampBrushFt } from "./brush";
import {
  type DarknessMove,
  darknessAt,
  type FogDraft,
  type FogShapeMode,
  GESTURE_HINTS,
  type GestureMode,
  type GesturePoint,
  type GestureSend,
  type GestureState,
  type GestureStep,
  gestureCancel,
  gestureDown,
  gestureMove,
  gestureSettled,
  gestureUp,
  idleGesture,
  type Pt,
  type Screen,
} from "./gesture";

/** Tool-store value; rail test id `map-tool-fog`. */
export const FOG_TOOL_ID = "fog";

/** FR-FOG-17: the bar's Mode. */
export type FogMode = "reveal" | "fog" | "explored" | "darkness";
export const FOG_MODES: readonly FogMode[] = ["reveal", "fog", "explored", "darkness"];

export interface FogHint {
  text: string;
  at: Screen;
  /** Bumped per hint, so the same text again restarts its timer. */
  n: number;
}

interface FogToolState {
  mode: FogMode;
  shape: FogShapeMode;
  /** The DM's shown scene (published by the fog layer): the bar's target. */
  sceneId: string | null;
  gesture: GestureState;
  hint: FogHint | null;
  /** The pointer on the latest event (the "Free" chip while Ctrl is held). */
  cursor: Screen | null;
  /** FR-FOG-42: the darkness right-click menu. */
  menu: { id: string; at: Screen } | null;
  /** FR-FOG-55: the brush radius, ft (0–50, step 5). */
  brushFt: number;
  /** FR-FOG-55: the pointer in grid units while Brush is picked (null off the stage). */
  hover: Pt | null;
}

/** FR-FOG-55: where the radius is kept per browser. */
export const BRUSH_FT_KEY = "pp.fog.brush-ft";

function storedBrushFt(): number {
  try {
    const v = globalThis.localStorage?.getItem(BRUSH_FT_KEY);
    return v === null || v === undefined ? BRUSH_FT.default : clampBrushFt(v);
  } catch {
    return BRUSH_FT.default;
  }
}

export const useFogTool = create<FogToolState>(() => ({
  mode: "reveal",
  shape: "rect",
  sceneId: null,
  gesture: idleGesture,
  hint: null,
  cursor: null,
  menu: null,
  brushFt: storedBrushFt(),
  hover: null,
}));

/** FR-FOG-55: the radius Slider; kept per browser. */
export function setBrushFt(v: number): void {
  const brushFt = clampBrushFt(v);
  useFogTool.setState({ brushFt });
  try {
    globalThis.localStorage?.setItem(BRUSH_FT_KEY, String(brushFt));
  } catch {
    // Storage blocked: the radius lasts for this tab.
  }
}

/** Sends one intent; resolves on `ack`, rejects on `reject` (a `ToolPointer.intent`). */
export type IntentSender = (name: string, input: unknown) => Promise<unknown>;
type RejectHandler = (err: unknown) => void;
/** Reads the shown scene's `fog` record (the darkness to hit-test in Darkness mode). */
type FogReader = (sceneId: string) => FogRecord | undefined;
/** Reads the campaign's diagonal rule (`map-settings`, FR-FOG-55's snapped stamp). */
type RuleReader = () => DiagonalRule;

/** Where keys and the menu send: the latest pointer event's scene and sender. */
let target: { sceneId: string; intent: IntentSender } | null = null;
let onReject: RejectHandler = (err) => console.error(err);
let readFog: FogReader = () => undefined;
let readRule: RuleReader = () => "5-10-5";

/** Reject → Toast; set by the fog bar (the store stays DOM- and toast-free for tests). */
export function setFogRejectHandler(h: RejectHandler): void {
  onReject = h;
}

/** The sync store readers; set by the fog layer. */
export function setFogReader(r: FogReader, rule?: RuleReader): void {
  readFog = r;
  if (rule) readRule = rule;
}

/**
 * A Mode or Shape switch drops the shape being drawn and the selection (FR-FOG-22). No Darkness
 * brush (FR-FOG-55): Darkness with Brush picked falls back to Rectangle.
 */
export function setFogMode(next: { mode?: FogMode; shape?: FogShapeMode }): void {
  useFogTool.setState((s) => ({
    ...next,
    ...((next.mode ?? s.mode) === "darkness" && (next.shape ?? s.shape) === "brush"
      ? { shape: next.shape === "brush" ? s.shape : "rect" }
      : {}),
    ...((next.shape ?? s.shape) !== "brush" ? { hover: null } : {}),
    gesture: { ...gestureCancel(s.gesture, "tool").state, ...keptPending(s.gesture) },
    menu: null,
  }));
}

/** A sent draft / move keeps drawing until it settles, whatever is picked meanwhile. */
const keptPending = (g: GestureState): Partial<GestureState> => ({
  strokes: g.strokes,
  ...(g.pending ? { draft: g.draft, pending: true } : {}),
  ...(g.move?.pending ? { move: g.move } : {}),
});

function intentFor(
  send: Exclude<GestureSend, { kind: "brush" }>,
  sceneId: string,
): [string, unknown] {
  if (send.kind === "move") {
    const input: FogMoveDarknessInput = { sceneId, darknessId: send.id, dx: send.dx, dy: send.dy };
    return [FOG_INTENTS.moveDarkness, input];
  }
  if (send.kind === "remove") {
    const input: FogRemoveDarknessInput = { sceneId, darknessId: send.id };
    return [FOG_INTENTS.removeDarkness, input];
  }
  const mode = useFogTool.getState().mode;
  if (mode === "darkness") {
    const input: FogPlaceDarknessInput = { sceneId, shape: send.shape };
    return [FOG_INTENTS.placeDarkness, input];
  }
  const input: FogEditInput = { sceneId, op: mode, shape: send.shape };
  return [FOG_INTENTS.edit, input];
}

function send(what: GestureSend, sent: FogDraft | DarknessMove | null): void {
  const t = target;
  if (!t) return;
  if (what.kind === "brush") {
    for (const s of what.strokes) sendStroke(t, s.draft, s.shape);
    return;
  }
  const [name, input] = intentFor(what, t.sceneId);
  const settle = () => useFogTool.setState((s) => ({ gesture: gestureSettled(s.gesture, sent) }));
  t.intent(name, input).then(settle, (err) => {
    settle();
    onReject(err);
  });
}

/** FR-FOG-55: one stroke = one `fog.edit` (one undo step), settled by its draft. */
function sendStroke(
  t: { sceneId: string; intent: IntentSender },
  draft: BrushDraft,
  shape: FogBrushGeom,
): void {
  const mode = useFogTool.getState().mode;
  const settle = () => useFogTool.setState((s) => ({ gesture: gestureSettled(s.gesture, draft) }));
  if (mode === "darkness") {
    settle();
    return;
  }
  const input: FogEditInput = { sceneId: t.sceneId, op: mode, shape };
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
  if (step.send) {
    const sent = step.send.kind === "move" ? step.state.move : step.state.draft;
    send(step.send, step.send.kind === "remove" || step.send.kind === "brush" ? null : sent);
  }
}

/** FR-FOG-42: the darkness menu's Remove. */
export function removeDarkness(id: string): void {
  useFogTool.setState((s) => ({
    menu: null,
    gesture: s.gesture.selected === id ? { ...s.gesture, selected: null } : s.gesture,
  }));
  send({ kind: "remove", id }, null);
}

/** A tool pointer event in grid units (FR-FOG-18: Ctrl read on every event). */
export function pointOf(e: ToolPointer): GesturePoint {
  const g = e.grid;
  return {
    at: [(e.x - g.gridOffsetX) / g.gridCellSize, (e.y - g.gridOffsetY) / g.gridCellSize],
    cell: e.cell,
    screen: e.screen,
    clicks: e.clicks,
    ctrl: e.ctrl,
  };
}

function modeOf(sceneId: string): GestureMode {
  const s = useFogTool.getState();
  return {
    shape: s.shape,
    darkness: s.mode === "darkness" ? (readFog(sceneId)?.darkness ?? []) : null,
    brush: { ft: s.brushFt, rule: readRule() },
  };
}

function on(
  e: ToolPointer,
  fn: (s: GestureState, m: GestureMode, p: GesturePoint) => GestureStep,
): void {
  if (e.client !== "dm") return;
  target = { sceneId: e.scene.id, intent: e.intent };
  const p = pointOf(e);
  const brush = useFogTool.getState().shape === "brush";
  useFogTool.setState({ cursor: e.screen, ...(brush ? { hover: p.at } : {}) });
  applyFogStep(fn(useFogTool.getState().gesture, modeOf(e.scene.id), p), e.screen);
}

/** FR-FOG-17: stage pointer events of the active Fog tool (MapCanvas, FR-SCN-06). */
export const fogPointer: ToolPointerHandlers = {
  down: (e) => on(e, gestureDown),
  move: (e) => on(e, gestureMove),
  up: (e) => on(e, gestureUp),
  cancel(reason: ToolCancelReason) {
    const s = useFogTool.getState();
    const { state, dropped } = gestureCancel(s.gesture, reason);
    useFogTool.setState({
      gesture: state,
      menu: null,
      ...(reason === "escape" ? {} : { hint: null, cursor: null, hover: null }),
    });
    return dropped || s.menu !== null;
  },
  /** FR-FOG-42: right-press on a darkness shape (Darkness mode) opens its menu; else the laser. */
  menu(e) {
    if (e.client !== "dm" || useFogTool.getState().mode !== "darkness") return false;
    const p = pointOf(e);
    const hit = darknessAt(readFog(e.scene.id)?.darkness ?? [], p.at);
    if (!hit) return false;
    target = { sceneId: e.scene.id, intent: e.intent };
    useFogTool.setState((s) => ({
      menu: { id: hit.id, at: e.screen },
      gesture: { ...s.gesture, selected: hit.id },
    }));
    return true;
  },
};

/** The fog record reader the layer installs (`useSync` store). */
export const fogRecordOf = (records: Record<string, Record<string, unknown>>, sceneId: string) =>
  records[FOG_TYPE]?.[sceneId] as FogRecord | undefined;
