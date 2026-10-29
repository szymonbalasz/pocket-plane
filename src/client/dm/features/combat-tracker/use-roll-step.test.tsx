// Sprint 15 S4 (#385, CBT §13.8 T10–T13), DM client: the attack popup's "Use roll" step
// (FR-CBT-174) as static renders over an in-code store, its picks and Make card while not live
// (FR-CBT-176), popup-store's routing of the log action's request, and the crit hint on a card
// completed from a logged roll (OQ-CBT-104 A).
import { beforeEach, describe, expect, test } from "bun:test";
import { COMBATANT_TYPE, ENCOUNTER_TYPE } from "@shared/combat-tracker/schemas";
import {
  GAME_LOG_ENTRY_TYPE,
  type GameLogEntryView,
  type RollPayloadItem,
} from "@shared/dice-roll-log/schemas";
import { lazyAfterSnapshot } from "@shared/protocol/lazy";
import { emptyStore, type RecordStore } from "@shared/protocol/store";
import { TooltipProvider } from "@ui/components/ui/overlays";
import { useUseRollRequest } from "@ui/features/combat-tracker/use-roll-action";
import { SyncContext, type SyncState } from "@ui/sync/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { stepReady, USED_CRIT_HINT, UseRollStepBody, usedCritDamage } from "./attack-popup";
import { type UseRollStep, useCombatDialogs } from "./popup-store";

const item = (p: Partial<RollPayloadItem> = {}): RollPayloadItem => ({
  rollId: "r1",
  expression: "2d6",
  mode: "normal",
  manual: false,
  dice: [
    { faces: 6, value: 3, kept: true },
    { faces: 6, value: 4, kept: true },
  ],
  constant: 0,
  total: 7,
  natural: null,
  label: null,
  ...p,
});

const entry = (o: Partial<GameLogEntryView> = {}): GameLogEntryView => ({
  id: "e1",
  campaignId: "c1",
  n: 1,
  at: "2026-10-29T10:00:00.000Z",
  kind: "roll",
  category: "other",
  public: false,
  undone: false,
  rollerRole: "dm",
  rollerPlayerId: null,
  actorName: "DM",
  payload: [item()],
  rollIds: ["r1"],
  encounterId: null,
  supersededBy: null,
  ...o,
});

const fighter = (id: string, name: string, position: number) => ({
  id,
  encounterId: "enc",
  name,
  kind: "monster",
  entityId: null,
  tokenId: null,
  active: true,
  removed: false,
  position,
});

function store(entries: GameLogEntryView[]): RecordStore {
  return {
    ...emptyStore(),
    you: { campaignId: "c1", role: "dm", playerId: null },
    records: {
      [ENCOUNTER_TYPE]: { enc: { id: "enc", status: "started" } },
      [COMBATANT_TYPE]: Object.fromEntries(
        [
          fighter("cb-wolf", "Wolf", 1),
          fighter("cb-mira", "Mira", 3),
          fighter("cb-gob2", "Goblin 2", 5),
        ].map((c) => [c.id, c]),
      ),
      [GAME_LOG_ENTRY_TYPE]: Object.fromEntries(entries.map((e) => [e.id, e])),
    },
  } as unknown as RecordStore;
}

function render(step: UseRollStep, o: { entries?: GameLogEntryView[]; live?: boolean } = {}) {
  const sync = createStore<SyncState>()(
    () =>
      ({
        state: o.live === false ? "connecting" : "live",
        store: store(o.entries ?? [entry()]),
        notLiveSince: null,
        everLive: true,
        lazy: lazyAfterSnapshot(1),
        connection: { sendIntent: () => Promise.resolve({}) },
      }) as unknown as SyncState,
  );
  return renderToStaticMarkup(
    <SyncContext.Provider value={sync}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        <UseRollStepBody step={step} close={() => {}} />
      </TooltipProvider>
    </SyncContext.Provider>,
  );
}

const STEP: UseRollStep = { entryId: "e1", as: "damage", attackerId: null, types: {} };
const tag = (html: string, id: string) =>
  new RegExp(`<[a-z]+[^>]*data-testid="${id}"[^>]*>`).exec(html)?.[0] ?? "";

