// Sprint-2 P2a events (fix/combat2-core): DamageRolled (FR-CBT-71), CombatantBound (FR-CBTX-45),
// NotificationUpdated (FR-NOTE-25). Registered once (combat.test.ts / cbtx.test.ts lists),
// logged, not undoable; strict payloads.
import { describe, expect, test } from "bun:test";
import { CombatantBound } from "./combat-extras";
import { DamageRolled } from "./combat-tracker";
import { domainEvents } from "./index";
import { NotificationUpdated } from "./notifications";

const roundTrip = (s: { parse(v: unknown): unknown }, v: unknown) =>
  expect(s.parse(JSON.parse(JSON.stringify(v)))).toEqual(v);

describe("P2a domain events", () => {
  test("registered, logged, not undoable", () => {
    for (const type of ["DamageRolled", "CombatantBound", "NotificationUpdated"]) {
      const defs = domainEvents.filter((e) => e.type === type);
      expect(defs).toHaveLength(1);
      expect(defs[0]?.logged).toBe(true);
      expect(defs[0]?.undoable).toBe(false);
    }
  });

  test("FR-CBT-71 DamageRolled {cardId, rollIds ≥ 1, attached}", () => {
    roundTrip(DamageRolled.payload, { cardId: "n1", rollIds: ["r1"], attached: true });
    roundTrip(DamageRolled.payload, { cardId: "n1", rollIds: ["r1", "r2"], attached: false });
    expect(
      DamageRolled.payload.safeParse({ cardId: "n1", rollIds: [], attached: true }).success,
    ).toBe(false);
    expect(DamageRolled.payload.safeParse({ cardId: "n1", rollIds: ["r1"] }).success).toBe(false);
    expect(
      DamageRolled.payload.safeParse({ cardId: "n1", rollIds: ["r1"], attached: true, x: 1 })
        .success,
    ).toBe(false);
  });

  test("FR-CBTX-45 CombatantBound: tokenId or null (unlink)", () => {
    roundTrip(CombatantBound.payload, { combatantId: "k", tokenId: "t" });
    roundTrip(CombatantBound.payload, { combatantId: "k", tokenId: null });
    expect(CombatantBound.payload.safeParse({ combatantId: "k" }).success).toBe(false);
  });

  test("FR-NOTE-25 NotificationUpdated {notificationId, kind}", () => {
    roundTrip(NotificationUpdated.payload, { notificationId: "n", kind: "damage-card" });
    expect(
      NotificationUpdated.payload.safeParse({ notificationId: "n", kind: "k", text: "x" }).success,
    ).toBe(false);
  });
});
