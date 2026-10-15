// SCN canvas core (SCN §13 unit rows): FR-SCN-03 layer registry (clients, group, toggles, duplicate
// order throws, layer budget) and FR-SCN-06 tool dispatch (Space pan, Esc to the tool, tokens
// ignore left-press, registry validation).
import { describe, expect, test } from "bun:test";
import { canvasLayers } from "./canvas-layers";
import { canvasTools } from "./canvas-tools";
import { LAYER_ORDER, type LayerDef, layerSlots, layerToggles, orderLayers } from "./layers";
import {
  activeTool,
  type CanvasToolDef,
  escapeOrder,
  isDrawing,
  orderTools,
  pressGoesToTool,
  stagePans,
  tokenTakesLeftPress,
  toolsFor,
  typingTarget,
} from "./tools";

const C = () => null;
const ids = (slots: { layers: { id: string }[] }[]) => slots.map((s) => s.layers.map((l) => l.id));

describe("FR-SCN-02/03 canvas layers", () => {
  test("FR-SCN-02 registered order: map < grid < props < structure < (fog) < templates < tokens < labels < edit < pointers", () => {
    expect(canvasLayers.map((l) => [l.id, l.order])).toEqual([
      ["map", 0],
      ["grid", 10],
      ["scn-props", 20],
      ["scn-structure", 26],
      ["scn-templates", 35],
      ["tokens", 40],
      ["labels", 45],
      ["scn-edit", 48],
      ["pointers", 50],
    ]);
    expect(LAYER_ORDER.fog).toBeGreaterThan(LAYER_ORDER.scnStructure);
    expect(LAYER_ORDER.fog).toBeLessThan(LAYER_ORDER.scnTemplates);
  });

  test("FR-SCN-03 props + structure share one Konva layer; scn-edit is DM only; budget ≤ 8 (9 drawing) with fog", () => {
    const dm = layerSlots(canvasLayers, "dm");
    expect(ids(dm)).toEqual([
      ["map"],
      ["grid"],
      ["scn-props", "scn-structure"],
      ["scn-templates"],
      ["tokens"],
      ["labels"],
      ["scn-edit"],
      ["pointers"],
    ]);
    expect(dm[2]?.group).toBe("scn-objects");
    const player = layerSlots(canvasLayers, "player");
    expect(player.flatMap((s) => s.layers.map((l) => l.id))).not.toContain("scn-edit");
    // scn-edit renders a Konva layer only while drawing; FOG adds one (order 30).
    const always = dm.filter((s) => s.layers[0]?.id !== "scn-edit").length;
    expect(always + 1).toBeLessThanOrEqual(8);
    expect(always + 2).toBeLessThanOrEqual(9);
  });

  test("FR-SCN-05 toggles: off drops the entry on the DM client only; an empty group drops its layer", () => {
    expect(layerToggles(canvasLayers).map((t) => [t.key, t.label, t.layer])).toEqual([
      ["props", "Props", "objects"],
      ["walls", "Walls & doors", "objects"],
      ["templates", "Templates", "objects"],
    ]);
    const walls = layerSlots(canvasLayers, "dm", { walls: true });
    expect(ids(walls)[2]).toEqual(["scn-props"]);
    const both = layerSlots(canvasLayers, "dm", { walls: true, props: true, templates: true });
    expect(ids(both).flat()).not.toContain("scn-props");
    expect(ids(both).flat()).not.toContain("scn-templates");
    expect(both.some((s) => s.group === "scn-objects")).toBe(false);
    const player = layerSlots(canvasLayers, "player", { walls: true, props: true });
    expect(ids(player)[2]).toEqual(["scn-props", "scn-structure"]);
  });

  test("FR-SCN-03 clients default both; a group split by another layer gives two keyed slots", () => {
    const layers: LayerDef<object>[] = orderLayers([
      { id: "a", order: 1, component: C, group: "g" },
      { id: "b", order: 2, component: C },
      { id: "c", order: 3, component: C, group: "g" },
      { id: "d", order: 4, component: C, clients: ["player"] },
    ]);
    const dm = layerSlots(layers, "dm");
    expect(dm.map((s) => s.key)).toEqual(["g:a", "b", "g:c"]);
    expect(layerSlots(layers, "player").map((s) => s.key)).toEqual(["g:a", "b", "g:c", "d"]);
  });

  test("FR-SCN-03 duplicate id, order or toggle key throws at load", () => {
    expect(() =>
      orderLayers([
        { id: "a", order: 1, component: C },
        { id: "b", order: 1, component: C },
      ]),
    ).toThrow(/order 1/);
    expect(() =>
      orderLayers([
        { id: "a", order: 1, component: C },
        { id: "a", order: 2, component: C },
      ]),
    ).toThrow(/twice/);
    const toggle = { key: "k", label: "K", layer: "objects" as const };
    expect(() =>
      orderLayers([
        { id: "a", order: 1, component: C, toggle },
        { id: "b", order: 2, component: C, toggle },
      ]),
    ).toThrow(/toggle "k"/);
  });
});

