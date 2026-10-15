// Canvas layer registry core (FR-MAP-29, FR-SCN-02/03): an ordered list, map 0 < grid 10 <
// scn-props 20 < scn-structure 26 < fog 30 < scn-templates 35 < tokens 40 < labels 45 < scn-edit 48
// < pointers 50. Later features add layers at their slots without touching scene or token code.
// DOM-free so it runs under `bun test`.

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
  tokens: 40,
  /** Token name labels + overlay badges, above every token (FR-MAP-42). */
  labels: 45,
  /** Drawing previews and handles; mounted only while a drawing tool is active. */
  scnEdit: 48,
  pointers: 50,
} as const;

export type CanvasClient = "dm" | "player";

/** Which product layer a DM Layers-popover switch hides (FR-SCN-01, -05). */
export type LayerToggleTarget = "objects" | "tokens" | "dm-only" | "fog";

export interface LayerToggle {
  /** Unique; the switch's state key (`scn-layer-toggle-<key>`). */
  key: string;
  label: string;
  layer: LayerToggleTarget;
}

export interface LayerDef<P> {
  /** Unique, kebab-case. */
  id: string;
  order: number;
  component: (props: P) => unknown;
  /** Clients that mount it; default both. */
  clients?: readonly CanvasClient[];
  /**
   * Entries next to each other with the same group render inside one Konva `<Layer>` (named
   * after the group); their components render a Konva `<Group>`, not a `<Layer>`.
   */
  group?: string;
  /** A DM Layers-popover switch: off = not drawn and not hit on this DM client (FR-SCN-05). */
  toggle?: LayerToggle;
}

/** Validated, sorted copy; duplicate ids, orders or toggle keys throw at load. */
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
  return [...layers].sort((a, b) => a.order - b.order);
}

/** One Konva layer to mount: a lone entry, or a run of same-group entries. */
export interface LayerSlot<P> {
  /** React key: the entry id, or `<group>:<first entry id>`. */
  key: string;
  /** Null = the entry renders its own `<Layer>`. */
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
    if (client === "dm" && l.toggle && off[l.toggle.key]) continue;
    const last = out.at(-1);
    if (l.group && last?.group === l.group) last.layers.push(l);
    else
      out.push({ key: l.group ? `${l.group}:${l.id}` : l.id, group: l.group ?? null, layers: [l] });
  }
  return out;
}

/** FR-SCN-05: every registered toggle, in layer order (the Layers popover's switches). */
export function layerToggles<P>(layers: readonly LayerDef<P>[]): LayerToggle[] {
  return layers.flatMap((l) => (l.toggle ? [l.toggle] : []));
}
