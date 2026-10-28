// spell-fx client core (VFX §6.3–6.4): the hit cue subscriber (FR-VFX-21, -22), the layer
// entries (FR-VFX-13), the empty registries' contracts (FR-VFX-18, OQ-VFX-06 A).
import { describe, expect, spyOn, test } from "bun:test";
import type { ServerSignalFrame } from "@shared/protocol/frames";
import { HIT_LOOK_KEYS, type HitCue, VFX_HIT_SIGNAL } from "@shared/spell-fx/cue";
import type { SignalHandler } from "../../sync/connection";
import { spellRowActions } from "../character-sheet/spell-row-actions";
import { canvasLayers } from "../scenes-map/canvas-layers";
import { LAYER_ORDER } from "../scenes-map/layers";
import { subscribeHitCues } from "./cues";
import { hitLooks } from "./hit-looks";

const cue: HitCue = {
  id: "h1",
  targetTokenId: "t1",
  attackerTokenId: "t2",
  kind: "damage",
  parts: [{ type: "fire", value: 7 }],
  multiplier: "normal",
  crit: false,
};
const frame = (name: string, data: unknown): ServerSignalFrame => ({
  type: "signal",
  name,
  data,
  from: { role: "dm" },
});

function fakeConnection() {
  const handlers = new Set<SignalHandler>();
  return {
    onSignal(fn: SignalHandler) {
      handlers.add(fn);
      return () => handlers.delete(fn);
    },
    deliver: (f: ServerSignalFrame) => {
      for (const h of handlers) h(f);
    },
  };
}

describe("hit cue subscriber (FR-VFX-21, -22)", () => {
  test("FR-VFX-21 subscribers get each well-formed vfx.hit; other signals and bad cues are dropped", () => {
    const c = fakeConnection();
    const got: HitCue[] = [];
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const off = subscribeHitCues(c, (x) => got.push(x));
    c.deliver(frame(VFX_HIT_SIGNAL, cue));
    c.deliver(frame("map.ping", { x: 1 }));
    c.deliver(frame(VFX_HIT_SIGNAL, { ...cue, parts: "lots" }));
    expect(got).toEqual([cue]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    off();
    c.deliver(frame(VFX_HIT_SIGNAL, cue));
    expect(got).toHaveLength(1);
  });

  test("FR-VFX-22 arrival only: a cue sent before subscribing is never replayed", () => {
    const c = fakeConnection();
    c.deliver(frame(VFX_HIT_SIGNAL, cue));
    const got: HitCue[] = [];
    subscribeHitCues(c, (x) => got.push(x));
    expect(got).toEqual([]);
  });
});

describe("layers and registries (FR-VFX-13, -18, OQ-VFX-06)", () => {
  test("FR-VFX-13 vfx-under 38 and vfx-over 43 on `objects`, around tokens, below labels", () => {
    const under = canvasLayers.find((l) => l.id === "vfx-under");
    const over = canvasLayers.find((l) => l.id === "vfx-over");
    expect(under).toMatchObject({ order: 38, layer: "objects" });
    expect(over).toMatchObject({ order: 43, layer: "objects" });
    expect(LAYER_ORDER.vfxUnder).toBeLessThan(LAYER_ORDER.tokens);
    expect(LAYER_ORDER.vfxUnder).toBeGreaterThan(LAYER_ORDER.scnTemplates);
    expect(LAYER_ORDER.vfxOver).toBeGreaterThan(LAYER_ORDER.tokens);
    expect(LAYER_ORDER.vfxOver).toBeLessThan(LAYER_ORDER.labels);
  });

  test("FR-VFX-18 hit look registry: known keys only, each 0.4–1.4 s (filled by the build slice)", () => {
    for (const [key, look] of Object.entries(hitLooks)) {
      expect(HIT_LOOK_KEYS as readonly string[]).toContain(key);
      expect(look?.key).toBe(key as never);
      expect(look?.duration).toBeGreaterThanOrEqual(0.4);
      expect(look?.duration).toBeLessThanOrEqual(1.4);
    }
  });

  test("OQ-VFX-06 spell-row actions registry: unique ids", () => {
    const ids = spellRowActions.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
