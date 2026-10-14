// Polish pass (sprint 1, #178), in-process: FR-CBT-57 card text.
import { describe, expect, test } from "bun:test";
import type { AttackResult } from "@shared/combat-tracker/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { eq } from "drizzle-orm";
import { notification } from "../../db/schema";
import { attackCommand } from "./attack";
import { startCommand } from "./lifecycle";
import { combatSetup } from "./testing";

function started() {
  const t = combatSetup();
  const enc = t.createAmbush();
  t.run(startCommand.name, { encounterId: enc.id, sceneId: t.sceneId });
  const id = (name: string) => t.byName(enc.id)[name]?.id as string;
  const card = (cardId: string) =>
    t.s.db.select().from(notification).where(eq(notification.id, cardId)).get() as
      | NotificationRecord
      | undefined;
  const attack = (name: string, toHit: number, damage: number, actor = t.h.dm) =>
    t.run<AttackResult>(
      attackCommand.name,
      { attackerId: id(name), manual: [{ diceTotal: toHit }, { diceTotal: damage }] },
      actor,
    );
  return { ...t, enc, id, card, attack };
}

describe("FR-CBT-57 card text", () => {
  test("FR-CBT-57 card text: d20 1 → '(natural 1)'; d20 20 → '(natural 20)' + '(critical)'; else unchanged", () => {
    const t = started();
    expect(t.card(t.attack("Mira", 1, 4, t.p1).cardId)?.text).toBe(
      "Mira: 5 to hit (natural 1), 6 piercing",
    );
    // Crit: damage dice doubled (2d6 for Shortsword 1d6+2), manual total checked against it.
    expect(t.card(t.attack("Mira", 20, 7, t.p1).cardId)?.text).toBe(
      "Mira: 24 to hit (natural 20), 9 piercing (critical)",
    );
    expect(t.card(t.attack("Mira", 9, 4, t.p1).cardId)?.text).toBe("Mira: 13 to hit, 6 piercing");
  });
});
