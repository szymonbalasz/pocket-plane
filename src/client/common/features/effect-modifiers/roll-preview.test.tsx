// biome-ignore-all lint/suspicious/noThenProperty: `then` is the rule's effect field (MOD §8.4); rules are data, never awaited.
// FR-MOD-27 / -18 roll-control preview on dice-extras' tray (DOM tests as `routing.test.tsx`:
// static render over a fake sync store, handlers called on the captured control).
import { afterEach, describe, expect, test } from "bun:test";
import type { RollSubject } from "@shared/effect-modifiers/schemas";
import { emptyStore, type RecordMap } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { diceExtras } from "../dice-extras/store";
import { TrayWindow } from "../dice-extras/TrayWindow";
import { countedEntries, formSlots } from "../dice-roll-log/logic";
import {
  ManualForm,
  partEntries,
  type RollControl,
  type RollControlOptions,
  type RollRequest,
  rollRequestOf,
  rollTooltip,
  useRollControl,
} from "../dice-roll-log/roll-control";
import { NO_PREVIEW, subjectsOf } from "./roll-preview";

const effect = (id: string, label: string, modifiers: unknown[]) => ({
  id,
  kind: "custom",
  label,
  modifiers,
  presetKey: null,
  targetCharacterId: "mira",
  targetCombatantId: null,
  encounterId: null,
  endsRound: null,
});
const BLESS = effect("fx-bless", "Bless", [
  { kind: "dice", on: { roll: "attack" }, dice: "1d4", sign: 1 },
]);
const RAGE = effect("fx-rage", "Rage", [
  { kind: "mode", on: { roll: "check", abilities: ["str"] }, mode: "advantage" },
  { kind: "flat", on: { roll: "damage", via: "weapon" }, value: 2 },
]);

function sync(records: RecordMap, loaded: string[] = []) {
  const you = { campaignId: "c1", role: "player" as const, playerId: "p1" };
  return createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store: { ...emptyStore(), you, records },
        lazy: {
          generation: 1,
          loaded: { types: loaded, ids: {} },
          loading: { types: [], ids: {} },
          failed: { types: [], ids: {} },
        },
        notLiveSince: null,
        everLive: true,
        connection: { sendIntent: () => Promise.resolve({}), load: () => null },
      }) as unknown as SyncState,
  );
}

function render(node: React.ReactNode, records: RecordMap, loaded: string[] = []) {
  return renderToStaticMarkup(
    <SyncContext.Provider value={sync(records, loaded)}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        {node}
      </TooltipProvider>
    </SyncContext.Provider>,
  );
}

const withEffects = (...fx: ReturnType<typeof effect>[]): RecordMap => ({
  effect: Object.fromEntries(fx.map((f) => [f.id, f])),
});

function captureControl(options: RollControlOptions, records: RecordMap): RollControl {
  let control: RollControl | null = null;
  function Probe() {
    control = useRollControl(options);
    return null;
  }
  render(<Probe />, records);
  if (!control) throw new Error("no control");
  return control;
}

const mira = { characterId: "mira" };
const athletics: RollSubject = { creature: mira, roll: "check", ability: "str" };
const attackSubjects: RollSubject[] = [
  { creature: mira, roll: "attack", via: "weapon" },
  { creature: mira, roll: "damage", via: "weapon" },
];

afterEach(() => {
  diceExtras.failed();
  diceExtras.clear();
});

