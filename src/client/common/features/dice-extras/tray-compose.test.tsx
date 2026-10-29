// Tray attacks S2 (FR-DICEX-97, -99–104; ADR-0073): the editable `adjust`, the purpose toggle,
// die groups, the crit badge and the tray routes. Static server render over a fake sync store, as
// `routing.test.tsx`; the roll paths through the exported pure helpers.
import { afterEach, describe, expect, test } from "bun:test";
import type { StagedPart } from "@shared/dice-roll-log/schemas";
import { emptyStore, type RecordStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import {
  type RollControl,
  type RollControlOptions,
  type RollRequest,
  useRollControl,
} from "../dice-roll-log/roll-control";
import { notationRequest } from "./DiceText";
import { diceExtras, type TrayRequest } from "./store";
import {
  CRIT_BADGE,
  freeRollIntent,
  type StagedRoll,
  sendFreeRoll,
  TrayWindow,
  trayControlOptions,
} from "./TrayWindow";
import {
  compositionOf,
  joinDie,
  partSlotLabels,
  setGroupType,
  stagedPartsOf,
  type TrayPurpose,
} from "./tray-parts";
import { trayRoutes } from "./tray-routes";
import type { TrayRoute } from "./tray-routing";

/** A started fight: Brakka (player-1's PC), the Goblin (DM's). */
function fight(role: "dm" | "player" = "player"): RecordStore {
  return {
    ...emptyStore(),
    you: { campaignId: "c1", role, playerId: role === "dm" ? null : "p1" },
    records: {
      entity: {
        brakka: { id: "brakka", kind: "character", name: "Brakka", ownerPlayerId: "p1" },
      },
      encounter: { e1: { id: "e1", status: "started", round: 1 } },
      combatant: {
        "cb-brakka": {
          id: "cb-brakka",
          encounterId: "e1",
          kind: "pc",
          entityId: "brakka",
          tokenId: "t-brakka",
          name: "Brakka",
          removed: false,
        },
      },
    },
  };
}

function render(node: React.ReactNode, store: RecordStore = fight()) {
  const sync = createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store,
        notLiveSince: null,
        everLive: true,
        connection: { sendIntent: () => Promise.resolve({}) },
      }) as unknown as SyncState,
  );
  return renderToStaticMarkup(
    <SyncContext.Provider value={sync}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        {node}
      </TooltipProvider>
    </SyncContext.Provider>,
  );
}

const staged = (purpose: Exclude<TrayPurpose, "plain">, parts: StagedPart[], crit = false) =>
  ({ purpose, parts, slotLabels: parts.map(() => null), crit }) satisfies StagedRoll;

/** Guiding Bolt's Damage control (S3 sets `purpose` on the sheet's buttons). */
const guidingBolt = (got: RollRequest[], crit = false): RollControlOptions => ({
  expressions: ["4d6"],
  category: "damage",
  label: "Mira — Guiding Bolt damage",
  purpose: "damage",
  partTypes: ["radiant"],
  ...(crit ? { crit: true, critExpressions: ["8d6"] } : {}),
  onRoll: (r) => got.push(r),
});

const sent: { name: string; payload: unknown }[] = [];
const send = (name: string, payload: unknown) => {
  sent.push({ name, payload });
  return Promise.resolve({});
};
const routes = [...trayRoutes];
afterEach(() => {
  diceExtras.failed();
  diceExtras.clear();
  trayRoutes.splice(0, trayRoutes.length, ...routes);
  sent.length = 0;
});

