// Slot labels (FR-DICE-41, BL-20; DICE §13 unit "damage types in the physical form"): the sheet's
// and the DM's attack specs name each slot "To hit" / its damage type; the physical form heads
// each slot with it, its crit sub-row and inline error name it, and the tray's `adjust` groups
// carry it. Static server render over a fake sync store, as `dice-extras/routing.test.tsx`.
import { afterEach, describe, expect, test } from "bun:test";
import { attackRollSpecs, characterRolls } from "@shared/character-sheet/logic";
import { critExpression } from "@shared/combat-tracker/rules";
import { emptyStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { diceExtras } from "../dice-extras/store";
import { TrayWindow, trayControlOptions } from "../dice-extras/TrayWindow";
import {
  compositionOf,
  joinDie,
  partSlotLabels,
  setGroupType,
  stagedPartsOf,
} from "../dice-extras/tray-parts";
import { NO_PREVIEW } from "../effect-modifiers/roll-preview";
import { type FormOptions, formEntries, formSlots, type SlotInput, slotLabelsOf } from "./logic";
import {
  ManualForm,
  type RollControl,
  type RollControlOptions,
  type RollRequest,
} from "./roll-control";

function render(node: React.ReactNode) {
  const you = { campaignId: "c1", role: "player", playerId: "p1" };
  const sync = createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store: { ...emptyStore(), you, records: {} },
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

/** A control with its physical-dice form open (the form reads only these fields). */
const openControl = (options: RollControlOptions) =>
  ({
    manual: { mode: "normal" },
    options,
    preview: NO_PREVIEW,
    physical: true,
    error: null,
    cancelManual() {},
    submitManual() {},
    rollForMe() {},
  }) as unknown as RollControl;

/** Text of every element with `testid`, tags stripped. */
const texts = (html: string, testid: string) =>
  [...html.matchAll(new RegExp(`data-testid="${testid}"[^>]*>(.*?)</span>`, "g"))].map((m) =>
    (m[1] ?? "").replace(/<[^>]+>/g, ""),
  );

/** Brakka's Flame Tongue greatsword (bundle `dice-polish`): +1, 2d6 slashing + 2d6 fire. */
const FLAME_TONGUE = {
  name: "Flame Tongue greatsword",
  toHit: 7,
  damage: "2d6+4",
  damageType: "slashing",
  bonus: 1,
  extraDamage: [{ damage: "2d6", type: "fire" as const }],
};
const specs = attackRollSpecs(FLAME_TONGUE);
const options: FormOptions = {
  expressions: specs.map((s) => s.expression),
  critExpressions: specs.slice(1).map((s) => critExpression(s.expression)),
  slotLabels: slotLabelsOf(specs),
};
const group = (total: string) => ({ total, dice: [] });
const input = (expression: string, base: string, extra = ""): SlotInput => ({
  for: expression,
  base: group(base),
  extra: group(extra),
});

afterEach(() => diceExtras.clear());

describe("FR-DICE-41 damage types in the physical form", () => {
  test("FR-DICE-41 damage types in the physical form: Flame Tongue slots read 'To hit', 'Slashing', 'Fire'", () => {
    expect(options.expressions).toEqual(["1d20+8", "2d6+5", "2d6"]);
    expect(options.slotLabels).toEqual(["To hit", "Slashing", "Fire"]);
    const html = render(
      <ManualForm control={openControl({ ...options, category: "attack", onRoll() {} })} />,
    );
    expect(texts(html, "dice-manual-slot-label")).toEqual([
      "To hit — 1d20+8",
      "Slashing — 2d6+5",
      "Fire — 2d6",
    ]);
    expect(html.match(/data-testid="dice-manual-slot-label" data-die-slot="\d"/g)).toEqual([
      'data-testid="dice-manual-slot-label" data-die-slot="0"',
      'data-testid="dice-manual-slot-label" data-die-slot="1"',
      'data-testid="dice-manual-slot-label" data-die-slot="2"',
    ]);
    expect(html).toContain('aria-label="Dice total for 2d6 fire"');
  });

  test("FR-DICE-41 damage types in the physical form: a natural 20 → crit sub-rows '(slashing)', '(fire)'", () => {
    const nat20 = [input("1d20+8", "20")];
    const slots = formSlots(options, "normal", nat20);
    if (typeof slots === "string") throw new Error(slots);
    expect(slots.map((s) => [s.label, s.extra?.expression ?? null])).toEqual([
      ["To hit", null],
      ["Slashing", "2d6"],
      ["Fire", "2d6"],
    ]);
    // The form draws the sub-rows as soon as a slot is critical (`crit: true` here: Damage).
    const damage = slotLabelsOf(specs.slice(1));
    expect(damage).toEqual(["Slashing", "Fire"]);
    const html = render(
      <ManualForm
        control={openControl({
          expressions: ["2d6+5", "2d6"],
          critExpressions: ["4d6+5", "4d6"],
          crit: true,
          ...(damage ? { slotLabels: damage } : {}),
          category: "damage",
          onRoll() {},
        })}
      />,
    );
    expect(texts(html, "dice-manual-crit-label")).toEqual([
      "Extra critical dice: 2d6 (slashing)",
      "Extra critical dice: 2d6 (fire)",
    ]);
  });

  test("FR-DICE-41 damage types in the physical form: the inline error names the part; entries unchanged", () => {
    const filled = [
      input("1d20+8", "20"),
      input("2d6+5", "7", "8"),
      input("2d6", "5"), // fire's extra critical dice left empty
    ];
    const slots = formSlots(options, "normal", filled);
    if (typeof slots === "string") throw new Error(slots);
    expect(formEntries(slots, filled)).toMatchObject({
      ok: false,
      message: "Enter the total for 2d6 fire (critical)",
      focus: { slot: 2, group: "extra", die: null },
    });
    // Labels never change what is sent: the same ManualEntry list with or without them.
    const done = [filled[0], filled[1], input("2d6", "5", "9")] as SlotInput[];
    const plain = { ...options, slotLabels: undefined };
    const a = formSlots(options, "normal", done);
    const b = formSlots(plain, "normal", done);
    if (typeof a === "string" || typeof b === "string") throw new Error("no slots");
    expect(formEntries(a, done)).toEqual(formEntries(b, done));
    expect(formEntries(a, done)).toEqual({
      ok: true,
      entries: [{ diceTotal: 20 }, { diceTotal: 15 }, { diceTotal: 14 }],
    });
  });

  test("FR-DICE-41 damage types in the physical form: no slotLabels → headings as today", () => {
    const html = render(
      <ManualForm
        control={openControl({
          expressions: ["1d20+8", "2d6+5"],
          category: "attack",
          onRoll() {},
        })}
      />,
    );
    expect(html).not.toContain("dice-manual-slot-label");
    expect(html).toContain("<code");
    expect(html).toContain(">2d6+5</code>");
    const slots = formSlots({ expressions: ["2d6"] }, "normal", []);
    if (typeof slots === "string") throw new Error(slots);
    expect(formEntries(slots, [input("2d6", "")])).toMatchObject({
      message: "Enter the total for 2d6",
    });
  });

  test("FR-DICE-41 damage types in the physical form: tray `adjust` groups labelled the same", () => {
    diceExtras.stage({
      kind: "control",
      options: { ...options, category: "attack", label: "Brakka — Flame Tongue", onRoll() {} },
      mode: "normal",
    });
    const html = render(<TrayWindow />);
    expect(html).toContain('data-testid="dicex-tray-state" data-value="adjust"');
    expect(texts(html, "dicex-tray-group-label")).toEqual(["To hit", "Slashing", "Fire"]);
    // A control without labels: no group label.
    diceExtras.stage({
      kind: "control",
      options: { expressions: ["1d20+3"], category: "saving-throw", onRoll() {} },
      mode: "normal",
    });
    expect(render(<TrayWindow />)).not.toContain("dicex-tray-group-label");
  });

  test("FR-DICE-41 slot labels from roll specs: attacks only; a part without a type reads 'Damage'", () => {
    const plain = attackRollSpecs({ ...FLAME_TONGUE, damageType: null, extraDamage: [] });
    expect(slotLabelsOf(plain)).toEqual(["To hit", "Damage"]);
    expect(slotLabelsOf(plain.slice(0, 1))).toBeUndefined(); // Attack alone: no labels
    const check = characterRolls(
      { initBonus: 2, attacks: [] } as unknown as Parameters<typeof characterRolls>[0],
      null,
      "initiative",
      {},
    );
    if (!check.ok) throw new Error("no initiative spec");
    expect(slotLabelsOf(check.specs)).toBeUndefined();
  });
});

describe("FR-DICE-98 roll control purpose", () => {
  test("FR-DICE-98 roll request parts", () => {
    // A staged Flame Tongue Damage: + a d8 (a new size: the last group's type, fire), switched
    // to radiant; Roll → `onRoll` gets the three parts.
    const got: RollRequest[] = [];
    const options: RollControlOptions = {
      expressions: ["2d6+5", "2d6"],
      category: "damage",
      label: "Brakka — Flame Tongue greatsword damage",
      purpose: "damage",
      partTypes: ["slashing", "fire"],
      slotLabels: ["Slashing", "Fire"],
      onRoll: (r) => got.push(r),
    };
    let comp = compositionOf(options.expressions, "damage", options.partTypes);
    comp = joinDie(comp, 8, "damage");
    comp = setGroupType(comp, 2, "radiant");
    const parts = stagedPartsOf(comp, "damage");
    expect(parts).toEqual([
      { expression: "2d6+5", type: "slashing" },
      { expression: "2d6", type: "fire" },
      { expression: "1d8", type: "radiant" },
    ]);
    const tray = trayControlOptions(
      { kind: "control", options, mode: "normal", edit: comp },
      "",
      "normal",
      () => {},
      { purpose: "damage", parts, slotLabels: partSlotLabels(comp, "damage"), crit: false },
    );
    // The physical form: one slot per staged part, labelled by its type (FR-DICE-41).
    expect(tray.expressions).toEqual(["2d6+5", "2d6", "1d8"]);
    const html = render(<ManualForm control={openControl(tray)} />);
    expect(texts(html, "dice-manual-slot-label")).toEqual([
      "Slashing — 2d6+5",
      "Fire — 2d6",
      "Radiant — 1d8",
    ]);
    tray.onRoll({ mode: "normal", manual: [{ diceTotal: 7 }, { diceTotal: 6 }, { diceTotal: 4 }] });
    expect(got).toEqual([
      {
        mode: "normal",
        manual: [{ diceTotal: 7 }, { diceTotal: 6 }, { diceTotal: 4 }],
        parts,
      },
    ]);
    // On a crit the form asks the extra critical dice of the edited parts.
    const crit = trayControlOptions(
      { kind: "control", options: { ...options, crit: true }, mode: "normal", edit: comp },
      "",
      "normal",
      () => {},
      { purpose: "damage", parts, slotLabels: partSlotLabels(comp, "damage"), crit: true },
    );
    expect(crit.critExpressions).toEqual(["4d6+5", "4d6", "2d8"]);
    expect(render(<ManualForm control={openControl(crit)} />)).toContain(
      "Extra critical dice: 1d8",
    );
  });
});