describe("FR-MOD-27 roll-control preview", () => {
  test("FR-MOD-27 subject in options → previewMode on the request; mode stays the roller's", () => {
    const rolls: RollRequest[] = [];
    const c = captureControl(
      {
        expressions: ["1d20+4"],
        category: "skill-check",
        subject: athletics,
        onRoll: (r) => rolls.push(r),
      },
      withEffects(RAGE),
    );
    c.roll();
    c.roll({ ctrlKey: true });
    expect(rolls).toEqual([
      { mode: "normal", previewMode: "advantage" },
      { mode: "disadvantage", previewMode: "normal" },
    ]);
  });

  test("FR-MOD-27 no subject → as before (no previewMode, no manualParts)", () => {
    const rolls: RollRequest[] = [];
    const c = captureControl(
      { expressions: ["1d20+4"], category: "skill-check", onRoll: (r) => rolls.push(r) },
      withEffects(RAGE),
    );
    c.roll();
    expect(rolls).toEqual([{ mode: "normal" }]);
    expect(c.preview.active).toBe(false);
  });

  test("FR-MOD-27 Alt+click stages the subject verbatim with the preview mode", () => {
    const options: RollControlOptions = {
      expressions: ["1d20+4"],
      category: "skill-check",
      subject: athletics,
      onRoll() {},
    };
    captureControl(options, withEffects(RAGE)).roll({ altKey: true });
    const req = diceExtras.api.getState().request;
    expect(req?.kind === "control" && req.options).toBe(options);
    expect(req?.kind === "control" && req.previewMode).toBe("advantage");
  });

  test("FR-MOD-27 Tooltip lists the parts: 'Bless +1d4 · Rage +2'", () => {
    const c = captureControl(
      {
        expressions: ["1d20+5", "1d8+3"],
        category: "attack",
        subject: attackSubjects,
        onRoll() {},
      },
      withEffects(BLESS, RAGE),
    );
    expect(c.preview.text).toBe("Bless +1d4 · Rage +2");
    expect(rollTooltip(c, "Shift: advantage")).toBe("Bless +1d4 · Rage +2 · Shift: advantage");
  });

  test("FR-MOD-27 one subject applies to the first expression only", () => {
    expect(subjectsOf(athletics, 2)).toEqual([athletics, null]);
    expect(subjectsOf(undefined, 1)).toEqual([null]);
    expect(subjectsOf(attackSubjects, 2)).toEqual(attackSubjects);
  });
});

