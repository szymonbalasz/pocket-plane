// `cbt.rollDamage` (FR-CBT-71, ADR-0037, N7): rolls one row's damage server-side. The attacker's
// latest pending to-hit-only card of the same row gets it (doubled after a natural 20) through
// `updateNotification`; none → a new damage-only card via `notify`. One transaction: roll, roll
// line, card. Healing never makes a card (the sheet never routes it).
import { characterRolls } from "@shared/character-sheet/logic";
import { critExpression } from "@shared/combat-tracker/rules";
import {
  type CardSaveDc,
  CBT_INTENTS,
  type CombatantRecord,
  DAMAGE_CARD_KIND,
  DamageCardPayload,
  type EncounterRecord,
  RollDamageInput,
  type RollDamageResult,
} from "@shared/combat-tracker/schemas";
import { ROLL_KIND } from "@shared/dice-roll-log/roll-kind";
import { type StatBlock, spellSaveDc } from "@shared/entities/schemas";
import { DamageRolled } from "@shared/events/combat-tracker";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { and, desc, eq } from "drizzle-orm";
import type { z } from "zod";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { conflict, notFound } from "../../commands/errors";
import { entity, notification } from "../../db/schema";
import type { DomainEvent } from "../../events/types";
import { getSheet } from "../character-sheet/sheet-rows";
import { dice, gameLog } from "../dice-roll-log";
import { notify } from "../notifications";
import { toNotificationRecord, updateNotification } from "../notifications/helpers";
import { cardRowRef } from "./attack";
import { cardRollOf, damageCardText } from "./card-kind";
import { activeCombatant } from "./guards";

type RowRef = { attackId?: string; spellId?: string };

/** The row's damage roll spec, name, type and a save spell's DC; `conflict` / `not_found`. */
function damageRow(env: CommandEnv, c: CombatantRecord, ref: RowRef) {
  const row = env.tx
    .select({ statBlock: entity.statBlock, campaignId: entity.campaignId })
    .from(entity)
    .where(eq(entity.id, c.entityId))
    .get();
  if (!row) throw notFound("Creature not found");
  const stats = row.statBlock as StatBlock;
  const sheet = row.campaignId === null ? null : getSheet(env.tx, c.entityId);
  const kind = ref.spellId !== undefined ? "spellDamage" : "damage";
  const res = characterRolls(stats, sheet, kind, ref);
  if (!res.ok) throw res.code === "not_found" ? notFound(res.message) : conflict(res.message);
  const spec = res.specs[0];
  if (ref.spellId !== undefined) {
    const s = sheet?.spells.find((x) => x.id === ref.spellId);
    if (!s || !spec || spec.category !== "damage") {
      throw conflict(`No damage roll for ${s?.name ?? c.name}`);
    }
    const dc = s.roll === "save" && s.saveAbility ? spellSaveDc(stats) : null;
    const saveDc: z.infer<typeof CardSaveDc> | undefined =
      dc !== null && s.saveAbility && dc >= 1 && dc <= 30
        ? { dc, ability: s.saveAbility }
        : undefined;
    return { spec, name: s.name, damageType: s.damageType ?? null, saveDc };
  }
  const a =
    ref.attackId === undefined
      ? stats.attacks[0]
      : stats.attacks.find((x) => x.id === ref.attackId);
  if (!spec || !a) throw conflict(`No damage roll for ${c.name}`);
  return { spec, name: a.name, damageType: a.damageType ?? null, saveDc: undefined };
}

const sameRef = (p: DamageCardPayload, ref: RowRef) =>
  p.attackId === ref.attackId && p.spellId === ref.spellId;