describe("FR-DICEX-97 editable adjust", () => {
  test("FR-DICEX-97 edit a staged attack", () => {
    const got: RollRequest[] = [];
    const options = guidingBolt(got);
    const comp = joinDie(compositionOf(options.expressions, "damage", ["radiant"]), 6, "damage");
    const request: TrayRequest = { kind: "control", options, mode: "normal", edit: comp };
    const parts = stagedPartsOf(comp, "damage");
    expect(parts).toEqual([{ expression: "5d6", type: "radiant" }]);
    const tray = trayControlOptions(request, "", "normal", () => {}, staged("damage", parts));
    expect(tray.expressions).toEqual(["5d6"]);
    tray.onRoll({ mode: "normal" });
    expect(got).toEqual([{ mode: "normal", parts: [{ expression: "5d6", type: "radiant" }] }]);
    // The tray's own control rolls (never stages again), Shift → advantage.
    let control: RollControl | null = null;
    function Probe() {
      control = useRollControl(tray, { tray: true });
      return null;
    }
    render(<Probe />);
    (control as RollControl | null)?.roll({ shiftKey: true });
    expect(got[1]).toEqual({
      mode: "advantage",
      parts: [{ expression: "5d6", type: "radiant" }],
    });
    // The tray shows it editable: the palette, die buttons, a type per group, the constant.
    diceExtras.stage(request);
    const html = render(<TrayWindow />);
    expect(html).toContain('data-testid="dicex-tray-state" data-value="adjust"');
    expect(html).toContain('data-testid="dicex-tray-palette"');
    expect(html).toContain('data-testid="dicex-tray-constant"');
    expect(html).not.toContain('data-testid="dicex-tray-expression"');
    expect(html).toMatch(/data-testid="dicex-tray-group-type"[^>]*data-record-id="6:radiant"/);
    expect(html.match(/<button[^>]*data-testid="dicex-tray-die"/g)).toHaveLength(5);
  });

  test("FR-DICEX-97 other controls stay read-only", () => {
    const got: RollRequest[] = [];
    const options: RollControlOptions = {
      expressions: ["1d20+5"],
      category: "saving-throw",
      label: "Mira — Dexterity save",
      onRoll: (r) => got.push(r),
    };
    diceExtras.stage({ kind: "control", options, mode: "normal" });
    const html = render(<TrayWindow />);
    expect(html).not.toContain('data-testid="dicex-tray-palette"');
    expect(html).not.toContain('data-testid="dicex-tray-purpose"');
    expect(html).not.toMatch(/<button[^>]*data-testid="dicex-tray-die"/);
    const tray = trayControlOptions(
      { kind: "control", options, mode: "normal" },
      "",
      "normal",
      () => {},
    );
    tray.onRoll({ mode: "normal" });
    expect(got).toEqual([{ mode: "normal" }]); // no `parts`
  });

  test("FR-DICEX-97 the attack's d20 is locked", () => {
    diceExtras.stage({
      kind: "control",
      options: {
        expressions: ["1d20+9"],
        category: "attack",
        purpose: "attack",
        onRoll() {},
      },
      mode: "normal",
    });
    const html = render(<TrayWindow />);
    expect(html).toMatch(
      /<span[^>]*data-testid="dicex-tray-die"[^>]*data-locked="true"[^>]*title="An attack needs its d20"/,
    );
    expect(html).toContain('data-testid="dicex-tray-purpose" data-value="attack"');
  });
});

