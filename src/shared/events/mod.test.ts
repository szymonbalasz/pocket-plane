// effect-modifiers events (MOD §9): registered once, logged, not undoable; strict payloads.
import { describe, expect, test } from "bun:test";
import {
  EffectModifiersSet,
  EffectPresetDeleted,
  EffectPresetSaved,
  EffectToggled,
  PresetApplied,
  RuleTriggerDeleted,
  RuleTriggerSaved,
} from "./effect-modifiers";
import { domainEvents } from "./index";

const MOD_EVENTS = [
  "EffectPresetSaved",
  "EffectPresetDeleted",
  "PresetApplied",
  "EffectToggled",
  "EffectModifiersSet",
  "RuleTriggerSaved",
  "RuleTriggerDeleted",
];

const roundTrip = (s: { parse(v: unknown): unknown }, v: unknown) =>
  expect(s.parse(JSON.parse(JSON.stringify(v)))).toEqual(v);

describe("MOD domain events (§9)", () => {
  test("MOD §9 all 7 events registered once, logged, none undoable", () => {
    const defs = domainEvents.filter((e) => MOD_EVENTS.includes(e.type));
    expect(defs.map((e) => e.type).sort()).toEqual([...MOD_EVENTS].sort());
    expect(defs.every((e) => e.logged && !e.undoable)).toBe(true);
    const types = domainEvents.map((e) => e.type);
    expect(new Set(types).size).toBe(types.length);
  });

  test("FR-MOD-06/07/08 preset and modifier events round-trip; strict", () => {
    roundTrip(EffectPresetSaved.payload, { presetId: "pr-1" });
    roundTrip(EffectPresetDeleted.payload, { presetId: "pr-1" });
    roundTrip(EffectModifiersSet.payload, { effectId: "fx-1" });
    expect(EffectPresetSaved.payload.safeParse({ presetId: "pr", name: "Bless" }).success).toBe(
      false,
    );
    expect(EffectModifiersSet.payload.safeParse({ effectId: "" }).success).toBe(false);
  });

  test("FR-MOD-09/10/11 apply and toggle events round-trip", () => {
    roundTrip(PresetApplied.payload, { presetKey: "bless", effectIds: ["fx-1", "fx-2"] });
    roundTrip(PresetApplied.payload, {
      presetKey: "pr-7",
      effectIds: [],
      concentrationId: "fx-0",
    });
    expect(
      PresetApplied.payload.safeParse({ presetKey: "bless", effectIds: Array(21).fill("x") })
        .success,
    ).toBe(false);
    const toggle = { characterId: "thorn", presetId: "pr-2", on: true, effectId: "fx-9" };
    roundTrip(EffectToggled.payload, toggle);
    roundTrip(EffectToggled.payload, { ...toggle, on: false });
    expect(EffectToggled.payload.safeParse({ ...toggle, effectId: null }).success).toBe(false);
  });

  test("FR-MOD-45 RuleTriggerSaved / RuleTriggerDeleted carry the trigger id only; strict", () => {
    roundTrip(RuleTriggerSaved.payload, { triggerId: "trg-1" });
    roundTrip(RuleTriggerDeleted.payload, { triggerId: "trg-1" });
    expect(RuleTriggerSaved.payload.safeParse({ triggerId: "t", name: "Fury" }).success).toBe(
      false,
    );
    expect(RuleTriggerDeleted.payload.safeParse({ triggerId: "" }).success).toBe(false);
  });
});
