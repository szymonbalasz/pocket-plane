// Canvas layer registry core (FR-MAP-29): an ordered list, map < grid < (reserved: props, fog)
// < tokens < labels < pointers. Later features (scene-tools) add layers at the reserved slots without
// touching scene or token code. DOM-free so it runs under `bun test`.

/** Reserved order slots; a new layer picks a free number between its neighbours. */
export const LAYER_ORDER = {
  map: 0,
  grid: 10,
  props: 20,
  fog: 30,
  tokens: 40,
  /** Token name labels + overlay badges, above every token (FR-MAP-42). */
  labels: 45,
  pointers: 50,
} as const;

export interface LayerDef<P> {
  /** Unique, kebab-case. */
  id: string;
  order: number;
  component: (props: P) => unknown;
}

/** Validated, sorted copy; duplicate ids or orders throw at load. */
export function orderLayers<P>(layers: readonly LayerDef<P>[]): LayerDef<P>[] {
  const ids = new Set<string>();
  const orders = new Set<number>();
  for (const l of layers) {
    if (ids.has(l.id)) throw new Error(`Canvas layer "${l.id}" registered twice`);
    if (orders.has(l.order)) throw new Error(`Canvas layer order ${l.order} used twice`);
    ids.add(l.id);
    orders.add(l.order);
  }
  return [...layers].sort((a, b) => a.order - b.order);
}
