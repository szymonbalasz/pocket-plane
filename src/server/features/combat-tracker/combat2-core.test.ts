// fix/combat2-core: the widened wire shapes stay safe on today's server until the feature
// branches land (fix/combat2-add, -polish, -split-attack): old payloads behave as before; the
// new optional fields never reach a half-built path.
import { describe, expect, test } from "bun:test";
import { type AttackResult, parseFullCard } from "@shared/combat-tracker/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { eq } from "drizzle-orm";
import { hpChange, notification } from "../../db/schema";
import { attackCommand } from "./attack";
import { applyCard } from "./hp";
import { startCommand } from "./lifecycle";
import { combatSetup } from "./testing";

function started() {
  const t = combatSetup();
  const enc = t.createAmbush();
  t.run(startCommand.name, { encounterId: enc.id, sceneId: t.sceneId });
  const id = (name: string) => t.byName(enc.id)[name]?.id as string;
  const card = (cardId: string) =>
    t.s.db.select().from(notification).where(eq(notification.id, cardId)).get() as
      | (NotificationRecord & { payload: unknown })
      | undefined;
  return { ...t, enc, id, card };
}

describe("FR-CBT-70 / -72 shapes before the split-attack build", () => {
  test("cbt.attack: absent / `both` rolls make today's full card; `toHit` → invalid, nothing written", () => {
    const t = started();
    const manual = [{ diceTotal: 15 }, { diceTotal: 4 }];
    const a = t.run<AttackResult>(attackCommand.name, {
      attackerId: t.id("Goblin"),
      rolls: "both",
      manual,
    });
    const p = parseFullCard(t.card(a.cardId)?.payload);
    expect(p.toHit.total).toBeGreaterThan(0);
    expect(p.damage.total).toBeGreaterThan(0);
    const n = t.count("notification");
    expect(
      t.err(() =>
        t.run(attackCommand.name, {
          attackerId: t.id("Goblin"),
          rolls: "toHit",
          manual: [{ diceTotal: 15 }],
        }),
      ).code,
    ).toBe("invalid");
    expect(t.count("notification")).toBe(n);
  });

  test("cbt.applyCard on a full card: a missing total → invalid, nothing written", () => {
    const t = started();
    const a = t.run<AttackResult>(attackCommand.name, {
      attackerId: t.id("Goblin"),
      manual: [{ diceTotal: 15 }, { diceTotal: 4 }],
    });
    const p = parseFullCard(t.card(a.cardId)?.payload);
    const targets = [{ targetId: t.id("Mira"), hit: false, multiplier: "normal" }];
    for (const totals of [{ toHitTotal: p.toHit.total }, { damageTotal: p.damage.total }, {}]) {
      const e = t.err(() => t.run(applyCard.name, { cardId: a.cardId, targets, ...totals }));
      expect(e.code).toBe("invalid");
    }
    expect(t.s.db.select().from(hpChange).all()).toEqual([]);
    expect(t.card(a.cardId)?.state).toBe("pending");
  });
});
