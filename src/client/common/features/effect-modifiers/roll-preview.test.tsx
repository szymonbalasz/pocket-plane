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
  partForms,
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

/** An offered `hit` trigger group (FR-MOD-18 `t:`), as the preview gives it. */
const fury = (expression: string) => ({
  key: "t:trg",
  label: "Divine Fury",
  expression,
  dice: [],
  sign: 1 as const,
  onHit: true as const,
});

/** BL-25: the form of a Flame Tongue Attack + damage with Divine Fury offered on the damage. */
function renderOffered(): string {
  const c = captureControl(
    { expressions: ["1d20+8", "2d6+5", "2d6"], category: "attack", onRoll() {} },
    {},
  );
  const preview = {
    ...c.preview,
    active: true,
    groups: (i: number) => (i === 1 ? [fury("1d6+2")] : []),
  };
  return render(<ManualForm control={{ ...c, preview, manual: { mode: "normal" } }} />, {});
}

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

  test("FR-MOD-18 submit: manualParts per entry, keys from bonusDieGroups; every group required", () => {
    const rolls: RollRequest[] = [];
    const c = captureControl({ ...options, onRoll: (r) => rolls.push(r) }, withEffects(BLESS));
    const forms = partForms([{ crit: false }, { crit: false }], (i) => c.preview.groups(i));
    expect(forms.map((f) => f.group.key)).toEqual(["e:fx-bless"]);
    expect(partEntries(forms, {}, 2)).toEqual({
      ok: false,
      message: "Enter the total for Bless (1d4)",
      focus: { slot: 0, key: "e:fx-bless", group: "base", die: null },
    });
    const ok = partEntries(forms, { "0|e:fx-bless|1d4": { total: "3", dice: [] } }, 2);
    expect(ok).toEqual({
      ok: true,
      parts: [[{ key: "e:fx-bless", entry: { diceTotal: 3 } }], []],
    });
    const trigger = partForms([{ crit: false }], () => [fury("1d6+2")]);
    expect(partEntries(trigger, { "0|t:trg|1d6+2": { total: "9", dice: [] } }, 1)).toMatchObject({
      ok: false,
      message: "Total must be 1–6",
    });
  });

  test("BL-25 FR-MOD-18 an offered trigger die is entered like any die: required, sent as its t: group (no 'rolled for you')", () => {
    const forms = partForms([{ crit: false }], () => [fury("1d6+2")]);
    expect(partEntries(forms, {}, 1)).toEqual({
      ok: false,
      message: "Enter the total for Divine Fury (1d6+2)",
      focus: { slot: 0, key: "t:trg", group: "base", die: null },
    });
    expect(partEntries(forms, { "0|t:trg|1d6+2": { total: "4", dice: [] } }, 1)).toEqual({
      ok: true,
      parts: [[{ key: "t:trg", entry: { diceTotal: 4 } }]],
    });
  });

  test("BL-25 offered dice follow every weapon part (part order); bonus dice stay under their roll", () => {
    // [to-hit, base damage, fire part]: Bless on the to-hit, Divine Fury offered on the damage.
    const bless = {
      key: "e:fx-bless",
      label: "Bless",
      expression: "1d4",
      dice: [],
      sign: 1 as const,
    };
    const at = (i: number) => (i === 0 ? [bless] : i === 1 ? [fury("1d6+2")] : []);
    const forms = partForms([{ crit: false }, { crit: false }, { crit: false }], at);
    expect(forms.map((f) => [f.slot, f.group.key])).toEqual([
      [0, "e:fx-bless"],
      [1, "t:trg"],
    ]);
    const html = renderOffered();
    const fire = html.indexOf('data-testid="dice-manual-total" data-value="2"');
    const offered = html.indexOf('data-testid="mod-tray-group" data-value="t:trg"');
    expect(fire).toBeGreaterThan(-1);
    expect(offered).toBeGreaterThan(fire);
    expect(html).toContain("Divine Fury (on a hit): <code>1d6+2</code>");
    expect(html).not.toContain("optional");
  });

  test("BL-25 FR-DICE-31 FR-CBT-83 on a crit an offered part keeps its dice and adds an Extra critical dice row; sent merged", () => {
    const forms = partForms([{ crit: true }], (_, crit) => [fury(crit ? "2d6+2" : "1d6+2")]);
    expect(forms).toHaveLength(1);
    const f = forms[0];
    expect(f?.base.expression).toBe("1d6+2");
    expect(f?.extra?.expression).toBe("1d6");
    expect(partEntries(forms, { "0|t:trg|1d6+2": { total: "4", dice: [] } }, 1)).toEqual({
      ok: false,
      message: "Enter the total for Divine Fury (1d6, critical)",
      focus: { slot: 0, key: "t:trg", group: "extra", die: null },
    });
    expect(
      partEntries(
        forms,
        {
          "0|t:trg|1d6+2": { total: "4", dice: [] },
          "0|t:trg|1d6+2|crit": { total: "6", dice: [] },
        },
        1,
      ),
    ).toEqual({ ok: true, parts: [[{ key: "t:trg", entry: { diceTotal: 10, dice: [4, 6] } }]] });
    // A crit-filtered trigger (same dice on a crit) stays one group.
    const same = partForms([{ crit: true }], () => [fury("1d6+2")]);
    expect(same[0]?.extra).toBeNull();
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

  test("FR-MOD-18 BL-25 crit damage slot: the bonus die doubles, asked as its dice + Extra critical dice", () => {
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
    expect(html).toContain("Mark: <code>1d6</code>");
    expect(html).toContain(
      'data-testid="mod-tray-group-crit-label" data-value="e:fx-hm" data-slot="0" class="min-w-0 flex-1 truncate text-xs text-muted-foreground">Extra critical dice: 1d6',
    );
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
