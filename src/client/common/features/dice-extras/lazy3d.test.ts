// FR-DICEX-21 / -22: the 3D chunk loads only for a 3D throw; flat / off never ask for it; a
// load failure → flat for the session with one warning; a throw draws 3D only once it's ready.
import { describe, expect, test } from "bun:test";
import type { GameLogEntryView } from "@shared/dice-roll-log/schemas";
import { emptyStore } from "@shared/protocol/store";
import { onRollFrame } from "./frame-handler";
import { createChunkLoader, type Dice3DModule, threeDUnavailable, throwDraw } from "./lazy3d";
import { DEFAULT_SETTINGS, effectiveRender, type RenderSetting } from "./settings";

const entry = (o: Partial<GameLogEntryView> = {}) =>
  ({
    id: "e1",
    n: 5,
    kind: "roll",
    public: true,
    rollerRole: "player",
    rollerPlayerId: "p1",
    actorName: "Mira",
    payload: [
      {
        expression: "1d20",
        manual: false,
        dice: [{ faces: 20, value: 14, kept: true }],
        constant: 0,
        total: 14,
        label: null,
      },
    ],
    ...o,
  }) as unknown as GameLogEntryView;

function frame(render: RenderSetting, others = true) {
  const calls = { load: 0, play: 0, own: 0 };
  const store = { ...emptyStore(), you: { campaignId: "c1", role: "player", playerId: "p1" } };
  onRollFrame(
    [entry()],
    store as never,
    { settings: { ...DEFAULT_SETTINGS, others }, render },
    {
      load3d: () => {
        calls.load += 1;
      },
      play: () => {
        calls.play += 1;
      },
      ownRolled: () => {
        calls.own += 1;
      },
    },
  );
  return calls;
}

describe("FR-DICEX-22 lazy chunk", () => {
  test("FR-DICEX-22 flat / off never load the 3D chunk; 3d asks on the throw", () => {
    expect(frame("flat")).toEqual({ load: 0, play: 1, own: 1 });
    expect(frame("off")).toEqual({ load: 0, play: 0, own: 1 });
    expect(frame("3d")).toEqual({ load: 1, play: 1, own: 1 });
  });

  test("FR-DICEX-21 reduced motion / no WebGL → flat, so the chunk is never asked for", () => {
    const r1 = effectiveRender("3d", { reducedMotion: true, threeD: true });
    const r2 = effectiveRender("3d", { reducedMotion: false, threeD: false });
    expect([r1, r2]).toEqual(["flat", "flat"]);
    expect(frame(r1).load).toBe(0);
  });

  test("FR-DICEX-22 loads once; the throw that started the load is flat, the next one 3D", async () => {
    let imports = 0;
    const mod = {} as Dice3DModule;
    const loader = createChunkLoader(async () => {
      imports += 1;
      return mod;
    });
    expect(throwDraw("3d", loader.state())).toBe("flat");
    loader.load();
    loader.load();
    expect(loader.state()).toBe("loading");
    expect(throwDraw("3d", loader.state())).toBe("flat");
    await Promise.resolve();
    await Promise.resolve();
    expect(imports).toBe(1);
    expect(loader.state()).toBe("ready");
    expect(loader.module()).toBe(mod);
    expect(throwDraw("3d", loader.state())).toBe("3d");
    expect(throwDraw("flat", loader.state())).toBe("flat");
  });

  test("FR-DICEX-22 load failure → flat for the session + one console warning", async () => {
    const warnings: string[] = [];
    const loader = createChunkLoader(
      () => Promise.reject(new Error("chunk 404")),
      (m) => warnings.push(m),
    );
    loader.load();
    await new Promise((r) => setTimeout(r, 0));
    loader.load();
    await new Promise((r) => setTimeout(r, 0));
    expect(loader.state()).toBe("failed");
    expect(warnings).toHaveLength(1);
    expect(threeDUnavailable(loader.state(), true)).toBe("failed");
    expect(threeDUnavailable("ready", false)).toBe("no-webgl");
    expect(threeDUnavailable("idle", true)).toBeNull();
    // `threeD` false → the setting's `3d` draws flat.
    expect(effectiveRender("3d", { reducedMotion: false, threeD: false })).toBe("flat");
  });
});
