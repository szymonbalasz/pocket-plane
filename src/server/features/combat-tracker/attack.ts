// `cbt.attack` (FR-CBT-16–18, FR-CBT-52, #135): rolls to-hit + damage server-side, writes the roll
// line, then creates the damage card via `notify` in the same transaction (ADR-0027). No target:
// the DM picks it in the attack popup (#134). FR-CHARX-24 (OQ-CBT-47): `attackId?` / `spellId?`
// name the sheet row, resolved by CHARX's `sheetAttack`; neither = the first attack. FR-CBT-70
// (N7): `rolls: "toHit"` rolls the d20 only, a to-hit-only card that `cbt.rollDamage` completes.
import { attackRollSpecs } from "@shared/character-sheet/logic";
import { critExpression } from "@shared/combat-tracker/rules";
import {
  AttackInput,
  type AttackResult,
  CBT_INTENTS,
  type CombatantRecord,
  DAMAGE_CARD_KIND,
  type DamageCardPayload,
} from "@shared/combat-tracker/schemas";
import { ROLL_KIND } from "@shared/dice-roll-log/roll-kind";
import { LABEL_MAX as ROLL_LABEL_MAX, type RollMode } from "@shared/dice-roll-log/schemas";
import { ROLL_ROW_MAX } from "@shared/effect-modifiers/schemas";
import { AttackRolled } from "@shared/events/combat-tracker";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import type { DomainEvent } from "../../events/types";
import { dice, gameLog } from "../dice-roll-log";
import { withCardMods } from "../effect-modifiers/card";
import { recordOffers, rollLine, withCardOffers } from "../effect-modifiers/offers";
import { notify } from "../notifications";
import { cardRollOf, cardToHitOf, damageCardText, fitCardPayload } from "./card-kind";
import { activeCombatant, attackRefFor, combatantAttack, statsOf } from "./guards";
import { cardExtraOf, checkManualExtra, rollExtraParts } from "./parts";

/**
 * P3 glitch 9: a critical damage roll says so in its label, "Dagger damage (piercing, critical)"
 * ("… (critical)" when the label has no parentheses), so the log line marks the doubled dice.
 */
export function critLabel(label: string): string {
  const [base, tail] = label.endsWith(")")
    ? [label.slice(0, -1), ", critical)"]
    : [label, " (critical)"];
  // Roll labels hold at most 60 characters: a long name gives way ("…") to the marker.
  if (base.length + tail.length <= ROLL_LABEL_MAX) return base + tail;
  let cut = "";
  for (const ch of base) {
    if (cut.length + ch.length + 1 + tail.length > ROLL_LABEL_MAX) break;
    cut += ch;
  }
  return `${cut}…${tail}`;
}

/**
 * FR-CBT-71: the sheet row a card belongs to, so `cbt.rollDamage` completes the card of the same
 * row. No ref = the first attack, named by its id when it has one (a legacy row has none).
 */
export function cardRowRef(
  env: Pick<CommandEnv, "tx">,
  c: CombatantRecord,
  ref: { attackId?: string; spellId?: string },
): { attackId?: string; spellId?: string } {
  if (ref.spellId !== undefined) return { spellId: ref.spellId };
  const attackId = ref.attackId ?? statsOf(env, c).attacks[0]?.id;
  return attackId === undefined ? {} : { attackId };
}

