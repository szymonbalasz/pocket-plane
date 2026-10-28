// Canvas layer registry core (FR-MAP-29, FR-SCN-02/03): an ordered list, map 0 < grid 10 <
// scn-props 20 < scn-structure 26 < fog 30 < scn-templates 35 < vfx-under 38 < tokens 40 < vfx-over
// 43 < labels 45 < scn-edit 48 < pointers 50. Later features add layers at their slots without touching scene or token code.
// Sprint 4 (BL-07): every entry is a Konva Group (named by its id) inside one of four Konva layers
// (`map-layer-<base|fog|objects|top>`), picked by its `layer` key. DOM-free so it runs under
// `bun test`.
import type { CanvasContextValue } from "./canvas-context";

/** Order slots (FR-SCN-02); a new layer picks a free number between its neighbours. */
export const LAYER_ORDER = {
  map: 0,
  grid: 10,
  /** SCN props, grouped with structure in one Konva layer (`group`). */
  scnProps: 20,
  scnStructure: 26,
  fog: 30,
  /** Above fog: a player's own template in fog stays visible (FR-SCN-02). */
  scnTemplates: 35,
  /** spell-fx under pass: auras below tokens (FR-VFX-13). */
  vfxUnder: 38,
  tokens: 40,
  /** spell-fx over pass: auras and hit looks above tokens, below labels (FR-VFX-13). */
  vfxOver: 43,
  /** Token name labels + overlay badges, above every token (FR-MAP-42). */
  labels: 45,
  /** Drawing previews and handles; mounted only while a drawing tool is active. */
  scnEdit: 48,
  pointers: 50,
} as const;

export type CanvasClient = "dm" | "player";

/**
 * FR-MAP-29 (BL-07): the stage's Konva layers, bottom → top. `base` = static, rarely redrawn
 * (map, grid, scn-objects); `fog` = the one cached fog shape; `objects` = templates, tokens,
 * labels; `top` = drafts and animations (scn-edit, pointers).
 */
export const KONVA_LAYERS = ["base", "fog", "objects", "top"] as const;
export type KonvaLayerKey = (typeof KONVA_LAYERS)[number];

/** Which product layer a DM Layers-popover switch hides (FR-SCN-01, -05). */
export type LayerToggleTarget = "objects" | "tokens" | "dm-only" | "fog";

export interface LayerToggle {
  /** Unique; the switch's state key (`scn-layer-toggle-<key>`). */
  key: string;
  label: string;
  layer: LayerToggleTarget;
  /**
   * `show` (FR-FOG-20, sprint 4): off by default; on = the layer draws even when it otherwise
   * wouldn't (the layer reads `toggleOn` itself; the entry is always mounted). Default `hide`:
   * on by default; off = not drawn and not hit (FR-SCN-05).
   */
  kind?: "hide" | "show";
}

/** Whether a switch is on, given the store's `off` (an unset `show` switch is off). */
export function toggleOn(t: LayerToggle, off: Readonly<Record<string, boolean>>): boolean {
  const v = off[t.key];
  return v === undefined ? t.kind !== "show" : !v;
}

export interface LayerDef<P> {
  /** Unique, kebab-case. */
  id: string;
  order: number;
  /** FR-MAP-29: the Konva layer it draws in; never a Layer of its own. */
  layer: KonvaLayerKey;
  component: (props: P) => unknown;
  /** Clients that mount it; default both. */
  clients?: readonly CanvasClient[];
  /**
   * Entries next to each other with the same group render inside one more Konva `<Group>`
   * (named after the group), e.g. `scn-objects`.
   */
  group?: string;
  /** A DM Layers-popover switch: off = not drawn and not hit on this DM client (FR-SCN-05). */
  toggle?: LayerToggle;
  /** FR-SCN-51: a right-click menu on this layer's objects (FR-MAP-71 step 4). */
  contextMenu?: LayerContextMenu;
}

/** FR-SCN-51: what a layer's `contextMenu` reads: the canvas context + the DM's layer switches. */
export interface LayerMenuContext extends CanvasContextValue {
  off: Readonly<Record<string, boolean>>;
}

/** A map point (map px) and a page point (`clientX`, `clientY`). */
export interface MenuPoint {
  x: number;
  y: number;
}

/**
 * FR-SCN-51: a layer's right-click menu. `hit` (pure) says whether a right press at map point `p`
 * would open it; `open` opens it at page point `screen` (on the release, FR-MAP-71).
 */
