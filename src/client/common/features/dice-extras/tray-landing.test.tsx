// The tray's sprint-5 rules (DICEX §13 unit): its held result (FR-DICEX-49, table E) and the label
// reset (FR-DICEX-50, table F). Static server render over a fake sync store, as
// `routing.test.tsx`; an edit applies `editStartsFresh` + `editRequest` as the tray's handlers do.
import { afterEach, describe, expect, test } from "bun:test";
import type { GameLogEntryView } from "@shared/dice-roll-log/schemas";
import { emptyStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { notationRequest } from "./DiceText";
import { landing } from "./landing";
import { diceExtras, type TrayRequest } from "./store";
import { TrayWindow, trayControlOptions } from "./TrayWindow";
import {
  addDie,
  editRequest,
  editStartsFresh,
  notationOf,
  setConstant,
  termsOf,
} from "./tray-logic";

function render() {
  const you = { campaignId: "c1", role: "player", playerId: "p1" };
  const entities = { mira: { id: "mira", kind: "character", name: "Mira", ownerPlayerId: "p1" } };
  const sync = createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store: { ...emptyStore(), you, records: { entity: entities } },
        notLiveSince: null,
        everLive: true,
        connection: { sendIntent: () => Promise.resolve({}) },
      }) as unknown as SyncState,
  );
  return renderToStaticMarkup(
    <SyncContext.Provider value={sync}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        <TrayWindow />
      </TooltipProvider>
    </SyncContext.Provider>,
  );
}

const rolled = (o: Partial<GameLogEntryView> = {}) =>
  ({
    id: "e1",
    n: 7,
    at: "2026-10-19T10:00:00.000Z",
    kind: "roll",
    category: "other",
    public: true,
    undone: false,
    rollerRole: "player",
    rollerPlayerId: "p1",
    actorName: "Mira",
    payload: [
      {
        rollId: "r1",
        expression: "1d12+5",
        mode: "normal",
        manual: false,
        dice: [{ faces: 12, value: 9, kept: true }],
        constant: 5,
        total: 14,
        natural: null,
        label: "Notation test",
      },
    ],
    ...o,
  }) as unknown as GameLogEntryView;

/** Mira's "Notation test" link: 1d12 + 5 (walkthrough step 35). */
const NOTATION = notationRequest("1d12+5", { label: "Notation test" }, {}, { entityId: "mira" });

/** Roll the staged request and get its entry back (`result`). */
function rollToResult(entry = rolled()) {
  diceExtras.sent(true);
  diceExtras.ownRolled([entry]);
}

/** What the tray's palette / expression / constant handlers do with an edit. */
function edit(expression: string) {
  const s = diceExtras.api.getState();
  const state = s.result ? "result" : s.request ? "compose" : "idle";
  const request = s.request;
  const free = request?.kind === "free" ? request : null;
  const fresh = editStartsFresh(state, request?.kind ?? null);
  const next = editRequest(free, expression, s.mode, fresh);
  diceExtras.api.setState({ request: { kind: "free", ...next }, result: null });
}

const header = (html: string) =>
  /data-testid="dicex-tray-state" data-value="(\w+)"[^>]*>([^<]*)</.exec(html)?.slice(1);
const freeRequest = () =>
  diceExtras.api.getState().request as Extract<TrayRequest, { kind: "free" }>;

afterEach(() => {
  diceExtras.failed();
  diceExtras.clear();
  landing.api.setState({ holding: new Map() });
});