export const attackCommand = defineCommand({
  name: CBT_INTENTS.attack,
  input: AttackInput,
  roles: ["dm", "player"],
  authorize(input, env) {
    if (env.actor.role === "player") activeCombatant(env, input.attackerId, { own: true });
  },
  execute(input, env): AttackResult {
    const { c, enc } = activeCombatant(env, input.attackerId, { own: true });
    // The attacker's own definition only: a row of another creature is `not_found` here.
    // Sprint 6 (FR-CBT-114): a player's companion attack names a card row.
    const ref = attackRefFor(env, c, { attackId: input.attackId, spellId: input.spellId });
    const attack = combatantAttack(env, c, ref);
    // FR-CHARX-55: to-hit and the base part carry `bonus`; FR-CBT-81: the extra parts follow.
    const [hitSpec, dmgSpec, ...extraSpecs] = attackRollSpecs(attack);
    const actor = { kind: "entity" as const, id: c.entityId, name: c.name };
    const toHitOnly = input.rolls === "toHit";
    if (!toHitOnly) checkManualExtra(extraSpecs, input.manual, input.manualExtra);
    // FR-MOD-15: who rolls (a PC combatant = its character), weapon or spell row.
    const creature = c.kind === "pc" ? { characterId: c.entityId } : { combatantId: c.id };
    const via = input.spellId !== undefined ? ("spell" as const) : ("weapon" as const);
    // FR-MOD-13 (#209): the row's name, read by `row` filters.
    const row = attack.name.slice(0, ROLL_ROW_MAX);
    // Every roll of the command goes through here (one place for later roll options).
    const rollOf = (
      spec: typeof hitSpec,
      expression: string,
      i: number,
      subject: {
        roll: "attack" | "damage";
        crit?: boolean;
        card?: boolean;
        toHitMode?: RollMode;
      },
    ) =>
      dice.evaluate(env, {
        expression,
        mode: spec.d20 ? input.mode : "normal",
        category: spec.category,
        label: subject.crit ? critLabel(spec.label) : spec.label,
        actor,
        manual: input.manual?.[i],
        // FR-MOD-18: the physical part groups of this roll (one list per `manual` entry).
        ...(input.manualParts?.[i] ? { manualParts: input.manualParts[i] } : {}),
        source: "cbt",
        subject: { creature, via, row, ...subject },
      });
    const toHit = rollOf(hitSpec, hitSpec.expression, 0, { roll: "attack" });
    // FR-CBT-16 / -17: natural 20 → damage dice doubled; manual damage is checked against it.
    const crit = toHit.natural === 20;
    const damage = toHitOnly
      ? null
      : rollOf(dmgSpec, crit ? critExpression(dmgSpec.expression) : dmgSpec.expression, 1, {
          roll: "damage",
          crit,
          // FR-MOD-37: the card's hit triggers are offered on this roll; `mode` filters read the
          // to-hit's final mode (R4).
          card: true,
          toHitMode: toHit.mode,
        });
    // FR-CBT-81, -83: every extra part, its own roll row of the entry, doubled on a crit.
    const extra = damage
      ? rollExtraParts(env, extraSpecs, { crit, actor, manual: input.manualExtra })
      : [];
    const rolls = damage ? [toHit, damage, ...extra] : [toHit];
    const payload: DamageCardPayload = withCardOffers(
      env,
      {
        encounterId: enc.id,
        attackerId: c.id,
        attackerName: c.name,
        attackName: attack.name,
        damageType: attack.damageType,
        // FR-MOD-37 (R4): the to-hit's final mode (after the roll hooks' `modes()`), not the
        // roller's request; `cbt.rollDamage` hands it to `mode` filters as `toHitMode`.
        mode: toHit.mode,
        crit,
        // FR-MOD-16/19: the card's totals include the parts, `mods` name them.
        toHit: withCardMods(cardToHitOf(toHit), toHit),
        damage: damage
          ? { ...withCardMods(cardRollOf(damage), damage), ...cardExtraOf(extraSpecs, extra) }
          : null,
        ...cardRowRef(env, c, ref),
      },
      damage,
    );
    // FR-MOD-14: bonus-die and offered-die rows follow their base roll (FR-DICE-26).
    const rollIds = rolls.flatMap((r) => dice.rollIdsOf(r));
    const isPlayer = env.actor.role === "player";
    // FR-CBT-18: a player's attack → one public roll line now. FR-CBT-52 (#171): a DM's attack
    // (monster or PC) → the same line, always DM-only whatever the Attack tickbox; the outcome
    // line at apply carries the public rule (FR-CBT-24). Rolls are facts: Undo never strikes it.
    // FR-CBT-70: a to-hit-only attack's line holds the to-hit roll alone.
    // FR-MOD-69: offered parts read the attack's type when untyped.
    const line = rollLine(rolls, attack.damageType ?? null);
    const entry = gameLog.append(env, {
      kind: ROLL_KIND,
      category: "attack",
      actorName: c.name,
      payload: line.payload,
      dmPayload: line.dmPayload,
      rollIds,
      encounterId: enc.id,
      ...(isPlayer ? {} : { public: false }),
      // FR-CBT-114 (ADR-0056): a companion's roll line is DM + owner only, whoever rolls.
      audiencePlayerId: c.kind === "monster" ? c.ownerPlayerId : null,
    });
    // Owner event first, the card's `NotificationCreated` after (protocol §22). The card id is
    // known only once `notify` ran; the payload is validated at commit, so fill it in then.
    const rolled: DomainEvent<{ cardId: string; rollIds: string[] }> = {
      type: AttackRolled.type,
      campaignId: enc.campaignId,
      payload: { cardId: "", rollIds },
      changes: [entry],
    };
    env.emit(rolled);
    const cardId = notify(env, {
      kind: DAMAGE_CARD_KIND,
      audience: isPlayer ? "player" : "dm",
      audiencePlayerId: isPlayer ? env.actor.playerId : null,
      // FR-CBT-57 (R4): " (natural 1)" / " (natural 20)" after the to-hit.
      text: damageCardText(payload),
      payload: fitCardPayload(payload),
      action: { label: "Apply", role: "dm" },
    });
    rolled.payload.cardId = cardId;
    recordOffers(env, cardId, payload);
    return { cardId, rollIds };
  },
});
