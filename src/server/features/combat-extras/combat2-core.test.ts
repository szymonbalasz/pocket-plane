// fix/combat2-core: `cbtx.addCombatants` accepts the Add dialog's new options in its schema
// (FR-CBTX-44); until fix/combat2-add builds them, they are refused and old payloads add as before.
import { describe, expect, test } from "bun:test";
import { CBTX_INTENTS } from "@shared/combat-extras/intents";
import { cbtxSetup } from "./testing";

const ADD = CBTX_INTENTS.addCombatants;

describe("FR-CBTX-44 shapes before the add build", () => {
  test("quantity > 1, rolled HP or createTokens → invalid, nothing written; quantity 1 adds as today", () => {
    const t = cbtxSetup();
    const add = (input: Record<string, unknown>) => t.run(ADD, { encounterId: t.enc.id, ...input });
    const n = t.count("combatant");
    for (const input of [
      { items: [{ definitionId: t.h.wolfId, quantity: 2 }] },
      { items: [{ definitionId: t.h.wolfId, hpMode: "rolled" }] },
      { items: [{ definitionId: t.h.wolfId }], createTokens: true },
    ]) {
      expect(t.err(() => add(input)).code).toBe("invalid");
    }
    expect(t.count("combatant")).toBe(n);
    add({
      items: [{ definitionId: t.h.wolfId, quantity: 1, hpMode: "average" }],
      createTokens: false,
      hidden: true,
      at: { col: 1, row: 1 },
    });
    expect(t.count("combatant")).toBe(n + 1);
  });
});
