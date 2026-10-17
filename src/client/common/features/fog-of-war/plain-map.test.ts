// FR-FOG-20 (sprint 4, OQ-FOG-54): the DM's plain battlemap outside the Fog tool, the Layers
// popover's "Fog" switch (off by default, kept per campaign) and players unaffected.
import { describe, expect, test } from "bun:test";
import { createLayerMemory, layerSwitches } from "../scene-tools/layer-switches";
import { canvasLayers } from "../scenes-map/canvas-layers";
import { layerSlots, layerToggles, toggleOn } from "../scenes-map/layers";
import { FOG_LAYER_SWITCH, fogLayerShown } from "./plain-map";

describe("FR-FOG-20 DM plain map", () => {
  test("FR-FOG-20 DM layer hidden outside the Fog tool (and shown with the Layers switch on)", () => {
    // DM, switch untouched (off by default): only the Fog tool draws it.
    expect(fogLayerShown("dm", false, {})).toBe(false);
    expect(fogLayerShown("dm", true, {})).toBe(true);
    // Layers "Fog" on: drawn under every tool.
    expect(fogLayerShown("dm", false, { fog: false })).toBe(true);
    expect(fogLayerShown("dm", true, { fog: false })).toBe(true);
    // Switched off again (or hiding switches off): the plain map.
    expect(fogLayerShown("dm", false, { fog: true, walls: true })).toBe(false);
    // Players always draw their fog, whatever a stale DM store would say.
    expect(fogLayerShown("player", false, {})).toBe(true);
    expect(fogLayerShown("player", false, { fog: true })).toBe(true);
  });

  test("FR-FOG-20 the Fog switch: registered on the fog entry, off by default, never unmounts the layer", () => {
    const fog = canvasLayers.find((l) => l.id === "fog");
    expect(fog?.toggle).toBe(FOG_LAYER_SWITCH);
    expect(FOG_LAYER_SWITCH).toMatchObject({ key: "fog", label: "Fog", kind: "show" });
    expect(toggleOn(FOG_LAYER_SWITCH, {})).toBe(false);
    expect(layerSwitches(layerToggles(canvasLayers)).map((t) => t.label)).toContain("Fog");
    for (const off of [{}, { fog: false }, { fog: true }] as Record<string, boolean>[])
      expect(layerSlots(canvasLayers, "dm", off).some((s) => s.layers[0]?.id === "fog")).toBe(true);
  });

  test("FR-FOG-20 the Fog switch is kept per campaign (switched on survives a reload)", () => {
    const items = new Map<string, string>();
    const backend = {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => void items.set(k, v),
    };
    createLayerMemory(() => backend).write("c1", { fog: false });
    const read = createLayerMemory(() => backend).read("c1");
    expect(toggleOn(FOG_LAYER_SWITCH, read)).toBe(true);
    expect(toggleOn(FOG_LAYER_SWITCH, createLayerMemory(() => backend).read("c2"))).toBe(false);
  });
});