describe("FR-DICEX-50 label reset", () => {
  test("FR-DICEX-50 label reset: notation → result → palette d6 → no label / actor, category other, header 'Other'", () => {
    diceExtras.stage(NOTATION);
    expect(header(render())).toEqual(["compose", "Mira — Notation test"]);
    rollToResult();
    const html = render();
    expect(header(html)).toEqual(["result", "Last roll"]);
    // The inputs stay in `result`, so typing after a result is a path (table F).
    expect(html).toContain('data-testid="dicex-tray-expression"');
    expect(html).toContain('data-testid="dicex-tray-constant"');

    edit(notationOf(addDie([], 6)));
    expect(diceExtras.api.getState().request).toEqual({
      kind: "free",
      expression: "1d6",
      mode: "normal",
      category: "other",
    });
    const after = render();
    expect(header(after)).toEqual(["compose", "Other"]);
    expect(after).not.toContain("Notation test");
    // Roll → "Player 1 — 1d6 …": the intent carries no label and no actor.
    const opts = trayControlOptions(freeRequest(), "1d6", "normal", () => {});
    expect(opts.label).toBe("Other");
  });

  test("FR-DICEX-50 label reset: the same after typing in the expression input and after editing the constant", () => {
    diceExtras.stage(NOTATION);
    rollToResult();
    edit("2d8");
    expect(freeRequest()).toEqual({
      kind: "free",
      expression: "2d8",
      mode: "normal",
      category: "other",
    });

    diceExtras.stage(NOTATION);
    rollToResult();
    edit(notationOf(setConstant(termsOf("1d12+5") ?? [], 3)));
    expect(freeRequest()).toEqual({
      kind: "free",
      expression: "1d12+3",
      mode: "normal",
      category: "other",
    });
    expect(header(render())).toEqual(["compose", "Other"]);
  });

  test("FR-DICEX-50 label reset: 'Roll again' keeps the label; Clear → idle, nothing kept", () => {
    diceExtras.stage(NOTATION);
    rollToResult();
    expect(render()).toContain('data-testid="dicex-tray-again"');
    // Roll again re-sends the staged request as it is.
    const again = trayControlOptions(
      diceExtras.api.getState().request,
      "1d12+5",
      "normal",
      () => {},
    );
    expect(again.label).toBe("Notation test");
    rollToResult();
    expect(freeRequest().label).toBe("Notation test");
    expect(freeRequest().actor).toEqual({ entityId: "mira" });

    diceExtras.clear();
    const s = diceExtras.api.getState();
    expect([s.request, s.result]).toEqual([null, null]);
    expect(header(render())?.[0]).toBe("idle");
  });

  test("FR-DICEX-50 label reset: a notation link or the roll bar after a result → that source's own request", () => {
    diceExtras.stage(NOTATION);
    rollToResult();
    diceExtras.stage(notationRequest("2d4+2", { label: "Potion of Healing" }, {}, undefined));
    expect(freeRequest()).toMatchObject({ expression: "2d4+2", label: "Potion of Healing" });
    expect(diceExtras.api.getState().result).toBeNull();

    rollToResult();
    // The roll bar's tray Button / Alt+click Roll stage `free` from the bar's own fields.
    diceExtras.stage({ kind: "free", expression: "1d20", mode: "normal", category: "skill-check" });
    expect(freeRequest()).toEqual({
      kind: "free",
      expression: "1d20",
      mode: "normal",
      category: "skill-check",
    });
  });

  test("FR-DICEX-50 label reset: adding or removing a die while composing keeps the staged label", () => {
    diceExtras.stage(NOTATION);
    expect(editStartsFresh("compose", "free")).toBe(false);
    edit(notationOf(addDie(termsOf("1d12+5") ?? [], 6)));
    expect(freeRequest()).toMatchObject({ expression: "1d12+1d6+5", label: "Notation test" });
    expect(header(render())).toEqual(["compose", "Mira — Notation test"]);
    // Over an `adjust` result or an empty tray an edit always starts fresh.
    expect(editStartsFresh("adjust", "control")).toBe(true);
    expect(editStartsFresh("idle", null)).toBe(true);
  });
});

describe("FR-DICEX-49 tray result held", () => {
  test("FR-DICEX-49 total hidden until landed: tray blank die shapes, total and line '…'; at the landing the numbers", () => {
    diceExtras.stage(NOTATION);
    rollToResult();
    landing.api.setState({ holding: new Map([["e1", 6000]]) });
    let html = render();
    expect(html).toMatch(/data-testid="dicex-tray-total" data-landed="false"[^>]*>…</);
    expect(html).not.toMatch(/data-testid="dicex-result-die"[^>]*data-value=/);
    expect(html).not.toMatch(/data-testid="dicex-die"[^>]*data-value=/);
    expect(html).toContain("Mira — Notation test: … + 5 = …");
    expect(html).not.toContain(">14<");

    landing.api.setState({ holding: new Map() });
    html = render();
    expect(html).toMatch(/data-testid="dicex-tray-total" data-landed="true"[^>]*>14</);
    expect(html).toMatch(/data-testid="dicex-result-die"[^>]*data-value="9"/);
    expect(html).toContain("Mira — Notation test: 9 + 5 = 14");
  });
});
