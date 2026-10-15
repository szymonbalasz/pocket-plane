// Sprint-2 P2a CBTX zod (fix/combat2-core): Add dialog options (FR-CBTX-44), bind / unlink
// (FR-CBTX-45). Old `cbtx.addCombatants` payloads keep parsing.
import { describe, expect, test } from "bun:test";
import { AddCombatantsInput, BindTokenInput, CBTX_INTENTS } from "./intents";

const ok = (s: { safeParse(v: unknown): { success: boolean } }, v: unknown) =>
  s.safeParse(v).success;

describe("FR-CBTX-44 cbtx.addCombatants options", () => {
  test("old payloads parse; definition items gain quantity 1–20 and hpMode", () => {
    expect(
      ok(AddCombatantsInput, {
        encounterId: "e",
        items: [{ tokenId: "t" }, { characterId: "c" }, { definitionId: "g" }],
      }),
    ).toBe(true);
    expect(
      ok(AddCombatantsInput, {
        encounterId: "e",
        items: [{ definitionId: "g", quantity: 3, hpMode: "rolled" }],
        createTokens: true,
        hidden: false,
        at: { col: 3, row: 4 },
      }),
    ).toBe(true);
    expect(
      ok(AddCombatantsInput, { encounterId: "e", items: [{ definitionId: "g", quantity: 0 }] }),
    ).toBe(false);
    expect(
      ok(AddCombatantsInput, { encounterId: "e", items: [{ tokenId: "t", quantity: 2 }] }),
    ).toBe(false);
    expect(
      ok(AddCombatantsInput, { encounterId: "e", items: [{ definitionId: "g", hpMode: "max" }] }),
    ).toBe(false);
  });

  test("≤ 20 instances per call (a definition item counts its quantity)", () => {
    const items = (n: number) => [{ definitionId: "g", quantity: n }, { tokenId: "t" }];
    expect(ok(AddCombatantsInput, { encounterId: "e", items: items(19) })).toBe(true);
    expect(ok(AddCombatantsInput, { encounterId: "e", items: items(20) })).toBe(false);
  });
});

describe("FR-CBTX-45 cbtx.bindToken", () => {
  test("{combatantId, tokenId} links; tokenId null unlinks; strict", () => {
    expect(CBTX_INTENTS.bindToken).toBe("cbtx.bindToken");
    expect(ok(BindTokenInput, { combatantId: "k", tokenId: "t" })).toBe(true);
    expect(ok(BindTokenInput, { combatantId: "k", tokenId: null })).toBe(true);
    expect(ok(BindTokenInput, { combatantId: "k" })).toBe(false);
    expect(ok(BindTokenInput, { combatantId: "k", tokenId: "t", hidden: true })).toBe(false);
  });
});
