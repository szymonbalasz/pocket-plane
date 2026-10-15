// FR-SCN-05 Layers popover: the switches (registry toggles in layer order, then DM-only items),
// per-campaign browser memory (all on by default; invalid → all on + warning; storage failure →
// memory only, one warning) and the DM canvas dropping a switched-off layer (players never).
import { describe, expect, test } from "bun:test";
import { type LayerDef, layerSlots, layerToggles, orderLayers } from "../scenes-map/layers";
import { useLayerToggles } from "../scenes-map/tool-store";
import {
  createLayerMemory,
  DM_ONLY_SWITCH,
  layerMemoryKey,
  layerSwitches,
  withoutDmOnly,
} from "./layer-switches";

const C = () => null;
/** The SCN entries of `canvas-layers.ts` (the real registry imports Konva). */
const registry: LayerDef<object>[] = orderLayers<object>([
  { id: "map", order: 0, component: C },
  {
    id: "scn-props",
    order: 20,
    component: C,
    group: "scn-objects",
    toggle: { key: "props", label: "Props", layer: "objects" },
  },
  {
    id: "scn-structure",
    order: 26,
    component: C,
    group: "scn-objects",
    toggle: { key: "walls", label: "Walls & doors", layer: "objects" },
  },
  {
    id: "scn-templates",
    order: 35,
    component: C,
    toggle: { key: "templates", label: "Templates", layer: "objects" },
  },
  { id: "tokens", order: 40, component: C },
]);

function storage() {
  const items = new Map<string, string>();
  return {
    items,
    backend: {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => void items.set(k, v),
    },
  };
}

describe("FR-SCN-05 switches", () => {
  test("FR-SCN-05 one switch per registered toggle in layer order, then DM-only items", () => {
    expect(layerSwitches(layerToggles(registry)).map((t) => [t.key, t.label])).toEqual([
      ["props", "Props"],
      ["walls", "Walls & doors"],
      ["templates", "Templates"],
      ["dm-only", "DM-only items"],
    ]);
    expect(layerSwitches([]).map((t) => t.key)).toEqual(["dm-only"]);
    expect(layerSwitches([DM_ONLY_SWITCH])).toHaveLength(1);
  });

  test("FR-SCN-05 off = the DM client doesn't mount it; players are unaffected; the store's setOn / replace", () => {
    useLayerToggles.getState().replace({});
    useLayerToggles.getState().setOn("walls", false);
    useLayerToggles.getState().setOn("templates", false);
    useLayerToggles.getState().setOn("templates", true);
    const off = useLayerToggles.getState().off;
    expect(off).toEqual({ walls: true, templates: false });
    const ids = (client: "dm" | "player") =>
      layerSlots(registry, client, useLayerToggles.getState().off).flatMap((s) =>
        s.layers.map((l) => l.id),
      );
    expect(ids("dm")).toEqual(["map", "scn-props", "scn-templates", "tokens"]);
    expect(ids("player")).toEqual(["map", "scn-props", "scn-structure", "scn-templates", "tokens"]);
    useLayerToggles.getState().replace({});
    expect(ids("dm")).toHaveLength(5);
  });
});

describe("FR-SCN-01 / -05 DM-only items", () => {
  test("FR-SCN-05 DM-only items off drops hidden tokens (and their labels) on the DM client only", () => {
    const tokens = [
      { id: "mira", hidden: false },
      { id: "wolf", hidden: true },
    ];
    const ids = (client: "dm" | "player", off: Record<string, boolean>) =>
      withoutDmOnly(tokens, client, off).map((t) => t.id);
    expect(ids("dm", {})).toEqual(["mira", "wolf"]);
    expect(ids("dm", { "dm-only": false, walls: true })).toEqual(["mira", "wolf"]);
    expect(ids("dm", { "dm-only": true })).toEqual(["mira"]);
    expect(ids("player", { "dm-only": true })).toEqual(["mira", "wolf"]);
    expect(withoutDmOnly(tokens, "dm", {})).toBe(tokens);
  });
});

describe("FR-SCN-05 per-campaign memory", () => {
  test("FR-SCN-05 all on by default; kept per campaign; only off keys stored", () => {
    const s = storage();
    const m = createLayerMemory(() => s.backend);
    expect(m.read("c1")).toEqual({});
    m.write("c1", { walls: true, props: false, "dm-only": true });
    expect(s.items.get(layerMemoryKey("c1"))).toBe(JSON.stringify({ off: ["walls", "dm-only"] }));
    expect(layerMemoryKey("c1")).toBe("pp.layers.v1.c1");
    expect(m.read("c1")).toEqual({ walls: true, "dm-only": true });
    expect(m.read("c2")).toEqual({});
    // A fresh page reads what the last one wrote.
    expect(createLayerMemory(() => s.backend).read("c1")).toEqual({ walls: true, "dm-only": true });
  });

  test("FR-SCN-05 an invalid entry → all on + one warning; storage failure → memory only, one warning", () => {
    const s = storage();
    const warnings: string[] = [];
    const m = createLayerMemory(
      () => s.backend,
      (msg) => warnings.push(msg),
    );
    s.items.set(layerMemoryKey("c1"), "{not json");
    expect(m.read("c1")).toEqual({});
    s.items.set(layerMemoryKey("c1"), JSON.stringify({ off: [1] }));
    expect(m.read("c1")).toEqual({});
    expect(warnings).toHaveLength(2);

    const broken = createLayerMemory(
      () => {
        throw new Error("blocked");
      },
      (msg) => warnings.push(msg),
    );
    expect(broken.read("c1")).toEqual({});
    broken.write("c1", { walls: true });
    expect(broken.read("c1")).toEqual({ walls: true });
    expect(warnings).toHaveLength(3);
  });
});
