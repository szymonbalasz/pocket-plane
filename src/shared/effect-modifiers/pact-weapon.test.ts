// biome-ignore-all lint/suspicious/noThenProperty: `then` is the rule's effect field (MOD §8.4); rules are data, never awaited.
// Pact weapons (class-resources FR-CRES-14, -15), pure: the attack row field, the filter's
// schema (hit and roll triggers only), its match by row name, the owner-side check and its words.
import { describe, expect, test } from "bun:test";
import { Attack } from "@shared/entities/schemas";
import { ownerFiltersPass, pactWeaponRoll } from "./trigger-fire";
import { triggerSentence } from "./trigger-words";
import { TriggerRule } from "./triggers";

const attacks = [
  { name: "Starmetal Blaster", pactWeapon: true },
  { name: "Rapier" },
  { name: "Old Pact Blade", pactWeapon: false },
];
const subject = (via: "weapon" | "spell", row?: string) => ({
  creature: { characterId: "soel" },
  roll: "damage" as const,
  via,
  ...(row ? { row } : {}),
});

describe("FR-CRES-14 pact weapon rows", () => {
  test("FR-CRES-14 attack rows take pactWeapon; absent = not a pact weapon", () => {
    const row = { name: "Blaster", toHit: 6, damage: "1d6+3" };
    expect(Attack.parse({ ...row, pactWeapon: true }).pactWeapon).toBe(true);
    expect(Attack.parse(row).pactWeapon).toBeUndefined();
    expect(Attack.safeParse({ ...row, pactWeapon: "yes" }).success).toBe(false);
  });
});

describe("FR-CRES-15 pactWeapon filter", () => {
  const rule = (on: "hit" | "roll" | "turnStart") =>
    TriggerRule.safeParse({
      on,
      when: [
        ...(on === "roll" ? [{ if: "roll", on: { roll: "damage" } }] : []),
        { if: "pactWeapon" },
      ],
      every: "each",
      then:
        on === "hit"
          ? { do: "damage", formula: "5d8", type: "force" }
          : on === "roll"
            ? { do: "part", formula: "1d8" }
            : { do: "remind", text: "x" },
    }).success;

  test("FR-CRES-15 pactWeapon filter: valid on hit and roll triggers, refused on turnStart", () => {
    expect(rule("hit")).toBe(true);
    expect(rule("roll")).toBe(true);
    expect(rule("turnStart")).toBe(false);
  });

  test("FR-CRES-15 pactWeaponRoll: a weapon roll from a marked row (name, case and spaces ignored)", () => {
    expect(pactWeaponRoll(attacks, subject("weapon", "Starmetal Blaster"))).toBe(true);
    expect(pactWeaponRoll(attacks, subject("weapon", " starmetal blaster"))).toBe(true);
    expect(pactWeaponRoll(attacks, subject("weapon", "Rapier"))).toBe(false);
    expect(pactWeaponRoll(attacks, subject("weapon", "Old Pact Blade"))).toBe(false);
    expect(pactWeaponRoll(attacks, subject("spell", "Starmetal Blaster"))).toBe(false);
    expect(pactWeaponRoll(attacks, subject("weapon"))).toBe(false);
    expect(pactWeaponRoll(undefined, subject("weapon", "Starmetal Blaster"))).toBe(false);
  });

  test("FR-CRES-15 ownerFiltersPass reads the fact; ask stays soft", () => {
    const when = [{ if: "pactWeapon" as const }, { if: "ask" as const, note: "Smite?" }];
    const facts = (pactWeapon?: boolean) => ({
      subject: subject("weapon", "Starmetal Blaster"),
      ownTurn: true,
      mode: "normal" as const,
      ...(pactWeapon === undefined ? {} : { pactWeapon }),
    });
    expect(ownerFiltersPass({ when }, facts(true))).toBe(true);
    expect(ownerFiltersPass({ when }, facts(false))).toBe(false);
    expect(ownerFiltersPass({ when }, facts())).toBe(false);
  });

  test("FR-CRES-15 words: 'with a pact weapon'", () => {
    const smite: TriggerRule = {
      on: "hit",
      when: [{ if: "pactWeapon" }, { if: "ask", note: "Spend a pact slot?" }],
      every: "turn",
      then: { do: "damage", formula: "5d8", type: "force" },
    };
    const cx = { presetName: () => undefined, featureName: () => undefined };
    expect(triggerSentence(smite, cx)).toContain("with a pact weapon");
  });
});