describe("FR-DICEX-99 purpose toggle", () => {
  test("FR-DICEX-99 purpose toggle", () => {
    // Free requests start Plain; Attack needs one d20.
    diceExtras.stage({ kind: "free", expression: "1d20+9", mode: "normal", category: "other" });
    let html = render(<TrayWindow />);
    expect(html).toContain('data-testid="dicex-tray-purpose" data-value="plain"');
    diceExtras.stage({
      kind: "free",
      expression: "2d20",
      mode: "normal",
      category: "other",
      purpose: "attack",
    });
    html = render(<TrayWindow />);
    expect(html).toContain('data-testid="dicex-tray-issue"');
    expect(html).toContain("An attack needs one d20");
    expect(html).toMatch(/data-testid="dicex-tray-roll"[^>]*disabled/);
    // Damage: a type per group; the purpose presets the category; unclaimed → dice.roll.
    const free = {
      kind: "free" as const,
      expression: "2d6+1d8",
      mode: "normal" as const,
      category: "other" as const,
      purpose: "damage" as const,
      types: ["slashing" as const, "fire" as const],
    };
    diceExtras.stage(free);
    html = render(<TrayWindow />);
    expect(html).toMatch(/data-record-id="6:slashing"/);
    expect(html).toMatch(/data-record-id="8:fire"/);
    const parts = [
      { expression: "2d6", type: "slashing" as const },
      { expression: "1d8", type: "fire" as const },
    ];
    expect(freeRollIntent(free, "2d6+1d8", { mode: "normal" }, staged("damage", parts))).toEqual({
      mode: "normal",
      category: "damage",
      purpose: "damage",
      parts,
    });
    const atk = { ...free, expression: "1d20+5", purpose: "attack" as const, types: undefined };
    expect(
      freeRollIntent(
        atk,
        "1d20+5",
        { mode: "advantage" },
        staged("attack", [{ expression: "1d20+5" }]),
      ),
    ).toEqual({ mode: "advantage", category: "attack", purpose: "attack", expression: "1d20+5" });
    // Plain: as today.
    const plain = {
      kind: "free" as const,
      expression: "1d20+5",
      mode: "normal" as const,
      category: "other" as const,
    };
    expect(freeRollIntent(plain, "1d20+5", { mode: "normal" }, null)).toEqual({
      mode: "normal",
      category: "other",
      expression: "1d20+5",
    });
    // A physical unclaimed damage roll: one untyped expression, one entry (#388).
    expect(
      freeRollIntent(
        free,
        "2d6+1d8",
        {
          mode: "normal",
          manual: [
            { diceTotal: 7, dice: [3, 4] },
            { diceTotal: 5, dice: [5] },
          ],
        },
        staged("damage", parts),
      ),
    ).toMatchObject({ expression: "2d6+1d8", manual: { diceTotal: 12, dice: [3, 4, 5] } });
  });
});

describe("FR-DICEX-100 crit badge", () => {
  test("FR-DICEX-100 crit badge", () => {
    const got: RollRequest[] = [];
    diceExtras.stage({ kind: "control", options: guidingBolt(got, true), mode: "normal" });
    const html = render(<TrayWindow />);
    expect(html).toContain('data-testid="dicex-tray-crit"');
    expect(html).toContain(CRIT_BADGE);
    // The dice as entered (4 d6), never the doubled ones.
    expect(html.match(/data-testid="dicex-tray-die"/g)).toHaveLength(4);
    // The physical form's extra critical dice come from the edited parts.
    const comp = joinDie(compositionOf(["4d6"], "damage", ["radiant"]), 6, "damage");
    const tray = trayControlOptions(
      { kind: "control", options: guidingBolt(got, true), mode: "normal", edit: comp },
      "",
      "normal",
      () => {},
      staged("damage", stagedPartsOf(comp, "damage"), true),
    );
    expect(tray.crit).toBe(true);
    expect(tray.critExpressions).toEqual(["10d6"]);
    // A route's claim says crit: the free Damage shows the badge too (FR-CBT-172's test).
    trayRoutes.splice(0, trayRoutes.length, {
      key: "crit",
      order: 0,
      claim: () => ({ crit: true, send: () => Promise.resolve({}) }),
    });
    diceExtras.stage({
      kind: "free",
      expression: "2d6",
      mode: "normal",
      category: "other",
      purpose: "damage",
      types: ["slashing"],
    });
    expect(render(<TrayWindow />)).toContain(CRIT_BADGE);
  });
});

