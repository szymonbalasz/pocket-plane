// Rule-trigger schema fields on combat and roll payloads (R0; FR-MOD-18, -19, -37, -38, -48):
// card `damage.triggers`, `applyCard` `targets[].triggers`, hp_change `triggerParts`, the damage
// `roll` item's `offered`, per-die `dice`, `dmPayload.notes`, `manualParts`. Old rows parse.
import { describe, expect, test } from "bun:test";
import { throwDice } from "@shared/dice-extras/throw";
import {
  DmModPart,
  ManualParts,
  PART_DICE_MAX,
  RollEntryDmPayload,
  RollPayloadItem,
} from "@shared/dice-roll-log/schemas";
import { jsonBytes } from "@shared/notifications/schemas";
import { AttackLogDmPayload, AttackLogPayload } from "./log-kinds";
import {
  ApplyCardTargetsInput,
  CARD_MODS_MAX,
  type CardTriggerPart,
  DamageCardPayload,
  HpTriggerPart,
} from "./schemas";

const x = (n: number, p = "") => (p + "x".repeat(n)).slice(0, n);

const offer: CardTriggerPart = {
  triggerId: "trg-fury",
  label: "Divine Fury",
  value: 6,
  expression: "1d6+2",
  rollId: "roll-fury",
  type: "radiant",
};
const card = {
  encounterId: "enc",
  attackerId: "k-brakka",
  attackerName: "Brakka",
  attackName: "Greataxe",
  damageType: "slashing",
  mode: "normal",
  crit: false,
  toHit: { rollId: "r1", dice: [[15, true]], constant: 7, total: 22, manual: true, natural: 15 },
  damage: { rollId: "r2", dice: [[8, true]], constant: 4, total: 14, manual: true },
} as const;

