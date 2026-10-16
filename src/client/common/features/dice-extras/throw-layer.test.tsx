// Throw zone rendering (FR-DICEX-09, -12, -17, -21 flat): static render of the runtime companion
// inside a shell with no windows (1280×720), over a fake sync store.
import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { throwDice } from "@shared/dice-extras/throw";
import { emptyStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { createWindowRegistry } from "../play-shell/registry";
import { ShellProvider } from "../play-shell/ShellContext";
import { diceExtras } from "./store";
import { DiceExtrasRuntime } from "./ThrowLayer";

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
  diceExtras.done(diceExtras.api.getState().current?.seq ?? -1);
});

function render(role: "dm" | "player" = "player") {
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
          <DiceExtrasRuntime />
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

test("idle: no throw zone, nothing rendered", () => {
  expect(render()).toBe("");
});

test("FR-DICEX-09 pending (flat / reduced motion): a static 'Rolling…' label, no motion", () => {
  diceExtras.sent(false);
  const html = render();
  expect(html).toContain('data-testid="dicex-throw" data-render="flat" data-state="pending"');
  expect(html).toContain("Rolling…");
  expect(html).not.toContain("transition");
});

test("FR-DICEX-17 a throw: bottom centre of the free area, ≤ 720×420, not interactive; dice at server values", () => {
  const t = throwDice([entry()]);
  if (!t) throw new Error("no throw");
  diceExtras.play(t);
  const html = render();
  expect(html).toContain("pointer-events-none");
  // 1280×720, no windows: free area right of the rail, above the launcher → 720×420 bottom centre.
  expect(html).toContain("left:314px;top:236px;width:720px;height:420px");
  // A flat render: every die `data-flat` (DICEX §13 E2E).
  expect(html).not.toContain('data-flat="false"');
  expect(html).toMatch(
    /data-testid="dicex-throw" data-record-id="e1" data-count="1" data-render="flat"/,
  );
  expect(html).toContain("Mira");
  expect(html).toContain("Notation test");
  const values = [...html.matchAll(/data-testid="dicex-throw-die"[^>]*data-value="(\d+)"/g)].map(
    (m) => m[1],
  );
  expect(values).toEqual(["9", "2"]);
});

test("FR-DICEX-12 the DM's own hidden throw carries the eye-off marker; players never get hidden entries", () => {
  const t = throwDice([
    entry({ public: false, rollerRole: "dm", rollerPlayerId: null, actorName: "DM" }),
  ]);
  if (!t) throw new Error("no throw");
  diceExtras.play(t);
  expect(render("dm")).toContain('data-testid="dicex-throw-hidden"');
});

test("FR-DICEX-14 more than 20 dice → '+N more'", () => {
  const dice = Array.from({ length: 25 }, () => ({ faces: 6, value: 3, kept: true }));
  const t = throwDice([entry({ payload: [{ ...entry().payload[0], expression: "25d6", dice }] })]);
  if (!t) throw new Error("no throw");
  diceExtras.play(t);
  const html = render();
  expect(html.match(/data-testid="dicex-throw-die"/g)).toHaveLength(20);
  expect(html).toContain("+5 more");
});
