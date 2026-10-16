// biome-ignore-all lint/suspicious/noThenProperty: `then` is the rule's effect field (MOD §8.4); rules are data, never awaited.
// `rule-trigger` record shapes and the player redaction (FR-MOD-32, -47; R0).
import { describe, expect, test } from "bun:test";
import {
  MISSING_PRESET_NAME,
  PlayerRuleTriggerRecord,
  RuleTriggerRecord,
  redactRuleForPlayer,
  rulePresetRefs,
} from "./trigger-records";
import type { TriggerRule } from "./triggers";

const hex: TriggerRule = {
  on: "hit",
  requires: { preset: "pr-campaign-hexx" },
  when: [
    { if: "via", via: "weapon" },
    { if: "targetMarked", preset: "pr-campaign-hexx" },
  ],
  every: "each",
  then: { do: "damage", formula: "1d6", type: "necrotic" },
};
const record = (rule: TriggerRule) => ({
  id: "trg-1",
  campaignId: "c1",
  seq: 1,
  characterId: "brakka",
  definitionId: null,
  ownerPlayerId: "p1",
  name: "Hex",
  enabled: true,
  public: true,
  rule,
  updatedAt: "t",
});

describe("rule-trigger records (FR-MOD-32, -47)", () => {
  test("FR-MOD-32 exactly one owner; definition triggers carry no owner player; name 1–40", () => {
    const r = record(hex);
    expect(RuleTriggerRecord.parse(r)).toEqual(r);
    expect(RuleTriggerRecord.safeParse({ ...r, definitionId: "troll" }).success).toBe(false);
    expect(RuleTriggerRecord.safeParse({ ...r, characterId: null }).success).toBe(false);
    const def = { ...r, characterId: null, definitionId: "troll", ownerPlayerId: null };
    expect(RuleTriggerRecord.safeParse(def).success).toBe(true);
    expect(RuleTriggerRecord.safeParse({ ...def, ownerPlayerId: "p1" }).success).toBe(false);
    expect(RuleTriggerRecord.safeParse({ ...r, name: "x".repeat(41) }).success).toBe(false);
    expect(RuleTriggerRecord.safeParse({ ...r, name: "" }).success).toBe(false);
  });

  test("FR-MOD-47 player redaction: built-in keys and own preset ids kept, campaign preset ids → {name}", () => {
    expect(rulePresetRefs(hex)).toEqual(["pr-campaign-hexx"]);
    const out = redactRuleForPlayer(hex, { "pr-campaign-hexx": { name: "Hex" } });
    expect(out.requires).toEqual({ name: "Hex" });
    expect(out.when[1]).toEqual({ if: "targetMarked", name: "Hex" });
    expect(JSON.stringify(out)).not.toContain("pr-campaign-hexx");
    expect(PlayerRuleTriggerRecord.parse({ ...record(hex), rule: out }).rule).toEqual(out);
    // The character's own preset (toggled Rage) and built-in keys stay as they are.
    const fury: TriggerRule = {
      ...hex,
      requires: { preset: "pr-own-rage" },
      when: [{ if: "targetMarked", preset: "hunters-mark" }],
    };
    expect(rulePresetRefs(fury)).toEqual(["pr-own-rage"]);
    expect(redactRuleForPlayer(fury, { "pr-own-rage": { own: true } })).toEqual(fury);
    const rage: TriggerRule = { ...hex, requires: { preset: "rage" }, when: [] };
    expect(redactRuleForPlayer(rage, {})).toEqual(rage);
  });

  test("FR-MOD-47 fail closed: an unknown ref becomes {name: Missing preset}, never its id", () => {
    const out = redactRuleForPlayer(hex, {});
    expect(out.requires).toEqual({ name: MISSING_PRESET_NAME });
    expect(JSON.stringify(out)).not.toContain("pr-campaign-hexx");
  });
});