describe("R0 combat schema fields (FR-MOD-37, -38, -48)", () => {
  test("FR-MOD-37 card damage carries ≤ 4 offered parts with settle facts; old cards parse", () => {
    expect<unknown>(DamageCardPayload.parse(card)).toEqual(card);
    const withOffer = { ...card, damage: { ...card.damage, triggers: [offer] } };
    expect<unknown>(DamageCardPayload.parse(withOffer)).toEqual(withOffer);
    const settle = {
      ...offer,
      ask: "an ally within 5 ft",
      marked: "hunters-mark",
      hurt: true,
      untick: true,
    };
    expect(
      DamageCardPayload.safeParse({ ...card, damage: { ...card.damage, triggers: [settle] } })
        .success,
    ).toBe(true);
    const five = Array.from({ length: 5 }, (_, i) => ({ ...offer, triggerId: `t${i}` }));
    expect(
      DamageCardPayload.safeParse({ ...card, damage: { ...card.damage, triggers: five } }).success,
    ).toBe(false);
    expect(
      DamageCardPayload.safeParse({ ...card, damage: { ...card.damage, triggers: [] } }).success,
    ).toBe(false);
    expect(
      DamageCardPayload.safeParse({
        ...card,
        damage: { ...card.damage, triggers: [{ ...offer, label: x(41) }] },
      }).success,
    ).toBe(false);
    expect(
      DamageCardPayload.safeParse({
        ...card,
        damage: { ...card.damage, triggers: [{ ...offer, type: "holy" }] },
      }).success,
    ).toBe(false);
    // To-hit parts take no offers.
    expect(
      DamageCardPayload.safeParse({ ...card, toHit: { ...card.toHit, triggers: [offer] } }).success,
    ).toBe(false);
  });

  test("MOD §12 / FR-MOD-37 R10 worst card: 6 max mods on both rolls + 4 max offers exceed 4 KB; dropping the last offer fits", () => {
    const mod = {
      label: x(40, "Bless "),
      value: -48,
      expression: "4d12",
      auto: true as const,
      rollId: x(36, "r-"),
    };
    const dice = Array.from({ length: 50 }, () => [12, true] as [number, boolean]);
    const parts = Array.from(
      { length: 4 },
      (_, i): CardTriggerPart => ({
        triggerId: x(36, `t${i}-`),
        label: x(40, "Fury "),
        value: 999,
        expression: x(20, "20d12+"),
        rollId: x(36, `rr${i}-`),
        type: "lightning",
        auto: true,
        ask: x(60, "Check "),
        marked: x(40, "pr-"),
        hurt: true,
        untick: true,
      }),
    );
    const worst = DamageCardPayload.parse({
      ...card,
      encounterId: x(36, "e-"),
      attackerId: x(36, "a-"),
      attackerName: x(40, "Brakka "),
      attackName: x(40, "Greataxe "),
      damageType: "bludgeoning",
      toHit: {
        ...card.toHit,
        rollId: x(36, "h-"),
        dice: [
          [20, true],
          [1, false],
        ],
        mods: Array(CARD_MODS_MAX).fill(mod),
      },
      damage: {
        ...card.damage,
        rollId: x(36, "d-"),
        dice,
        mods: Array(CARD_MODS_MAX).fill(mod),
        triggers: parts,
      },
      attackId: x(36, "att-"),
    });
    // Every field at its max (ids 36, labels 40, `auto`, 50 dice): over the kind's 4 KB cap, so
    // the offer step must drop offers from the last (R10). One drop is enough at true max.
    const cap = 4096;
    const bytes = jsonBytes(worst);
    expect(bytes).toBeGreaterThan(cap);
    const three = { ...worst, damage: { ...worst.damage, triggers: parts.slice(0, 3) } };
    expect(jsonBytes(DamageCardPayload.parse(three))).toBeLessThanOrEqual(cap);
    console.log(
      `MOD R0 worst card: 4 offers ${bytes} B, 3 offers ${jsonBytes(three)} B (cap ${cap})`,
    );
  });

  test("FR-MOD-38 applyCard targets[].triggers: each part on one Hit target, ≤ 4, no duplicates", () => {
    const t = (id: string, hit: boolean, triggers?: unknown) => ({
      targetId: id,
      hit,
      multiplier: "normal",
      ...(triggers ? { triggers } : {}),
    });
    const ok = {
      cardId: "c",
      toHitTotal: 22,
      damageTotal: 14,
      damageRollId: "r2",
      partRollIds: { toHit: "r1", extra: [] },
      targets: [
        t("g1", true, [{ triggerId: "trg", value: 9, multiplier: "half", force: true }]),
        t("g2", true),
      ],
    };
    expect(ApplyCardTargetsInput.safeParse(ok).success).toBe(true);
    const bad = (targets: unknown[]) => ApplyCardTargetsInput.safeParse({ ...ok, targets }).success;
    expect(bad([t("g1", false, [{ triggerId: "trg" }])])).toBe(false);
    expect(
      bad([t("g1", true, [{ triggerId: "trg" }]), t("g2", true, [{ triggerId: "trg" }])]),
    ).toBe(false);
    expect(bad([t("g1", true, [{ triggerId: "trg" }, { triggerId: "trg" }])])).toBe(false);
    expect(bad([t("g1", true, [{ triggerId: "trg", value: -1 }])])).toBe(false);
    expect(bad([t("g1", true, [])])).toBe(false);
  });

  test("FR-MOD-48 hp_change triggerParts entries; outcome line parts (typed) and the DM's names", () => {
    const part = {
      triggerId: "trg",
      name: "Divine Fury",
      value: 6,
      multiplier: "normal",
      type: "radiant",
      forced: false,
    };
    expect<unknown>(HpTriggerPart.parse(part)).toEqual(part);
    expect(HpTriggerPart.safeParse({ ...part, value: -1 }).success).toBe(false);
    const line = {
      targetName: "Goblin",
      attackName: "Greataxe",
      damageType: "slashing",
      toHit: null,
      hit: true,
      damage: 18,
      multiplier: "normal",
      crit: false,
    };
    expect<unknown>(AttackLogPayload.parse(line)).toEqual(line);
    const typed = {
      ...line,
      parts: [
        { label: "Divine Fury", value: 6, type: "radiant" },
        { label: null, value: 9, type: null },
      ],
    };
    expect<unknown>(AttackLogPayload.parse(typed)).toEqual(typed);
    const dm = {
      targetAc: 15,
      hitComputed: true,
      toHitRolled: 22,
      damageRolled: 14,
      damageTotal: 14,
      applied: 18,
      overkill: 0,
      overrides: { toHit: false, hit: false, damage: false },
    };
    const named = {
      ...dm,
      parts: [{ triggerId: "trg", label: "Martial Advantage", rolled: 7, forced: true }],
      acMods: [{ effectId: "fx", label: "Shield of Faith", value: 2 }],
      defense: { level: "resistance", label: "Rage" },
    };
    expect<unknown>(AttackLogDmPayload.parse(named)).toEqual(named);
  });
});

