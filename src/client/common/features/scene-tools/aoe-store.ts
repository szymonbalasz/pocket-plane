// AoE tool state (FR-SCN-22–26), shared by the tool's pointer handlers, its panel (beside the
// rail) and `TemplatesLayer`: the panel settings, this connection's ephemeral template and its
// sender, a press in progress (a new placement or moving a kept template), the selected kept
// template and the kept templates this client may edit on the shown scene (the layer keeps
// that fresh). Client only; the server validates every intent.
import {
  SCN_INTENTS,
  SCN_SIGNALS,
  type TemplateRecordView,
  type TemplateSignalData,
} from "@shared/scene-tools/schemas";
import { create } from "zustand";
import { toastReject } from "../scenes-map/intents";
import type { ToolCancelReason } from "../scenes-map/tools";
import {
  type AoeSettings,
  DEFAULT_AOE,
  EphemeralSender,
  placeFrame,
  type TemplateView,
} from "./templates";

type Send = (name: string, data: unknown) => unknown;
type Intent = (name: string, input: unknown) => Promise<unknown>;

export type AoeGesture =
  | { kind: "place"; origin: { x: number; y: number }; angle: number }
  | { kind: "move"; id: string; from: { x: number; y: number }; at: { x: number; y: number } };

export interface AoeState {
  settings: AoeSettings;
  /** DM: the ephemeral routes to DM tabs only; Keep stores it hidden (FR-SCN-24, -25). */
  dmOnly: boolean;
  /** This connection's ephemeral template, as drawn locally. */
  own: { sceneId: string; template: TemplateView } | null;
  gesture: AoeGesture | null;
  selectedId: string | null;
  /** Written by `TemplatesLayer`: the shown scene and the kept templates this client may edit. */
  sceneId: string | null;
  editable: readonly TemplateRecordView[];
}

export const useAoe = create<AoeState>(() => ({
  settings: DEFAULT_AOE,
  dmOnly: false,
  own: null,
  gesture: null,
  selectedId: null,
  sceneId: null,
  editable: [],
}));

/** One key per page load = one ephemeral per connection (FR-SCN-22). */
const KEY = Math.random().toString(36).slice(2, 10);

let send: Send | null = null;
let intent: Intent | null = null;
const sender = new EphemeralSender((d: TemplateSignalData) => {
  send?.(SCN_SIGNALS.template, d);
});

/** The latest WS senders (from a tool pointer event or the panel's hooks). */
export function bindAoe(s: Send, i: Intent): void {
  send = s;
  intent = i;
}

/** Shows (and sends) this connection's ephemeral template. */
export function showOwn(sceneId: string, template: TemplateView): void {
  useAoe.setState({ own: { sceneId, template } });
  sender.show(placeFrame(sceneId, KEY, template, useAoe.getState().dmOnly));
}

/** Clear / Esc / Keep: removes it for everyone (one `end`). */
export function endOwn(): void {
  sender.end();
  useAoe.setState({ own: null });
}

/** FR-SCN-34: not live → stop sending; receivers drop it after 3 s. */
function stopOwn(): void {
  sender.stop();
  useAoe.setState({ own: null });
}

/** FR-SCN-25: Keep turns the ephemeral into a kept template, then ends the ephemeral. */
export async function keepOwn(): Promise<void> {
  const own = useAoe.getState().own;
  if (!own || !intent) return;
  const { label, width, ...geo } = own.template;
  const dmOnly = useAoe.getState().dmOnly;
  try {
    await intent(SCN_INTENTS.placeTemplate, {
      sceneId: own.sceneId,
      ...geo,
      ...(geo.shape === "line" && width !== null && width !== undefined ? { width } : {}),
      ...(label ? { label } : {}),
      ...(dmOnly ? { hidden: true } : {}),
    });
    if (useAoe.getState().own === own) endOwn();
  } catch (err) {
    toastReject(err);
  }
}

/** FR-SCN-26: an edit of a kept template (placer or DM); a reject shows a Toast. */
export function editTemplate(name: string, input: unknown): void {
  intent?.(name, input).catch(toastReject);
}

/** Drops a gesture in progress / the ephemeral / the selection (FR-SCN-22, -34; FR-SCN-06 Esc). */
export function cancelAoe(reason: ToolCancelReason): boolean {
  const st = useAoe.getState();
  if (reason === "escape") {
    if (st.gesture) {
      useAoe.setState({ gesture: null });
      if (st.gesture.kind === "place") endOwn();
      return true;
    }
    if (st.own) {
      endOwn();
      return true;
    }
    if (st.selectedId) {
      useAoe.setState({ selectedId: null });
      return true;
    }
    return false;
  }
  const dropped = st.gesture !== null || st.own !== null;
  useAoe.setState({ gesture: null, selectedId: null });
  if (reason === "live") stopOwn();
  else endOwn();
  return dropped;
}