const tool = (t: Partial<CanvasToolDef> & Pick<CanvasToolDef, "id" | "order">): CanvasToolDef => ({
  label: t.id,
  icon: C,
  clients: ["dm"],
  ...t,
});

describe("FR-SCN-06 canvas tools", () => {
  test("FR-SCN-06 the registry ships empty; entries validate and sort", () => {
    expect(canvasTools).toEqual([]);
    const tools = orderTools([
      tool({ id: "aoe", order: 30, clients: ["dm", "player"], pointer: {} }),
      tool({ id: "structure", order: 10, pointer: {} }),
      tool({ id: "layers", order: 40 }),
    ]);
    expect(tools.map((t) => t.id)).toEqual(["structure", "aoe", "layers"]);
    expect(toolsFor(tools, "player").map((t) => t.id)).toEqual(["aoe"]);
    expect(activeTool(tools, "structure", "dm")?.id).toBe("structure");
    expect(activeTool(tools, "structure", "player")).toBeNull();
    expect(activeTool(tools, "select", "dm")).toBeNull();
    expect(() => orderTools([tool({ id: "select", order: 1 })])).toThrow(/twice/);
    expect(() => orderTools([tool({ id: "a", order: 1 }), tool({ id: "a", order: 2 })])).toThrow(
      /twice/,
    );
    expect(() => orderTools([tool({ id: "a", order: 1 }), tool({ id: "b", order: 1 })])).toThrow(
      /order 1/,
    );
  });

  test("FR-SCN-06 Space + drag pans with any tool; Select pans without", () => {
    expect(stagePans("select", false)).toBe(true);
    expect(stagePans("ruler", false)).toBe(false);
    expect(stagePans("structure", false)).toBe(false);
    expect(stagePans("structure", true)).toBe(true);
    expect(typingTarget({ tagName: "INPUT" })).toBe(true);
    expect(typingTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(typingTarget({ tagName: "BUTTON" })).toBe(true);
    expect(typingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(typingTarget({ tagName: "CANVAS" })).toBe(false);
    expect(typingTarget(null)).toBe(false);
  });

  test("FR-SCN-06 a left press goes to the drawing tool: not with Space, not right-click, not while not live", () => {
    const draw = tool({ id: "structure", order: 1, pointer: {} });
    const panel = tool({ id: "layers", order: 2 });
    const press = { button: 0, space: false, live: true };
    expect(isDrawing(draw)).toBe(true);
    expect(isDrawing(panel)).toBe(false);
    expect(pressGoesToTool(draw, press)).toBe(true);
    expect(pressGoesToTool(draw, { ...press, space: true })).toBe(false);
    expect(pressGoesToTool(draw, { ...press, button: 2 })).toBe(false);
    expect(pressGoesToTool(draw, { ...press, live: false })).toBe(false);
    expect(pressGoesToTool(panel, press)).toBe(false);
    expect(pressGoesToTool(null, press)).toBe(false);
  });

  test("FR-SCN-06 tokens ignore left-press while a drawing tool is active", () => {
    expect(tokenTakesLeftPress(null)).toBe(true);
    expect(tokenTakesLeftPress(tool({ id: "layers", order: 1 }))).toBe(true);
    expect(tokenTakesLeftPress(tool({ id: "structure", order: 1, pointer: {} }))).toBe(false);
  });

  test("FR-SCN-06 Esc: a token drag, then a box, then the active tool", () => {
    const cancel = () => true;
    const draw = tool({ id: "structure", order: 1, pointer: { cancel } });
    expect(escapeOrder(true, true, draw)).toBe("drag");
    expect(escapeOrder(false, true, draw)).toBe("box");
    expect(escapeOrder(false, false, draw)).toBe("tool");
    expect(escapeOrder(false, false, tool({ id: "x", order: 1, pointer: {} }))).toBeNull();
    expect(escapeOrder(false, false, null)).toBeNull();
  });
});
