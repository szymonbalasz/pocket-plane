// Throw zone and dice layer rendering (FR-DICEX-09, -17, -18, -33, flat): static render of the
// runtime companion inside a shell with no windows (1280×720), over a fake sync store (no WebGL
// here, so the default `screen` display is effectively flat), and of the dice layer itself.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { throwDice } from "@shared/dice-extras/throw";
import { emptyStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { createWindowRegistry } from "../play-shell/registry";
import { ShellProvider } from "../play-shell/ShellContext";
import { DICE_LAYER_Z, DiceLayer, DiceLayerView, layerState } from "./DiceLayer";
import type { ThrowPlan } from "./display";
import { DEFAULT_SETTINGS } from "./settings";
import { diceExtras, type ThrowRun } from "./store";
import { DiceExtrasRuntime } from "./ThrowLayer";
import { ThrowViews } from "./ThrowViews";

/** Popups off: the zone shows its caption and total (FR-DICEX-17). */
const zoneFlat: ThrowPlan = { arena: "zone", draw: "flat", caption: true, handoff: false };

// The shell reads the viewport and its title marker takes `document`: stubs suffice for a static render.
const g = globalThis as { window?: unknown; document?: unknown };
beforeAll(() => {
  g.window = {
    innerWidth: 1280,
    innerHeight: 720,
    addEventListener() {},
    removeEventListener() {},
  };
  g.document = { title: "", hidden: false };
});
afterAll(() => {
  delete g.window;
  delete g.document;
});
afterEach(() => {
  diceExtras.failed();
  diceExtras.done(diceExtras.api.getState().leaving?.seq ?? -1);
  diceExtras.done(diceExtras.api.getState().current?.seq ?? -1);
});

/**
 * The runtime (`views` false) or the lazy throw views it mounts, with the effective display flat;
 * `popup` = the device's "Roll popups" setting.
 */
function render(role: "dm" | "player" = "player", views = true, popup = true) {
  const you = { campaignId: "c1", role, playerId: role === "dm" ? null : "p1" };
  const sync = createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store: { ...emptyStore(), you },
        notLiveSince: null,
        everLive: true,
        connection: { onEvent: () => () => {}, sendIntent: () => Promise.resolve({}) },
      }) as unknown as SyncState,
  );
  return renderToStaticMarkup(
    <SyncContext.Provider value={sync}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        <ShellProvider registry={createWindowRegistry(role, [])}>
          {views ? (
            <ThrowViews
              settings={{ ...DEFAULT_SETTINGS, popup }}
              display="flat"
              onSlow={() => {}}
            />
          ) : (
            <DiceExtrasRuntime />
          )}
        </ShellProvider>
      </TooltipProvider>
    </SyncContext.Provider>,
  );
}

const entry = (o: Record<string, unknown> = {}) => ({
  id: "e1",
  n: 1,
  kind: "roll",
  public: true,
  rollerRole: "player" as const,
  rollerPlayerId: "p1",
  actorName: "Mira",
  payload: [
    {
      rollId: "r1",
      expression: "1d12+1d6+6",
      mode: "normal",
      manual: false,
      dice: [
        { faces: 12, value: 9, kept: true },
        { faces: 6, value: 2, kept: true },
      ],
      constant: 6,
      total: 17,
      natural: null,
      label: "Notation test",
    },
  ],
  ...o,
});

test("idle: no throw zone, nothing rendered (the views chunk isn't even mounted)", () => {
  expect(render("player", false)).toBe("");
  expect(render()).toBe("");
});

test("FR-DICEX-09 pending (flat / reduced motion): popups on → nothing in the zone (the own popup's row); off → a static 'Rolling…' label, no motion", () => {
  diceExtras.sent(false);
  expect(render()).not.toContain("Rolling…");
  const html = render("player", true, false);
  expect(html).toContain('data-testid="dicex-throw" data-render="flat" data-state="pending"');
  expect(html).toContain("Rolling…");
  expect(html).not.toContain("transition");
});

