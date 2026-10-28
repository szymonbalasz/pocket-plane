// AoE tool state (FR-SCN-22–26), shared by the tool's pointer handlers, its panel (beside the
// rail) and `TemplatesLayer`: the panel settings, this connection's ephemeral template and its
// sender, a press in progress (a new placement, or a kept template's origin / end handle drag,
// FR-SCN-45), the selected kept template, the kept templates this client may edit and the token
// footprints on the shown scene (the layer keeps those fresh), the origin cells highlighted while
// placing (#375) and the kept-template right-click menu (FR-SCN-48).
// Client only; the server validates every intent.
import {
  AOE_TEMPLATE_TYPE,
  SCN_INTENTS,
  SCN_SIGNALS,
  type TemplateRecordView,
  type TemplateSignalData,
} from "@shared/scene-tools/schemas";
import { create } from "zustand";
import { canvasBlind } from "../fog-of-war/blind";
import { toastReject } from "../scenes-map/intents";
import type { LayerContextMenu, LayerMenuContext, MenuPoint } from "../scenes-map/layers";
import { useMapTool } from "../scenes-map/tool-store";
import type { ToolCancelReason } from "../scenes-map/tools";
import type { SnapToken } from "./aoe-snap";
import {
  type AoeSettings,
  DEFAULT_AOE,
  EphemeralSender,
  type GridPoint,
  placeFrame,
  type TemplateView,
  templateAt,
} from "./templates";

type Send = (name: string, data: unknown) => unknown;
type Intent = (name: string, input: unknown) => Promise<unknown>;

/**
 * A press in progress. `place`: a new ephemeral from the raw press point (snapped per move,
 * FR-SCN-43). `move`: a kept template's origin handle (`at` = the snapped new origin, null until
 * the pointer leaves the press). `end`: its end handle (`template` = the local preview).
 */
export type AoeGesture =
  | { kind: "place"; press: GridPoint; angle: number }
  | {
      kind: "move";
      id: string;
      press: GridPoint;
      /** #377: with the moved template's new origin block (null: the exact rule). */
      at: (GridPoint & { footprint: number | null }) | null;
    }
  | { kind: "end"; id: string; template: TemplateView };

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
  /** Written by `TemplatesLayer`: the shown scene's token footprints, in draw order (#375). */
  tokens: readonly SnapToken[];
  /** #375: the cells the origin snaps to while placing or moving one (a cell, a token), or null. */
  originCell: SnapToken | null;
}

export const useAoe = create<AoeState>(() => ({
  settings: DEFAULT_AOE,
  dmOnly: false,
  own: null,
  gesture: null,
  selectedId: null,
  sceneId: null,
  editable: [],
  tokens: [],
  originCell: null,
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
      useAoe.setState({ gesture: null, originCell: null });
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
  useAoe.setState({ gesture: null, selectedId: null, originCell: null });
  if (reason === "live") stopOwn();
  else endOwn();
  return dropped;
}

// ---------- right-click menu (FR-SCN-48) ----------

export interface TemplateMenuOpen {
  templateId: string;
  sceneId: string;
  /** Page px of the release (`clientX`, `clientY`). */
  at: { x: number; y: number };
}

/** FR-SCN-48: the open template menu, if any (one per page). */
export const useTemplateMenu = create<{ open: TemplateMenuOpen | null }>(() => ({ open: null }));

export const openTemplateMenu = (open: TemplateMenuOpen): void =>
  useTemplateMenu.setState({ open });

export function closeTemplateMenu(): void {
  if (useTemplateMenu.getState().open) useTemplateMenu.setState({ open: null });
}

/** FR-SCN-48 Edit…: the AoE tool becomes active with the template selected (panel + handles). */
export function editFromMenu(templateId: string): void {
  closeTemplateMenu();
  useMapTool.getState().setTool("aoe");
  useAoe.setState({ selectedId: templateId, gesture: null });
}

/** FR-SCN-49: the kept template a right press at map point `p` hits on the shown scene. */
function menuTemplateAt(p: MenuPoint, ctx: LayerMenuContext): TemplateRecordView | null {
  const byId = ctx.store.records[AOE_TEMPLATE_TYPE] as
    | Record<string, TemplateRecordView>
    | undefined;
  // Draw order = the layer's (`TemplatesLayer`): the store's order, the shown scene's only.
  const kept = Object.values(byId ?? {}).filter((t) => t.sceneId === ctx.scene.id);
  return templateAt(p, kept, {
    client: ctx.client,
    myPlayerId: ctx.myPlayerId,
    dmOnlyOff: ctx.off["dm-only"] === true,
    templatesOff: ctx.client === "dm" && ctx.off.templates === true,
    blind: canvasBlind(ctx.client, ctx.store, ctx.scene.id, ctx.myPlayerId),
    scale: ctx.cam.scale,
    grid: ctx.grid,
  });
}

/** FR-SCN-51: `scn-templates`' layer menu (FR-MAP-71 step 4). */
export const templateContextMenu: LayerContextMenu = {
  hit: (p, ctx) => menuTemplateAt(p, ctx) !== null,
  open(p, screen, ctx) {
    const t = menuTemplateAt(p, ctx);
    if (t) openTemplateMenu({ templateId: t.id, sceneId: ctx.scene.id, at: screen });
  },
};
