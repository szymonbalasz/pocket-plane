// AoE tool state (FR-SCN-22–26), shared by the tool's pointer handlers, its panel (beside the
// rail) and `TemplatesLayer`: the panel settings, this connection's ephemeral template and its
// sender, a press in progress (a new placement, or a kept template's origin / end handle drag,
// FR-SCN-45), the selected kept template, the kept templates this client may edit and the token
// footprints on the shown scene (the layer keeps those fresh), the origin cells highlighted while
// placing (#375) and the kept-template right-click menu (FR-SCN-48). FR-VFX-40: a placement
// request (a spell cast into a template) borrows the tool for one placement.
// Client only; the server validates every intent.
import {
  AOE_TEMPLATE_TYPE,
  SCN_INTENTS,
  SCN_SIGNALS,
  type TemplateRecordView,
  type TemplateShape,
  type TemplateSignalData,
} from "@shared/scene-tools/schemas";
import { create } from "zustand";
import { canvasBlind } from "../fog-of-war/blind";
import { toastReject } from "../scenes-map/intents";
import type { LayerContextMenu, LayerMenuContext, MenuPoint } from "../scenes-map/layers";
import { type MapTool, useMapTool } from "../scenes-map/tool-store";
import type { ToolCancelReason } from "../scenes-map/tools";
import type { SnapToken } from "./aoe-snap";
import { diagonalRuleIn } from "./diagonal-rule";
import {
  type AoeSettings,
  clearFrame,
  DEFAULT_AOE,
  EphemeralSender,
  type EphemeralTemplate,
  ephemeralAt,
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
  /** Written by `TemplatesLayer`: the others' ephemerals drawn on the shown scene (FR-SCN-58). */
  others: readonly EphemeralTemplate[];
  gesture: AoeGesture | null;
  selectedId: string | null;
  /** Written by `TemplatesLayer`: the shown scene and the kept templates this client may edit. */
  sceneId: string | null;
  editable: readonly TemplateRecordView[];
  /** Written by `TemplatesLayer`: the shown scene's token footprints, in draw order (#375). */
  tokens: readonly SnapToken[];
  /** #375: the cells the origin snaps to while placing or moving one (a cell, a token), or null. */
  originCell: SnapToken | null;
  /** FR-VFX-40: the placement this tool is borrowed for, or null. */
  request: PlaceRequest | null;
}

/**
 * FR-VFX-40: one placement asked for by another feature (a spell cast into a template). The
 * shape and size are fixed; the release of the press sends it through `place` instead of
 * leaving an ephemeral to Keep.
 */
export interface PlaceRequest {
  /** Who asked (`vfx.cast:<spellId>`): its button shows the request as on. */
  key: string;
  /** What is being placed ("Evard's Black Tentacles"): the panel's title and the label. */
  title: string;
  shape: TemplateShape;
  size: number;
  /** Sends the placement (the shown scene, the placed geometry, the DM-only switch). */
  place(sceneId: string, template: TemplateView, dmOnly: boolean): Promise<unknown>;
}

export const useAoe = create<AoeState>(() => ({
  settings: DEFAULT_AOE,
  dmOnly: false,
  own: null,
  others: [],
  gesture: null,
  selectedId: null,
  sceneId: null,
  editable: [],
  tokens: [],
  originCell: null,
  request: null,
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

/** FR-SCN-58: the DM cleared the ephemeral with `key`: if it is this connection's, as its Clear. */
export function templateCleared(key: string): void {
  if (key !== KEY) return;
  if (useAoe.getState().gesture?.kind === "place") {
    useAoe.setState({ gesture: null, originCell: null });
  }
  endOwn();
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

// ---------- placement requests (FR-VFX-40) ----------

/** What a request borrowed: the panel settings and the tool it switched from. */
let borrowed: { settings: AoeSettings; tool: MapTool } | null = null;

/**
 * FR-VFX-40: the AoE tool becomes active for one placement of `req` (its shape, size and title
 * as the label); the user's settings and tool come back when it is sent or cancelled.
 */
export function requestPlacement(req: PlaceRequest): void {
  const st = useAoe.getState();
  const tool = useMapTool.getState().tool;
  if (!st.request || !borrowed) borrowed = { settings: st.settings, tool };
  if (st.own) endOwn();
  useAoe.setState({
    request: req,
    selectedId: null,
    gesture: null,
    settings: { ...st.settings, shape: req.shape, size: req.size, label: req.title },
  });
  if (tool !== "aoe") useMapTool.getState().setTool("aoe");
}

/** FR-VFX-40: ends the request (sent or cancelled); `restoreTool`: switch back to the old tool. */
export function endRequest(restoreTool: boolean): void {
  if (!useAoe.getState().request) return;
  const was = borrowed;
  borrowed = null;
  useAoe.setState({ request: null, ...(was ? { settings: was.settings } : {}) });
  if (restoreTool && was && useMapTool.getState().tool === "aoe" && was.tool !== "aoe") {
    useMapTool.getState().setTool(was.tool);
  }
}

/** FR-VFX-40: the released placement goes to the request; its ephemeral ends either way. */
export async function sendRequest(): Promise<void> {
  const { request, own, dmOnly } = useAoe.getState();
  if (!request || !own) return;
  try {
    await request.place(own.sceneId, own.template, dmOnly);
  } catch (err) {
    toastReject(err);
  } finally {
    if (useAoe.getState().own === own) endOwn();
    if (useAoe.getState().request === request) endRequest(true);
  }
}

/** Drops a gesture in progress / the ephemeral / the selection (FR-SCN-22, -34; FR-SCN-06 Esc). */
export function cancelAoe(reason: ToolCancelReason): boolean {
  const st = useAoe.getState();
  // FR-VFX-40: Esc, a tool or scene switch, leaving live: the request is cancelled.
  if (st.request) {
    useAoe.setState({ gesture: null, originCell: null });
    if (st.own) endOwn();
    endRequest(reason === "escape");
    if (reason === "escape") return true;
  }
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
    rule: diagonalRuleIn(ctx.store.records),
  });
}

const aoeToolOn = (ctx: LayerMenuContext) => ctx.activeTool?.id === "aoe";

/** FR-SCN-58: the ephemeral a right press clears: only with the AoE tool on. */
function menuEphemeralAt(p: MenuPoint, ctx: LayerMenuContext) {
  if (!aoeToolOn(ctx)) return null;
  const { own, others } = useAoe.getState();
  return ephemeralAt(p, own?.sceneId === ctx.scene.id ? own.template : null, others, {
    client: ctx.client,
    scale: ctx.cam.scale,
    grid: ctx.grid,
    rule: diagonalRuleIn(ctx.store.records),
  });
}

/**
 * FR-SCN-51: `scn-templates`' layer menu (FR-MAP-71 step 4). FR-SCN-58: with the AoE tool on, a
 * right click on an ephemeral clears it at once (nothing to lose: the panel's Clear, one click),
 * and the templates go ahead of what lies under them, tokens included.
 */
export const templateContextMenu: LayerContextMenu = {
  first: aoeToolOn,
  hit: (p, ctx) => menuEphemeralAt(p, ctx) !== null || menuTemplateAt(p, ctx) !== null,
  open(p, screen, ctx) {
    const eph = menuEphemeralAt(p, ctx);
    if (eph === "own") return endOwn();
    if (eph) return void send?.(SCN_SIGNALS.templateClear, clearFrame(eph));
    const t = menuTemplateAt(p, ctx);
    if (t) openTemplateMenu({ templateId: t.id, sceneId: ctx.scene.id, at: screen });
  },
};