describe("FR-CBT-174 use roll step", () => {
  beforeEach(() => {
    useCombatDialogs.setState({ cardId: null, step: null });
    useUseRollRequest.setState({ open: null, n: 0 });
  });

  test("FR-CBT-174 use roll step: T10's DM 2d6 → the line, Attacker unset, one Type 'No type', Make card disabled until an attacker is picked", () => {
    const html = render(STEP);
    expect(html).toContain('data-testid="cbt-popup-step" data-value="use-roll"');
    expect(html).toContain(">Use as damage</h2>");
    expect(tag(html, "cbt-popup-use-line")).toContain('data-record-id="e1"');
    expect(html).toContain("DM");
    expect(tag(html, "cbt-popup-use-attacker")).toContain('data-value=""');
    expect(html).toContain("Pick the attacker");
    const types = html.match(/data-testid="cbt-popup-use-type"/g) ?? [];
    expect(types).toHaveLength(1);
    expect(tag(html, "cbt-popup-use-type")).toContain('data-record-id="r1"');
    expect(tag(html, "cbt-popup-use-type")).toContain('data-value="none"');
    expect(tag(html, "cbt-popup-use-confirm")).toContain('disabled=""');
    expect(tag(html, "cbt-popup-use-cancel")).not.toContain('disabled=""');

    const picked = render({ ...STEP, attackerId: "cb-gob2", types: { r1: "bludgeoning" } });
    expect(tag(picked, "cbt-popup-use-attacker")).toContain('data-value="cb-gob2"');
    expect(picked).toContain("Goblin 2");
    expect(tag(picked, "cbt-popup-use-type")).toContain('data-value="bludgeoning"');
    expect(tag(picked, "cbt-popup-use-confirm")).not.toContain('disabled=""');
  });

  test("FR-CBT-174 use roll step: Make card needs an attacker still in the fight and items 2–3 typed; Use as attack has no Type", () => {
    const two = entry({
      payload: [
        item({ rollId: "a", purpose: "damage", part: { type: null, extra: false } }),
        item({ rollId: "b", purpose: "damage", part: { type: null, extra: true } }),
      ],
    });
    const ids = ["cb-mira", "cb-gob2"];
    expect(stepReady({ ...STEP, attackerId: "cb-mira" }, two, ids)).toBe(false);
    expect(stepReady({ ...STEP, attackerId: "cb-mira", types: { b: "fire" } }, two, ids)).toBe(
      true,
    );
    expect(stepReady({ ...STEP, attackerId: "cb-gone", types: { b: "fire" } }, two, ids)).toBe(
      false,
    );
    const html = render({ ...STEP, attackerId: "cb-mira" }, { entries: [two] });
    expect(html.match(/data-testid="cbt-popup-use-type"/g)).toHaveLength(2);
    expect(tag(html, "cbt-popup-use-confirm")).toContain('disabled=""');

    const d20 = item({ rollId: "r20", natural: 12, dice: [{ faces: 20, value: 12, kept: true }] });
    const attack = render(
      { ...STEP, as: "attack", attackerId: null },
      { entries: [entry({ payload: [d20] })] },
    );
    expect(attack).toContain(">Use as attack</h2>");
    expect(attack).not.toContain('data-testid="cbt-popup-use-type"');
  });

  test("FR-CBT-174 use roll step: the log action's request opens the step (replacing a card) or the made card", () => {
    useCombatDialogs.setState({ cardId: "old" });
    useUseRollRequest
      .getState()
      .request({ step: { entryId: "e1", as: "damage", attackerId: null } });
    expect(useCombatDialogs.getState()).toMatchObject({
      cardId: null,
      step: { entryId: "e1", as: "damage", attackerId: null, types: {} },
    });
    useCombatDialogs.getState().editStep({ attackerId: "cb-mira", types: { r1: "piercing" } });
    useUseRollRequest.getState().request({ cardId: "card9" });
    expect(useCombatDialogs.getState()).toMatchObject({ cardId: "card9", step: null });
  });
});

describe("FR-CBT-176 retry after reconnect", () => {
  test("FR-CBT-176 retry after reconnect: while not live Make card is disabled and the picks stay; live again → enabled with them", () => {
    useCombatDialogs.setState({ cardId: null, step: null });
    useCombatDialogs.getState().openStep({ entryId: "e1", as: "damage", attackerId: null });
    useCombatDialogs.getState().editStep({ attackerId: "cb-mira", types: { r1: "piercing" } });
    const step = useCombatDialogs.getState().step as UseRollStep;
    const down = render(step, { live: false });
    expect(tag(down, "cbt-popup-use-confirm")).toContain('disabled=""');
    expect(tag(down, "cbt-popup-use-attacker")).toContain('data-value="cb-mira"');
    expect(tag(down, "cbt-popup-use-type")).toContain('data-value="piercing"');
    // A connection change touches no pick (popup-store is client memory).
    expect(useCombatDialogs.getState().step).toEqual(step);
    expect(tag(render(step), "cbt-popup-use-confirm")).not.toContain('disabled=""');
  });
});

describe("OQ-CBT-104 used crit hint", () => {
  test("OQ-CBT-104 used crit hint: a crit card whose damage roll is a log entry it used says the dice weren't doubled", () => {
    const damage = { rollId: "r1", dice: [], constant: 0, total: 7, manual: false };
    const used = entry({ dmPayload: { items: [], usedByCardId: "card1" } });
    expect(usedCritDamage("card1", { crit: true, damage }, [used])).toBe(true);
    expect(usedCritDamage("card1", { crit: false, damage }, [used])).toBe(false);
    expect(usedCritDamage("card2", { crit: true, damage }, [used])).toBe(false);
    expect(usedCritDamage("card1", { crit: true, damage: null }, [used])).toBe(false);
    expect(usedCritDamage("card1", { crit: true, damage }, [entry()])).toBe(false);
    expect(USED_CRIT_HINT).toBe("Critical: these dice weren't doubled");
  });
});