export interface LayerContextMenu {
  hit(p: MenuPoint, ctx: LayerMenuContext): boolean;
  open(p: MenuPoint, screen: MenuPoint, ctx: LayerMenuContext): void;
}

/**
 * Validated, sorted copy; duplicate ids, orders or toggle keys throw at load, and so does an
 * order that would interleave two Konva layers (their order is the lowest `order` in each).
 */
export function orderLayers<P>(layers: readonly LayerDef<P>[]): LayerDef<P>[] {
  const ids = new Set<string>();
  const orders = new Set<number>();
  const toggles = new Set<string>();
  for (const l of layers) {
    if (ids.has(l.id)) throw new Error(`Canvas layer "${l.id}" registered twice`);
    if (orders.has(l.order)) throw new Error(`Canvas layer order ${l.order} used twice`);
    if (l.toggle) {
      if (toggles.has(l.toggle.key)) throw new Error(`Layer toggle "${l.toggle.key}" used twice`);
      toggles.add(l.toggle.key);
    }
    ids.add(l.id);
    orders.add(l.order);
  }
  const sorted = [...layers].sort((a, b) => a.order - b.order);
  let at = 0;
  for (const l of sorted) {
    const k = KONVA_LAYERS.indexOf(l.layer);
    if (k < at) throw new Error(`Canvas layer "${l.id}" (${l.layer}) is out of its Konva layer`);
    at = k;
  }
  return sorted;
}

/** A run of entries inside one Konva layer: a lone entry, or same-group neighbours. */
export interface LayerSlot<P> {
  /** React key: the entry id, or `<group>:<first entry id>`. */
  key: string;
  /** Null = the entry's own Group sits directly in the Konva layer. */
  group: string | null;
  layers: LayerDef<P>[];
}

/**
 * FR-SCN-02/03/05: the slots a client mounts, in order. Drops entries for the other client and,
 * on the DM client, entries whose toggle is off (`off` holds toggle keys).
 */
export function layerSlots<P>(
  layers: readonly LayerDef<P>[],
  client: CanvasClient,
  off: Readonly<Record<string, boolean>> = {},
): LayerSlot<P>[] {
  const out: LayerSlot<P>[] = [];
  for (const l of layers) {
    if (l.clients && !l.clients.includes(client)) continue;
    if (client === "dm" && l.toggle && l.toggle.kind !== "show" && off[l.toggle.key]) continue;
    const last = out.at(-1);
    if (l.group && last?.group === l.group && last.layers[0]?.layer === l.layer)
      last.layers.push(l);
    else
      out.push({ key: l.group ? `${l.group}:${l.id}` : l.id, group: l.group ?? null, layers: [l] });
  }
  return out;
}

/** FR-MAP-29: one Konva layer to mount and the slots it holds. */
export interface StageLayer<P> {
  key: KonvaLayerKey;
  /** Konva name: `map-layer-<key>`. */
  name: string;
  slots: LayerSlot<P>[];
}

/** FR-MAP-29 (BL-07): `layerSlots` grouped into the ≤ 4 Konva layers, in order; empty ones dropped. */
export function stageLayers<P>(slots: readonly LayerSlot<P>[]): StageLayer<P>[] {
  return KONVA_LAYERS.flatMap((key) => {
    const mine = slots.filter((s) => s.layers[0]?.layer === key);
    return mine.length === 0 ? [] : [{ key, name: `map-layer-${key}`, slots: mine }];
  });
}

/** FR-SCN-05: every registered toggle, in layer order (the Layers popover's switches). */
export function layerToggles<P>(layers: readonly LayerDef<P>[]): LayerToggle[] {
  return layers.flatMap((l) => (l.toggle ? [l.toggle] : []));
}

/**
 * FR-SCN-51 / FR-MAP-71 step 4: the first entry this client mounts (`layerSlots`' rules) whose
 * `contextMenu.hit(p)` is true, asked top-down by `order`; null when none hits.
 */
export function layerMenuAt<P>(
  layers: readonly LayerDef<P>[],
  p: MenuPoint,
  ctx: LayerMenuContext,
): LayerDef<P> | null {
  const mounted = layerSlots(layers, ctx.client, ctx.off).flatMap((s) => s.layers);
  for (let i = mounted.length - 1; i >= 0; i--) {
    const l = mounted[i] as LayerDef<P>;
    if (l.contextMenu?.hit(p, ctx)) return l;
  }
  return null;
}