describe("FR-DICEX-102 tray routes", () => {
  test("FR-DICEX-102 tray routes", async () => {
    const calls: string[] = [];
    const stub: TrayRoute = {
      key: "stub",
      order: 1,
      claim: (_store, req) =>
        req.actor && "entityId" in req.actor && req.actor.entityId === "x"
          ? {
              crit: true,
              send: (s, parts, roll) => {
                calls.push(`${parts[0]?.expression}/${roll.mode}`);
                return s("stub.send", {});
              },
            }
          : null,
    };
    const throwing: TrayRoute = {
      key: "bad",
      order: 0,
      claim: () => {
        throw new Error("boom");
      },
    };
    trayRoutes.splice(0, trayRoutes.length, throwing, stub);
    const free = {
      kind: "free" as const,
      expression: "1d20+9",
      mode: "normal" as const,
      category: "other" as const,
      purpose: "attack" as const,
      actor: { entityId: "x" },
    };
    const atk = staged("attack", [{ expression: "1d20+9" }]);
    const base = {
      routes: trayRoutes,
      store: fight(),
      draft: "1d20+9",
      mode: "normal" as const,
      send,
    };
    await sendFreeRoll({ ...base, free, roll: { mode: "advantage" }, staged: atk });
    expect(calls).toEqual(["1d20+9/advantage"]);
    expect(sent.map((s) => s.name)).toEqual(["stub.send"]); // never dice.roll
    // Unclaimed (another actor) → dice.roll {purpose}.
    sent.length = 0;
    await sendFreeRoll({
      ...base,
      free: { ...free, actor: { entityId: "y" } },
      roll: { mode: "normal" },
      staged: atk,
    });
    expect(sent).toEqual([
      {
        name: "dice.roll",
        payload: {
          mode: "normal",
          category: "attack",
          actor: { entityId: "y" },
          purpose: "attack",
          expression: "1d20+9",
        },
      },
    ]);
    // Plain never asks the routes.
    sent.length = 0;
    const { purpose: _p, ...plain } = free;
    await sendFreeRoll({ ...base, free: plain, roll: { mode: "normal" }, staged: null });
    expect(sent[0]?.name).toBe("dice.roll");
  });
});

describe("FR-DICEX-103 notation can feed an attack", () => {
  test("FR-DICEX-103 notation as damage", async () => {
    // "2d6 fire" in a feature text stages Plain; the toggle → Damage, its group → fire.
    const request = notationRequest("2d6", { label: "Searing Smite" }, {}, undefined);
    if (request.kind !== "free") throw new Error("free");
    expect(request.purpose).toBeUndefined();
    let comp = compositionOf([request.expression], "damage");
    comp = setGroupType(comp, 0, "fire");
    const parts = stagedPartsOf(comp, "damage");
    const free = { ...request, purpose: "damage" as const, actor: { entityId: "brakka" } };
    await sendFreeRoll({
      routes: trayRoutes,
      store: fight(),
      free,
      draft: "2d6",
      mode: "normal",
      roll: { mode: "normal" },
      staged: { ...staged("damage", parts), slotLabels: partSlotLabels(comp, "damage") },
      send,
    });
    expect(sent).toEqual([
      {
        name: "cbt.rollDamage",
        payload: {
          attackerId: "cb-brakka",
          parts: [{ expression: "2d6", type: "fire" }],
          rowless: true,
          label: "Searing Smite",
        },
      },
    ]);
  });
});

describe("FR-DICEX-104 failures", () => {
  test("FR-DICEX-104 reject keeps edits", () => {
    const got: RollRequest[] = [];
    const options = guidingBolt(got);
    const edit = joinDie(compositionOf(["4d6"], "damage", ["radiant"]), 8, "damage");
    diceExtras.stage({ kind: "control", options, mode: "normal", edit });
    diceExtras.sent(true);
    diceExtras.failed(); // the caller's intent was rejected
    const req = diceExtras.api.getState().request;
    expect(req?.kind === "control" && req.edit).toEqual(edit);
    expect(diceExtras.api.getState().rolling).toBe(false);
    // Staging works offline; Roll needs `live`.
    diceExtras.stage({ kind: "free", expression: "1d6", mode: "normal", category: "other" });
    const offline = createStore<SyncState>()(
      () =>
        ({
          state: "reconnecting",
          store: fight(),
          notLiveSince: 1,
          everLive: true,
          connection: { sendIntent: () => Promise.resolve({}) },
        }) as unknown as SyncState,
    );
    const html = renderToStaticMarkup(
      <SyncContext.Provider value={offline}>
        <TooltipProvider delayDuration={0} skipDelayDuration={0}>
          <TrayWindow />
        </TooltipProvider>
      </SyncContext.Provider>,
    );
    expect(html).toContain('data-value="compose"');
    expect(html).toMatch(/data-testid="dicex-tray-roll"[^>]*disabled/);
  });
});