test("FR-DICEX-17 a throw: bottom centre of the free area, ≤ 720×420, not interactive; dice at server values", () => {
  const t = throwDice([entry()]);
  if (!t) throw new Error("no throw");
  diceExtras.play(t, zoneFlat);
  const html = render();
  expect(html).toContain("pointer-events-none");
  // 1280×720, no windows: free area right of the rail, above the launcher → 720×420 bottom centre.
  expect(html).toContain("left:314px;top:236px;width:720px;height:420px");
  // A flat render: every die `data-flat` (DICEX §13 E2E).
  expect(html).not.toContain('data-flat="false"');
  expect(html).toMatch(
    /data-testid="dicex-throw" data-record-id="e1" data-count="1" data-render="flat" data-arena="zone"/,
  );
  expect(html).toContain("Mira");
  expect(html).toContain("Notation test");
  const values = [...html.matchAll(/data-testid="dicex-throw-die"[^>]*data-value="(\d+)"/g)].map(
    (m) => m[1],
  );
  expect(values).toEqual(["9", "2"]);
});

test("FR-DICEX-17 zone: no caption while popups are on (sim-7: it covered token labels)", () => {
  const t = throwDice([entry()]);
  if (!t) throw new Error("no throw");
  diceExtras.play(t, { ...zoneFlat, caption: false, handoff: true });
  const html = render();
  expect(html).toContain('data-testid="dicex-throw-die"');
  expect(html).not.toContain("Mira");
  expect(html).not.toContain("Notation test");
  expect(html).not.toContain('data-testid="dicex-throw-total"');
});

test("FR-DICEX-14 more than 20 dice → '+N more'", () => {
  const dice = Array.from({ length: 25 }, () => ({ faces: 6, value: 3, kept: true }));
  const t = throwDice([entry({ payload: [{ ...entry().payload[0], expression: "25d6", dice }] })]);
  if (!t) throw new Error("no throw");
  diceExtras.play(t, zoneFlat);
  const html = render();
  expect(html.match(/data-testid="dicex-throw-die"/g)).toHaveLength(20);
  expect(html).toContain("+5 more");
});

test("FR-DICEX-18 interrupt: an interrupted throw snaps to rest and fades", () => {
  const a = throwDice([entry()]);
  const b = throwDice([
    entry({
      id: "e2",
      n: 2,
      payload: [
        {
          ...entry().payload[0],
          rollId: "r2",
          expression: "2d8",
          dice: [
            { faces: 8, value: 7, kept: true },
            { faces: 8, value: 1, kept: true },
          ],
          constant: 0,
          total: 8,
        },
      ],
    }),
  ]);
  if (!a || !b) throw new Error("no throw");
  diceExtras.play(a, zoneFlat);
  const first = diceExtras.api.getState().current?.seq ?? -1;
  // A moving throw: no settled faces, no total yet.
  expect(render()).toMatch(/data-record-id="e1"[^>]*data-state="moving" data-interrupted="false"/);
  diceExtras.play(b, zoneFlat);
  const html = render();
  // The old throw stays, snapped to rest: settled faces = values, total shown, fading out.
  const old = html.match(/<div data-testid="dicex-throw" data-record-id="e1"[^>]*>/)?.[0] ?? "";
  expect(old).toContain('data-state="rest" data-interrupted="true"');
  expect(old).toContain("opacity-0");
  const settled = [
    ...html.matchAll(/data-entry-id="e1"[^>]*data-value="(\d+)"[^>]*data-settled="(\d+)"/g),
  ];
  expect(settled.map((m) => [m[1], m[2]])).toEqual([
    ["9", "9"],
    ["2", "2"],
  ]);
  expect(html).toContain("17");
  // The new one starts moving.
  expect(html).toMatch(/data-record-id="e2"[^>]*data-state="moving" data-interrupted="false"/);
  expect(html).not.toMatch(/data-entry-id="e2"[^>]*data-settled/);
  // The fade ends: only the new throw is left.
  diceExtras.done(first);
  const after = render();
  expect(after).not.toContain('data-record-id="e1"');
  expect(after).toContain('data-record-id="e2"');
});

