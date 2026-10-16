// FR-MOD-36 (review R5; R0 column): a preset started from a built-in stores `originKey`;
// `mod.putPreset` accepts only a built-in key, keeps it on a replace that doesn't name it, and
// refuses it on a customised built-in.
import { describe, expect, test } from "bun:test";
import { MOD_INTENTS } from "@shared/effect-modifiers/intents";
import { modSetup } from "./testing";

describe("FR-MOD-36 effect preset originKey (R0)", () => {
  test("FR-MOD-36 Start from a built-in stores originKey; a replace without it keeps it; null clears", () => {
    const t = modSetup();
    const id = t.put(t.from("rage", { characterId: t.miraId, originKey: "rage" }));
    expect(t.preset(id).originKey).toBe("rage");
    t.put(t.from("rage", { id, characterId: t.miraId, name: "Mira's Rage" }));
    expect(t.preset(id)).toMatchObject({ name: "Mira's Rage", originKey: "rage" });
    t.put(t.from("rage", { id, characterId: t.miraId, originKey: null }));
    expect(t.preset(id).originKey).toBeNull();
    expect(t.preset(t.put(t.from("bless"))).originKey).toBeNull();
  });

  test("FR-MOD-36 only a built-in key; never on a customised built-in → invalid", () => {
    const t = modSetup();
    const code = (preset: unknown) => t.err(() => t.run(MOD_INTENTS.putPreset, { preset })).code;
    expect(code(t.from("rage", { originKey: "pr-123" as "rage" }))).toBe("invalid");
    expect(code(t.from("bless", { key: "bless", originKey: "bless" }))).toBe("invalid");
  });
});
