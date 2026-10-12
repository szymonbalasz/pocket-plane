// `cbt.attack` (FR-CBT-16–18, #135): rolls to-hit + damage server-side, writes the player's roll
// line, then creates the damage card via `notify` in the same transaction (ADR-0027). No target:
// the DM picks it in the attack popup (#134).
import { critExpression, d20Expression } from "@shared/combat-tracker/rules";
import {
  AttackInput,
  type AttackResult,
  CBT_INTENTS,
  DAMAGE_CARD_KIND,
  type DamageCardPayload,
} from "@shared/combat-tracker/schemas";
import { ROLL_KIND } from "@shared/dice-roll-log/roll-kind";
import { AttackRolled } from "@shared/events/combat-tracker";
import { defineCommand } from "../../commands/commands";
import { conflict } from "../../commands/errors";
import type { DomainEvent, RecordChange } from "../../events/types";
import { dice, gameLog, type Roll } from "../dice-roll-log";
import { notify } from "../notifications";
import { activeCombatant, statsOf } from "./guards";

const cardDice = (r: Roll) => r.dice.map((d) => [d.value, d.kept] as [number | null, boolean]);

export const attackCommand = defineCommand({
  name: CBT_INTENTS.attack,
  input: AttackInput,
  roles: ["dm", "player"],
  authorize(input, env) {
    if (env.actor.role === "player") activeCombatant(env, input.attackerId, { own: true });
  },
  execute(input, env): AttackResult {
    const { c, enc } = activeCombatant(env, input.attackerId, { own: true });
    const attack = statsOf(env, c).attacks[0];
    if (!attack) throw conflict("No weapon attack");
    const actor = { kind: "entity" as const, id: c.entityId, name: c.name };
    const toHit = dice.evaluate(env, {
      expression: d20Expression(attack.toHit),
      mode: input.mode,
      category: "attack",
      label: attack.name,
      actor,
      manual: input.manual?.[0],
      source: "cbt",
    });
    // FR-CBT-16 / -17: natural 20 → damage dice doubled; manual damage is checked against it.
    const crit = toHit.natural === 20;
    const damage = dice.evaluate(env, {
      expression: crit ? critExpression(attack.damage) : attack.damage,
      mode: "normal",
      category: "damage",
      label: `${attack.name} damage`,
      actor,
      manual: input.manual?.[1],
      source: "cbt",
    });
    const rollIds = [toHit.id, damage.id];
    const changes: RecordChange[] = [];
    const isPlayer = env.actor.role === "player";
    if (isPlayer) {
      // FR-CBT-18: a player's attack → one public roll line now; a DM's → only at apply.
      changes.push(
        gameLog.append(env, {
          kind: ROLL_KIND,
          category: "attack",
          actorName: c.name,
          payload: [dice.rollPayloadItem(toHit), dice.rollPayloadItem(damage)],
          rollIds,
          encounterId: enc.id,
        }),
      );
    }
    const payload: DamageCardPayload = {
      encounterId: enc.id,
      attackerId: c.id,
      attackerName: c.name,
      attackName: attack.name,
      damageType: attack.damageType ?? null,
      mode: input.mode,
      crit,
      toHit: {
        rollId: toHit.id,
        dice: cardDice(toHit),
        constant: toHit.constant,
        total: toHit.total,
        natural: toHit.natural,
        manual: toHit.manual,
      },
      damage: {
        rollId: damage.id,
        dice: cardDice(damage),
        constant: damage.constant,
        total: damage.total,
        manual: damage.manual,
      },
    };
    // Owner event first, the card's `NotificationCreated` after (protocol §22). The card id is
    // known only once `notify` ran; the payload is validated at commit, so fill it in then.
    const rolled: DomainEvent<{ cardId: string; rollIds: string[] }> = {
      type: AttackRolled.type,
      campaignId: enc.campaignId,
      payload: { cardId: "", rollIds },
      changes,
    };
    env.emit(rolled);
    const type = attack.damageType ? ` ${attack.damageType}` : "";
    const cardId = notify(env, {
      kind: DAMAGE_CARD_KIND,
      audience: isPlayer ? "player" : "dm",
      audiencePlayerId: isPlayer ? env.actor.playerId : null,
      text: `${c.name}: ${toHit.total} to hit, ${damage.total}${type}${crit ? " (critical)" : ""}`,
      payload,
      action: { label: "Apply", role: "dm" },
    });
    rolled.payload.cardId = cardId;
    return { cardId, rollIds };
  },
});