const run = (o: Partial<ThrowRun> = {}): ThrowRun => {
  const t = throwDice([entry()]);
  if (!t) throw new Error("no throw");
  return {
    t,
    seq: 1,
    plan: { arena: "screen", draw: "3d", caption: false, handoff: true },
    phase: "moving",
    looks: {},
    ...o,
  };
};

const layer = (current: ThrowRun | null, leaving: ThrowRun | null = null) =>
  renderToStaticMarkup(
    <DiceLayerView
      current={current}
      leaving={leaving}
      chunk="ready"
      host={{ current: null }}
      onSlow={() => {}}
    />,
  );

describe("FR-DICEX-33 dice layer", () => {
  test("FR-DICEX-33 dice layer: fixed, full viewport, topmost, no input, aria-hidden, inert", () => {
    const html = layer(run());
    const el = html.match(/<div data-testid="dicex-screen"[^>]*>/)?.[0] ?? "";
    expect(el).toContain('data-state="moving"');
    expect(el).toContain('aria-hidden="true"');
    expect(el).toContain('inert=""');
    expect(el).toContain("pointer-events-none");
    expect(el).toContain("fixed inset-0");
    expect(el).toContain(`z-index:${DICE_LAYER_Z}`);
    // Above sonner's toaster (z 999,999,999), the alert flash (z-100) and dialogs (z-50).
    expect(DICE_LAYER_Z).toBe(2 ** 31 - 1);
    expect(DICE_LAYER_Z).toBeGreaterThan(999_999_999);
    // Nothing in it takes focus: no button, link, input or tabindex.
    expect(html).not.toMatch(/<(button|a|input|select|textarea)\b|tabindex/);
  });

  test("FR-DICEX-33 dice layer: portalled to document.body (no PlayFrame line)", () => {
    const body = { nodeType: 1 } as unknown as HTMLElement; // createPortal checks it
    const doc = globalThis.document as { body?: HTMLElement };
    doc.body = body;
    try {
      const portal = DiceLayer({
        current: null,
        leaving: null,
        chunk: "idle",
        host: { current: null },
        onSlow: () => {},
      }) as unknown as { containerInfo: unknown };
      expect(portal.containerInfo).toBe(body);
    } finally {
      delete doc.body;
    }
  });

  test("FR-DICEX-33 dice layer: dice only, no caption; the DOM mirror carries data-arena=screen", () => {
    const html = layer(run());
    expect(html).toMatch(
      /data-testid="dicex-throw" data-record-id="e1" data-count="1" data-render="3d" data-arena="screen" data-state="moving"/,
    );
    expect(html).not.toContain("Mira");
    expect(html).not.toContain("Notation test");
    expect(html).not.toContain(">17<");
    const values = [...html.matchAll(/data-testid="dicex-throw-die"[^>]*data-value="(\d+)"/g)];
    expect(values.map((m) => m[1])).toEqual(["9", "2"]);
  });

  test("FR-DICEX-33 dice layer: idle = no throw in it; data-state follows the runs", () => {
    const idle = layer(null);
    expect(idle).toContain('data-state="idle"');
    expect(idle).not.toContain('data-testid="dicex-throw"');
    // Zone runs draw their DOM in the zone (only their pixels go on the layer's canvas).
    const zone3d: ThrowPlan = { arena: "zone", draw: "3d", caption: false, handoff: true };
    expect(layer(run({ plan: zone3d }))).not.toContain('data-testid="dicex-throw"');
    expect(layerState([run({ phase: "rest" })])).toBe("rest");
    expect(layerState([run({ phase: "handoff" })])).toBe("handoff");
    expect(layerState([run({ phase: "handoff" }), run({ seq: 2 })])).toBe("moving");
    expect(layerState([run({ plan: zoneFlat })])).toBe("idle");
  });

  test("FR-DICEX-18 interrupt: the leaving screen run stays mounted at rest beside the new one", () => {
    const html = layer(run({ seq: 2, t: { ...run().t, id: "e2" } }), run({ phase: "handoff" }));
    expect(html).toMatch(/data-record-id="e1"[^>]*data-state="rest" data-interrupted="true"/);
    expect(html).toMatch(/data-record-id="e2"[^>]*data-state="moving" data-interrupted="false"/);
  });
});