describe("FR-MOD-18 physical groups → manualParts", () => {
  const options: RollControlOptions = {
    expressions: ["1d20+5", "1d8+3"],
    category: "attack",
    label: "Mira — Shortsword",
    subject: attackSubjects,
    onRoll() {},
  };

  test("FR-MOD-18 ManualForm: one labelled group per bonus die, under its roll's slot", () => {
    const c = captureControl(options, withEffects(BLESS));
    const html = render(
      <ManualForm control={{ ...c, manual: { mode: "normal" } }} />,
      withEffects(BLESS),
    );
    expect(html).toContain('data-testid="mod-tray-group" data-value="e:fx-bless" data-slot="0"');
    expect(html).toContain('data-testid="mod-tray-group-total" data-value="e:fx-bless"');
    expect(html).toContain("Bless: <code>1d4</code>");
    expect(html).toContain('data-testid="mod-roll-parts"');
  });

  test("FR-MOD-17 the d20 slot follows the preview mode (Rage adv on Athletics → two d20)", () => {
    const athl: RollControlOptions = {
      expressions: ["1d20+4"],
      category: "skill-check",
      subject: athletics,
      onRoll() {},
    };
    const c = captureControl(athl, withEffects(RAGE));
    const html = render(<ManualForm control={{ ...c, manual: { mode: "normal" } }} />, {});
    expect(html).toContain("2d20kh1+4");
    expect(html.match(/data-testid="dice-manual-die"/g)).toHaveLength(2);
  });

  test("FR-MOD-17 a lone d20 sends its value as dice (one d20 vs adv countable); 2d20, crit and damage slots unchanged", () => {
    const slots = (mode: "normal" | "advantage") => {
      const s = formSlots({ expressions: ["1d20+5", "1d8+3"] }, mode, []);
      if (typeof s === "string") throw new Error(s);
      return s;
    };
    expect(countedEntries(slots("normal"), [{ diceTotal: 11 }, { diceTotal: 5 }])).toEqual([
      { diceTotal: 11, dice: [11] },
      { diceTotal: 5 },
    ]);
    expect(countedEntries(slots("advantage"), [{ diceTotal: 11 }, { diceTotal: 5 }])).toEqual([
      { diceTotal: 11 },
      { diceTotal: 5 },
    ]);
    expect(
      countedEntries(slots("advantage"), [{ diceTotal: 11, dice: [11, 4] }, { diceTotal: 5 }]),
    ).toEqual([{ diceTotal: 11, dice: [11, 4] }, { diceTotal: 5 }]);
  });

  test("FR-MOD-18 submit: manualParts per entry, keys from bonusDieGroups; e: required, empty t: left out", () => {
    const rolls: RollRequest[] = [];
    const c = captureControl({ ...options, onRoll: (r) => rolls.push(r) }, withEffects(BLESS));
    const groups = [c.preview.groups(0), c.preview.groups(1)];
    expect(groups[0]?.map((g) => g.key)).toEqual(["e:fx-bless"]);
    expect(partEntries(groups, {})).toEqual({
      ok: false,
      message: "Enter the total for Bless (1d4)",
      focus: { slot: 0, key: "e:fx-bless", die: null },
    });
    const ok = partEntries(groups, { "0|e:fx-bless|1d4": { total: "3", dice: [] } });
    expect(ok).toEqual({
      ok: true,
      parts: [[{ key: "e:fx-bless", entry: { diceTotal: 3 } }], []],
    });
    const trigger = [
      [{ key: "t:trg", label: "Fury", expression: "1d6+2", dice: [], sign: 1 as const }],
    ];
    expect(partEntries(trigger, {})).toEqual({ ok: true, parts: [[]] });
    expect(partEntries(trigger, { "0|t:trg|1d6+2": { total: "9", dice: [] } })).toMatchObject({
      ok: false,
      message: "Total must be 1–6",
    });
  });

  test("FR-MOD-18 the request carries manualParts beside manual (an empty list per entry when none)", () => {
    const c = captureControl(options, withEffects(BLESS));
    const parts = [[{ key: "e:fx-bless", entry: { diceTotal: 3 } }]];
    expect(
      rollRequestOf("advantage", c.preview, [{ diceTotal: 15 }, { diceTotal: 6 }], parts),
    ).toEqual({
      mode: "advantage",
      previewMode: "advantage",
      manual: [{ diceTotal: 15 }, { diceTotal: 6 }],
      manualParts: [[{ key: "e:fx-bless", entry: { diceTotal: 3 } }], []],
    });
    // "Roll for me" (no entries): no manualParts, the server rolls the parts (FR-MOD-18).
    expect(rollRequestOf("normal", c.preview)).toEqual({ mode: "normal", previewMode: "normal" });
    // No subject: tier 1, exactly as before.
    expect(rollRequestOf("normal", NO_PREVIEW, [{ diceTotal: 4 }])).toEqual({
      mode: "normal",
      manual: [{ diceTotal: 4 }],
    });
  });

  test("FR-MOD-18 crit damage slot: the bonus die doubles", () => {
    const dmg: RollControlOptions = {
      expressions: ["1d8+3"],
      critExpressions: ["2d8+3"],
      crit: true,
      category: "damage",
      subject: { creature: mira, roll: "damage", via: "weapon" },
      onRoll() {},
    };
    const hm = effect("fx-hm", "Mark", [
      { kind: "dice", on: { roll: "damage", via: "weapon" }, dice: "1d6", sign: 1 },
    ]);
    const c = captureControl(dmg, withEffects(hm));
    expect(c.preview.groups(0, { crit: true }).map((g) => g.expression)).toEqual(["2d6"]);
    const html = render(<ManualForm control={{ ...c, manual: { mode: "normal" } }} />, {});
    expect(html).toContain("Mark: <code>2d6</code>");
  });
});