/** FR-CBT-71: the attacker's latest pending to-hit-only card of this row in the encounter. */
function pendingToHitCard(
  env: CommandEnv,
  enc: EncounterRecord,
  attackerId: string,
  ref: RowRef,
): { card: NotificationRecord; p: DamageCardPayload } | null {
  const rows = env.tx
    .select()
    .from(notification)
    .where(
      and(
        eq(notification.campaignId, enc.campaignId),
        eq(notification.kind, DAMAGE_CARD_KIND),
        eq(notification.state, "pending"),
      ),
    )
    .orderBy(desc(notification.seq))
    .all();
  for (const r of rows) {
    const parsed = DamageCardPayload.safeParse(r.payload);
    if (!parsed.success) continue;
    const p = parsed.data;
    if (p.encounterId !== enc.id || p.attackerId !== attackerId) continue;
    if (p.damage !== null || p.toHit === null || !sameRef(p, ref)) continue;
    return { card: toNotificationRecord(r), p };
  }
  return null;
}

export const rollDamageCommand = defineCommand({
  name: CBT_INTENTS.rollDamage,
  input: RollDamageInput,
  roles: ["dm", "player"],
  authorize(input, env) {
    if (env.actor.role === "player") activeCombatant(env, input.attackerId, { own: true });
  },
  execute(input, env): RollDamageResult {
    const { c, enc } = activeCombatant(env, input.attackerId, { own: true });
    const asked = { attackId: input.attackId, spellId: input.spellId };
    const row = damageRow(env, c, asked);
    const ref = cardRowRef(env, c, asked);
    const pending = pendingToHitCard(env, enc, c.id, ref);
    // A completed card doubles the dice after its natural 20; manual is checked against that.
    const crit = pending?.p.toHit?.natural === 20;
    const damage = dice.evaluate(env, {
      expression: crit ? critExpression(row.spec.expression) : row.spec.expression,
      mode: "normal",
      category: row.spec.category,
      label: row.spec.label,
      actor: { kind: "entity", id: c.entityId, name: c.name },
      manual: input.manual,
      source: "cbt",
    });
    const isPlayer = env.actor.role === "player";
    // Roll line: a player's is public (FR-DICE-13); the DM's is DM-only (FR-CBT-52), except when
    // it completes a player's card: the owner's rule, so the table sees the damage the player's
    // card now shows. A hidden attacker's line is never public (FR-CBT-24).
    const ownerRule = pending?.card.audience === "player";
    const entry = gameLog.append(env, {
      kind: ROLL_KIND,
      category: row.spec.category,
      actorName: c.name,
      payload: [dice.rollPayloadItem(damage)],
      rollIds: [damage.id],
      encounterId: enc.id,
      ...(isPlayer ? {} : { public: ownerRule && !c.hidden }),
    });
    const rolled: DomainEvent<{ cardId: string; rollIds: string[]; attached: boolean }> = {
      type: DamageRolled.type,
      campaignId: enc.campaignId,
      payload: { cardId: pending?.card.id ?? "", rollIds: [damage.id], attached: !!pending },
      changes: [entry],
    };
    env.emit(rolled);
    if (pending) {
      const payload: DamageCardPayload = { ...pending.p, damage: cardRollOf(damage) };
      updateNotification(env, pending.card.id, { text: damageCardText(payload), payload });
      return { cardId: pending.card.id, rollIds: [damage.id], attached: true };
    }
    const payload: DamageCardPayload = {
      encounterId: enc.id,
      attackerId: c.id,
      attackerName: c.name,
      attackName: row.name,
      damageType: row.damageType,
      mode: "normal",
      crit: false,
      toHit: null,
      damage: cardRollOf(damage),
      ...ref,
      ...(row.saveDc ? { saveDc: row.saveDc } : {}),
    };
    const cardId = notify(env, {
      kind: DAMAGE_CARD_KIND,
      audience: isPlayer ? "player" : "dm",
      audiencePlayerId: isPlayer ? env.actor.playerId : null,
      text: damageCardText(payload),
      payload,
      action: { label: "Apply", role: "dm" },
    });
    rolled.payload.cardId = cardId;
    return { cardId, rollIds: [damage.id], attached: false };
  },
});
