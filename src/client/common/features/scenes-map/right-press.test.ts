import { describe, expect, test } from "bun:test";
import { canvasLayers } from "./canvas-layers";
import { type LayerDef, type LayerMenuContext, layerMenuAt, orderLayers } from "./layers";
import { deferredMove, type RightPressInput, rightPress } from "./right-press";

const base: RightPressInput = {
  client: "dm",
  live: true,
  signalsLive: true,
  nodeMenu: false,
  onToken: false,
  toolMenu: false,
  layerHit: false,
};
const kind = (s: Partial<RightPressInput>) => rightPress({ ...base, ...s });

describe("FR-MAP-71 right-press routing", () => {
  test("FR-MAP-71 right-press routing: node menu, then token, tool menu, layer menu, laser", () => {
    // (1) a door / prop node menu always wins (`cancelBubble`).
    expect(kind({ nodeMenu: true, onToken: true, layerHit: true })).toEqual({ kind: "node-menu" });
    // (2) DM over a token → the token menu, also over a template covering it.
    expect(kind({ onToken: true, layerHit: true })).toEqual({ kind: "token-menu" });
    expect(kind({ onToken: true, toolMenu: true })).toEqual({ kind: "token-menu" });
    // (3) the tool's own menu next.
    expect(kind({ toolMenu: true, layerHit: true })).toEqual({ kind: "tool-menu" });
    // (4) a layer contextMenu hit → deferred (laser allowed).
    expect(kind({ layerHit: true })).toEqual({ kind: "deferred", laser: true });
    // (5) nothing hit → laser at once.
    expect(kind({})).toEqual({ kind: "laser" });
  });

  test("FR-MAP-71 player over a token → template menu if contextMenu hits there, else nothing, never a laser", () => {
    const player = { client: "player" as const, onToken: true };
    expect(kind({ ...player, layerHit: true })).toEqual({ kind: "deferred", laser: false });
    expect(kind({ ...player, layerHit: false })).toEqual({ kind: "none" });
    expect(kind({ ...player, layerHit: false, signalsLive: true })).not.toEqual({ kind: "laser" });
    // Off any token a player's right press is the laser, or the deferred menu.
    expect(kind({ client: "player" })).toEqual({ kind: "laser" });
    expect(kind({ client: "player", layerHit: true })).toEqual({ kind: "deferred", laser: true });
  });

  test("FR-MAP-71 signalsLive false → no laser (immediate or deferred), menu still opens when live; not live → nothing", () => {
    expect(kind({ signalsLive: false })).toEqual({ kind: "none" });
    expect(kind({ signalsLive: false, layerHit: true })).toEqual({
      kind: "deferred",
      laser: false,
    });
    for (const s of [{}, { layerHit: true }, { onToken: true }, { toolMenu: true }])
      expect(kind({ ...s, live: false, signalsLive: false })).toEqual({ kind: "none" });
  });

  test("FR-MAP-71 deferred: release < 4 px → open, no laser frame; ≥ 4 px → laser from the press point", () => {
    expect(deferredMove(true, 0, 0)).toBe("menu");
    expect(deferredMove(true, 2, 3)).toBe("menu");
    expect(deferredMove(true, 4, 0)).toBe("laser");
    expect(deferredMove(true, 3, 3)).toBe("laser");
    // Laser not allowed (a player's token, or signals off): a drag is nothing.
    expect(deferredMove(false, 10, 0)).toBe("none");
    expect(deferredMove(false, 1, 1)).toBe("menu");
  });
});

describe("FR-SCN-51 contextMenu hook", () => {
  const ctx = (client: "dm" | "player", off: Record<string, boolean> = {}) =>
    ({ client, off }) as unknown as LayerMenuContext;
  const asked: string[] = [];
  const entry = (id: string, order: number, hits: boolean, extra: Partial<LayerDef<object>> = {}) =>
    ({
      id,
      order,
      layer: "objects",
      component: () => null,
      contextMenu: {
        hit: () => {
          asked.push(id);
          return hits;
        },
        open: () => {},
      },
      ...extra,
    }) as LayerDef<object>;

  test("FR-SCN-51 contextMenu hook: entries asked top-down by order; first hit wins; none → null", () => {
    const layers = orderLayers([
      entry("low", 10, true),
      entry("mid", 20, true),
      entry("top", 30, false),
      { id: "plain", order: 40, layer: "objects", component: () => null },
    ]);
    asked.length = 0;
    expect(layerMenuAt(layers, { x: 0, y: 0 }, ctx("dm"))?.id).toBe("mid");
    expect(asked).toEqual(["top", "mid"]);
    const none = orderLayers([entry("a", 10, false), entry("b", 20, false)]);
    expect(layerMenuAt(none, { x: 0, y: 0 }, ctx("dm"))).toBeNull();
  });

  test("FR-SCN-51 contextMenu hook: unmounted entries (other client, DM toggle off) are not asked", () => {
    const layers = orderLayers([
      entry("dm-only", 10, true, { clients: ["dm"] }),
      entry("switch", 20, true, { toggle: { key: "sw", label: "Sw", layer: "objects" } }),
    ]);
    asked.length = 0;
    expect(layerMenuAt(layers, { x: 0, y: 0 }, ctx("player"))?.id).toBe("switch");
    expect(layerMenuAt(layers, { x: 0, y: 0 }, ctx("dm", { sw: true }))?.id).toBe("dm-only");
    expect(asked).toEqual(["switch", "dm-only"]);
  });

  test("FR-SCN-51 contextMenu hook: scn-templates and vfx-under (players' affected cells, FR-VFX-23) have a menu", () => {
    expect(canvasLayers.filter((l) => l.contextMenu).map((l) => l.id)).toEqual([
      "scn-templates",
      "vfx-under",
    ]);
  });
});
