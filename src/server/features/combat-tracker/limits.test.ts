// Max-size inputs a legal creature form allows (Phase 4 audit #1a, #1b): the derived roll label
// and the damage card payload must fit their caps, or `cbt.attack` fails on spec-legal input.
import { describe, expect, test } from "bun:test";
import { type AttackResult, parseFullCard } from "@shared/combat-tracker/schemas";
import { LABEL_MAX } from "@shared/dice-roll-log/schemas";
import { jsonBytes, PAYLOAD_MAX_BYTES } from "@shared/notifications/schemas";
import { MAP_INTENTS } from "@shared/scenes-map/schemas";
import { eq } from "drizzle-orm";
import { notification, roll } from "../../db/schema";
import { UPDATE } from "../entities/commands";
import { miraBlock } from "../entities/testing";
import { attackCommand } from "./attack";
import { DAMAGE_CARD_PAYLOAD_MAX_BYTES } from "./card-kind";
import { startCommand } from "./lifecycle";
import { combatSetup, eliteBlock } from "./testing";

function started(attack: Record<string, unknown>, tokenName?: string) {
  const t = combatSetup();
  if (tokenName) t.run(MAP_INTENTS.updateToken, { tokenId: t.tokens.elite, name: tokenName });
  t.run(UPDATE, {
    id: t.eliteId,
    name: "Elite Goblin Warrior",
    statBlock: { ...eliteBlock, attacks: [attack] },
  });
  const enc = t.createAmbush();
  t.run(startCommand.name, { encounterId: enc.id, sceneId: t.sceneId });
  const elite = t.combatants(enc.id).find((c) => c.entityId === t.eliteId);
  if (!elite) throw new Error("no elite combatant");
  return { ...t, elite };
}

describe("hardening: max-size attack inputs", () => {
  test("FR-CHAR-08 FR-CBT-16 40-char attack name + bludgeoning: label cut to 60, attack succeeds", () => {
    const name = "W".repeat(40);
    const t = started({
      name,
      toHit: 5,
      damage: "1d6+3",
      damageType: "bludgeoning",
    });
    // BL-14: seeded dice, so a natural 20 (crit label "… (critical)") never flakes the check.
    const r = t.run<AttackResult>(attackCommand.name, { attackerId: t.elite.id }, t.h.dm, "bl-14");
    const natural = t.s.db
      .select()
      .from(roll)
      .where(eq(roll.id, r.rollIds[0] as string))
      .get();
    expect(natural?.natural).not.toBe(20);
    const labels = r.rollIds.map(
      (id) => t.s.db.select().from(roll).where(eq(roll.id, id)).get()?.label,
    );
    expect(labels[0]).toBe(`${name} attack`);
    expect(labels[1]).toHaveLength(LABEL_MAX);
    expect(labels[1]?.endsWith("…")).toBe(true);

    // char.roll (attack) builds the same labels.
    t.run(UPDATE, {
      id: t.miraId,
      name: "Mira",
      ownerPlayerId: t.h.p1.id,
      statBlock: {
        ...miraBlock,
        attacks: [{ name, toHit: 4, damage: "1d4", damageType: "bludgeoning" }],
      },
    });
    const c = t.run<{ rollIds: string[] }>(
      "char.roll",
      { characterId: t.miraId, kind: "attack" },
      t.p1,
      "bl-14-char",
    );
    expect(c.rollIds).toHaveLength(2);
  });

  test("FR-NOTE-03 FR-CBT-16 crit card at max size with 3-byte names fits damage-card's 4 KB cap", () => {
    // Token (= combatant) name 40 × 4-byte, attack 40 × 3-byte, 20d100+30 → crit 40d100+30 with
    // every die recorded.
    const attackerName = "\u{1F409}".repeat(40);
    const attackName = "い".repeat(40);
    const t = started(
      { name: attackName, toHit: 30, damage: "20d100+30", damageType: "bludgeoning" },
      attackerName,
    );
    const r = t.run<AttackResult>(attackCommand.name, {
      attackerId: t.elite.id,
      manual: [
        { diceTotal: 20, dice: [20] },
        { diceTotal: 4000, dice: Array(40).fill(100) },
      ],
    });
    const card = t.s.db.select().from(notification).where(eq(notification.id, r.cardId)).get();
    const payload = parseFullCard(card?.payload);
    expect(payload.crit).toBe(true);
    expect([payload.attackerName, payload.attackName]).toEqual([attackerName, attackName]);
    expect(payload.damage.dice).toHaveLength(40);
    const bytes = jsonBytes(payload);
    expect(bytes).toBeGreaterThan(PAYLOAD_MAX_BYTES); // over the 1 KB default…
    expect(bytes).toBeLessThan(DAMAGE_CARD_PAYLOAD_MAX_BYTES / 2); // …well under the kind's cap
  });
});