describe("FR-MOD-27 tray (FR-DICEX-08)", () => {
  test("FR-MOD-27 adjust: Rage adv → two d20 chips tagged adv; MOD's line shows Bless", () => {
    diceExtras.stage({
      kind: "control",
      options: {
        expressions: ["1d20+4"],
        category: "attack",
        subject: { creature: mira, roll: "attack", via: "weapon" },
        onRoll() {},
      },
      mode: "normal",
    });
    const reckless = effect("fx-reck", "Reckless", [
      { kind: "mode", on: { roll: "attack", via: "weapon" }, mode: "advantage" },
    ]);
    const html = render(<TrayWindow />, withEffects(BLESS, reckless));
    expect(html.match(/data-testid="dicex-tray-die"[^>]*data-tag="adv"/g)).toHaveLength(2);
    expect(html).toContain('data-testid="dicex-tray-extra" data-value="effect-modifiers"');
    expect(html).toMatch(/data-testid="dicex-tray-extra-die" data-faces="4" data-key="e:fx-bless"/);
    expect(html).toContain("Bless +1d4");
  });

  test("FR-MOD-27 the tray's Dis against Rage's adv → normal (one d20)", () => {
    diceExtras.stage({
      kind: "control",
      options: {
        expressions: ["1d20+4"],
        category: "skill-check",
        subject: athletics,
        onRoll() {},
      },
      mode: "disadvantage",
    });
    const html = render(<TrayWindow />, withEffects(RAGE));
    expect(html).not.toContain("data-tag=");
    expect(html.match(/data-testid="dicex-tray-die"/g)).toHaveLength(1);
  });
});

describe("FR-MOD-56 tray reads trigger state", () => {
  /** Brakka raging on her turn with Divine Fury loaded; her trigger-state row's charge varies. */
  const brakkaRecords = (charge: string): RecordMap => ({
    effect: {
      "fx-rage": {
        ...RAGE,
        id: "fx-rage",
        targetCharacterId: "brakka",
        presetKey: "pre-rage",
      },
    },
    "effect-preset": {
      "pre-rage": { id: "pre-rage", activeEffectId: "fx-rage", originKey: "rage" },
    },
    encounter: {
      enc: { id: "enc", status: "started", round: 1, turnCombatantId: "c-brakka" },
    },
    combatant: {
      "c-brakka": {
        id: "c-brakka",
        encounterId: "enc",
        kind: "pc",
        entityId: "brakka",
        active: true,
        removed: false,
      },
    },
    entity: {
      brakka: {
        id: "brakka",
        kind: "character",
        statBlock: { level: 5, className: "Barbarian", classes: [{ name: "Barbarian", level: 5 }] },
      },
    },
    "rule-trigger": {
      "trg-df": {
        id: "trg-df",
        seq: 1,
        characterId: "brakka",
        definitionId: null,
        name: "Divine Fury",
        enabled: true,
        rule: {
          on: "hit",
          requires: { preset: "pre-rage" },
          when: [{ if: "via", via: "weapon" }, { if: "ownTurn" }],
          every: "turn",
          then: { do: "damage", formula: "1d6 + floor(level(barbarian) / 2)", type: "radiant" },
        },
      },
    },
    "trigger-state": {
      "ts-df": { id: "ts-df", combatantId: "c-brakka", triggerId: "trg-df", armed: true, charge },
    },
  });
  const stageDamage = () =>
    diceExtras.stage({
      kind: "control",
      options: {
        expressions: ["1d12+4"],
        category: "damage",
        subject: {
          creature: { combatantId: "c-brakka" },
          roll: "damage",
          via: "weapon",
          card: true,
        },
        onRoll() {},
      },
      mode: "normal",
    });

  test("FR-MOD-56 tray stops offering a used trigger: 'Divine Fury (on a hit)' before her first hit, gone once used, back when ready", () => {
    stageDamage();
    const ready = render(<TrayWindow />, brakkaRecords("ready"), ["rule-trigger"]);
    expect(ready).toContain("Divine Fury (on a hit)");
    expect(ready).toMatch(/data-testid="dicex-tray-extra-die" data-faces="6" data-key="t:trg-df"/);
    stageDamage();
    const used = render(<TrayWindow />, brakkaRecords("used"), ["rule-trigger"]);
    expect(used).not.toContain("Divine Fury");
    stageDamage();
    expect(render(<TrayWindow />, brakkaRecords("waiting"), ["rule-trigger"])).not.toContain(
      "Divine Fury",
    );
  });
});
