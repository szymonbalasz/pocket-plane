// `cbt.attack` (FR-CBT-16–18, FR-CBT-52, #135): rolls to-hit + damage server-side, writes the roll
// line, then creates the damage card via `notify` in the same transaction (ADR-0027). No target:
// the DM picks it in the attack popup (#134). FR-CHARX-24 (OQ-CBT-47): `attackId?` / `spellId?`
// name the sheet row, resolved by CHARX's `sheetAttack`; neither = the first attack.
import { attackRollSpecs } from "@shared/character-sheet/logic";
import { naturalMark } from "@shared/combat-tracker/log-kinds";
import { critExpression } from "@shared/combat-tracker/rules";
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
import { invalid } from "../../commands/errors";
import type { DomainEvent, RecordChange } from "../../events/types";
import { characters } from "../character-sheet";
import { dice, gameLog, type Roll } from "../dice-roll-log";
import { notify } from "../notifications";
import { activeCombatant } from "./guards";

const cardDice = (r: Roll) => r.dice.map((d) => [d.value, d.kept] as [number | null, boolean]);

export const attackCommand = defineCommand({
  name: CBT_INTENTS.attack,
  input: AttackInput,
  roles: ["dm", "player"],
  authorize(input, env) {
    if (env.actor.role === "player") activeCombatant(env, input.attackerId, { own: true });
  },
  execute(input, env): AttackResult {
    // FR-CBT-70: the schema accepts `rolls`; to-hit-only cards land in fix/combat2-split-attack.
    if (input.rolls === "toHit") throw invalid("To-hit-only attacks are not available yet");
    const { c, enc } = activeCombatant(env, input.attackerId, { own: true });
    // The attacker's own definition only: a row of another creature is `not_found` here.
    const attack = characters.sheetAttack(env, c.entityId, {
      attackId: input.attackId,
      spellId: input.spellId,
    });
    const [hitSpec, dmgSpec] = attackRollSpecs(attack);
    const actor = { kind: "entity" as const, id: c.entityId, name: c.name };
    const toHit = dice.evaluate(env, {
      expression: hitSpec.expression,
      mode: input.mode,
      category: hitSpec.category,
      label: hitSpec.label,
      actor,
      manual: input.manual?.[0],
      source: "cbt",
    });
    // FR-CBT-16 / -17: natural 20 → damage dice doubled; manual damage is checked against it.
    const crit = toHit.natural === 20;
    const damage = dice.evaluate(env, {
      expression: crit ? critExpression(dmgSpec.expression) : dmgSpec.expression,
      mode: "normal",
      category: dmgSpec.category,
      label: dmgSpec.label,
      actor,
      manual: input.manual?.[1],
      source: "cbt",
    });
    const rollIds = [toHit.id, damage.id];
    const changes: RecordChange[] = [];
    const isPlayer = env.actor.role === "player";
    // FR-CBT-18: a player's attack → one public roll line now. FR-CBT-52 (#171): a DM's attack
    // (monster or PC) → the same line, always DM-only whatever the Attack tickbox; the outcome
    // line at apply carries the public rule (FR-CBT-24). Rolls are facts: Undo never strikes it.
    changes.push(
      gameLog.append(env, {
        kind: ROLL_KIND,
        category: "attack",
        actorName: c.name,
        payload: [dice.rollPayloadItem(toHit), dice.rollPayloadItem(damage)],
        rollIds,
        encounterId: enc.id,
        ...(isPlayer ? {} : { public: false }),
      }),
    );
    const payload: DamageCardPayload = {
      encounterId: enc.id,
      attackerId: c.id,
      attackerName: c.name,
      attackName: attack.name,
      damageType: attack.damageType,
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
    // FR-CBT-57 (R4): " (natural 1)" / " (natural 20)" after the to-hit.
    const natural = naturalMark(toHit.natural);
    const nat = natural === null ? "" : ` (natural ${natural})`;
    const cardId = notify(env, {
      kind: DAMAGE_CARD_KIND,
      audience: isPlayer ? "player" : "dm",
      audiencePlayerId: isPlayer ? env.actor.playerId : null,
      text: `${c.name}: ${toHit.total} to hit${nat}, ${damage.total}${type}${crit ? " (critical)" : ""}`,
      payload,
      action: { label: "Apply", role: "dm" },
    });
    rolled.payload.cardId = cardId;
    return { cardId, rollIds };
  },
});