describe("R0 roll payload fields (FR-MOD-18, -19, -34)", () => {
  const item = {
    rollId: "r2",
    expression: "1d12+4",
    mode: "normal",
    manual: false,
    dice: [{ faces: 12, value: 8, kept: true }],
    constant: 4,
    total: 14,
    natural: null,
    label: "Greataxe",
  };

  test("FR-MOD-19 damage item `offered` (not in total), per-die `dice` ≤ 20, typed parts; old rows parse", () => {
    expect<unknown>(RollPayloadItem.parse(item)).toEqual(item);
    const o = {
      label: "Divine Fury",
      value: 6,
      expression: "1d6+2",
      rollId: "rf",
      type: "radiant",
      dice: [4],
    };
    const withOffer = {
      ...item,
      offered: [o],
      mods: [
        { label: "Rage", value: 2 },
        { label: null, value: 3, expression: "1d4", rollId: "rb", dice: [3] },
      ],
    };
    expect<unknown>(RollPayloadItem.parse(withOffer)).toEqual(withOffer);
    expect(
      RollPayloadItem.safeParse({
        ...item,
        offered: [{ ...o, label: null, type: null, auto: true }],
      }).success,
    ).toBe(true);
    expect(RollPayloadItem.safeParse({ ...item, offered: Array(5).fill(o) }).success).toBe(false);
    expect(
      RollPayloadItem.safeParse({
        ...item,
        offered: [{ ...o, dice: Array(PART_DICE_MAX + 1).fill(1) }],
      }).success,
    ).toBe(false);
    expect(RollPayloadItem.safeParse({ ...item, offered: [{ ...o, ask: "x" }] }).success).toBe(
      false,
    );
  });

  test("FR-MOD-19 D1's lenient reader throws offered and per-die part dice from the server shape", () => {
    const payload = [
      {
        ...item,
        mods: [{ label: "Bless", value: 3, expression: "1d4", rollId: "rb", dice: [3] }],
        offered: [
          { label: null, value: 6, expression: "1d6+2", rollId: "rf", type: "radiant", dice: [4] },
        ],
      },
    ];
    expect<unknown>(RollPayloadItem.parse(payload[0])).toEqual(payload[0]);
    const t = throwDice([
      {
        id: "e1",
        n: 1,
        kind: "roll",
        public: true,
        rollerRole: "player",
        rollerPlayerId: "p1",
        actorName: "Brakka",
        payload,
      },
    ]);
    const dice = t?.dice ?? [];
    expect(dice.map((d) => [d.faces, d.value, d.label ?? null, d.offered === true])).toEqual([
      [12, 8, null, false],
      [4, 3, "Bless", false],
      [6, 4, "DM", true],
    ]);
  });

  test("FR-MOD-34 / -37 dmPayload: trigger names per item, entry notes ≤ 4 × 80; part names effect xor trigger", () => {
    const dm = {
      items: [
        {
          mods: [
            { effectId: "fx", label: "Rage" },
            { triggerId: "trg-a", label: "Agonizing Blast" },
          ],
          offered: [{ triggerId: "trg", label: "Divine Fury" }],
        },
      ],
      notes: ["Divine Fury skipped: 30 dice > 25"],
    };
    expect<unknown>(RollEntryDmPayload.parse(dm)).toEqual(dm);
    expect(RollEntryDmPayload.safeParse({ ...dm, notes: [x(81)] }).success).toBe(false);
    expect(RollEntryDmPayload.safeParse({ ...dm, notes: Array(5).fill("n") }).success).toBe(false);
    expect(DmModPart.safeParse({ label: "x" }).success).toBe(false);
    expect(DmModPart.safeParse({ effectId: "a", triggerId: "b", label: "x" }).success).toBe(false);
  });

  test("FR-MOD-18 manualParts: e:/t: keys, each once", () => {
    const e = { diceTotal: 3 };
    expect(
      ManualParts.safeParse([
        { key: "e:fx-1", entry: e },
        { key: "t:trg-1", entry: { diceTotal: 4, dice: [4] } },
      ]).success,
    ).toBe(true);
    expect(ManualParts.safeParse([{ key: "x:fx-1", entry: e }]).success).toBe(false);
    expect(ManualParts.safeParse([{ key: "e:", entry: e }]).success).toBe(false);
    expect(
      ManualParts.safeParse([
        { key: "e:a", entry: e },
        { key: "e:a", entry: e },
      ]).success,
    ).toBe(false);
  });
});
