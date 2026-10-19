// `cbt.rollDamage` (FR-CBT-71, ADR-0037, N7): rolls one row's damage server-side. The attacker's
// latest pending to-hit-only card of the same row gets it (doubled after a natural 20) through
// `updateNotification`; none → a new damage-only card via `notify`. One transaction: roll, roll
// line, card. Healing never makes a card (the sheet never routes it). Sprint 5 (FR-CBT-92): the
// card owner's second roll on a completed pending card makes no card (`unusedRolls`).
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
  UNUSED_ROLLS_MAX,
} from "@shared/combat-tracker/schemas";
import { ROLL_KIND } from "@shared/dice-roll-log/roll-kind";
import { ROLL_ROW_MAX } from "@shared/effect-modifiers/schemas";
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
import { withCardMods } from "../effect-modifiers/card";
import { recordOffers, rollLine, withCardOffers } from "../effect-modifiers/offers";
import { notify } from "../notifications";
import { toNotificationRecord, updateNotification } from "../notifications/helpers";
import { cardRowRef, critLabel } from "./attack";
import { cardRollOf, damageCardText, fitCardPayload } from "./card-kind";
import { activeCombatant } from "./guards";
import { cardExtraOf, checkManualExtra, rollExtraParts, splitParts } from "./parts";

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
  // FR-CBT-81: the base part, then a weapon row's extra parts (CHARX FR-CHARX-55).
  const { base: spec, extra } = splitParts(res.specs);
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
    return { spec, extra: [], name: s.name, damageType: s.damageType ?? null, saveDc };
  }
  const a =
    ref.attackId === undefined
      ? stats.attacks[0]
      : stats.attacks.find((x) => x.id === ref.attackId);
  if (!spec || !a) throw conflict(`No damage roll for ${c.name}`);
  return { spec, extra, name: a.name, damageType: a.damageType ?? null, saveDc: undefined };
}

const sameRef = (p: DamageCardPayload, ref: RowRef) =>
  p.attackId === ref.attackId && p.spellId === ref.spellId;

type PendingCard = { card: NotificationRecord; p: DamageCardPayload };

/**
 * FR-CBT-71: the attacker's latest pending to-hit-only card of this row in the encounter
 * (`toHit`), and FR-CBT-92: the latest pending card of this row whatever its shape (`latest`).
 */
function pendingCards(
  env: CommandEnv,
  enc: EncounterRecord,
  attackerId: string,
  ref: RowRef,
): { toHit: PendingCard | null; latest: PendingCard | null } {
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
  let latest: PendingCard | null = null;
  for (const r of rows) {
    const parsed = DamageCardPayload.safeParse(r.payload);
    if (!parsed.success) continue;
    const p = parsed.data;
    if (p.encounterId !== enc.id || p.attackerId !== attackerId || !sameRef(p, ref)) continue;
    const found = { card: toNotificationRecord(r), p };
    latest ??= found;
    if (p.damage === null && p.toHit !== null) return { toHit: found, latest };
  }
  return { toHit: null, latest };
}

/**
 * FR-CBT-92 (sprint 5, ADR-0053): the card's owner rolls again while its latest pending card of
 * the row is complete (to-hit and damage): that card keeps the roll as unused. The owner = the
 * rolling player of a player card, the DM of a DM card; anyone else makes a new card (FR-CBT-71).
 */
function unusedTarget(env: CommandEnv, latest: PendingCard | null): PendingCard | null {
  if (!latest || latest.p.toHit === null || latest.p.damage === null) return null;
  const a = env.actor;
  const owner =
    latest.card.audience === "player"
      ? a.role === "player" && latest.card.audiencePlayerId === a.playerId
      : a.role === "dm";
  return owner ? latest : null;
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
    checkManualExtra(row.extra, input.manual, input.manualExtra);
    const cards = pendingCards(env, enc, c.id, ref);
    const pending = cards.toHit;
    const unusedOn = pending ? null : unusedTarget(env, cards.latest);
    // A completed card doubles the dice after its natural 20; manual is checked against that.
    const crit = pending?.p.toHit?.natural === 20;
    const damage = dice.evaluate(env, {
      expression: crit ? critExpression(row.spec.expression) : row.spec.expression,
      mode: "normal",
      category: row.spec.category,
      label: crit ? critLabel(row.spec.label) : row.spec.label,
      actor: { kind: "entity", id: c.entityId, name: c.name },
      manual: input.manual,
      ...(input.manualParts ? { manualParts: input.manualParts } : {}),
      source: "cbt",
      // FR-MOD-15/16: damage mods from the effects active now; a completed card's crit doubles.
      subject: {
        creature: c.kind === "pc" ? { characterId: c.entityId } : { combatantId: c.id },
        roll: "damage",
        via: asked.spellId !== undefined ? "spell" : "weapon",
        crit,
        // FR-MOD-13, -37: hit triggers offered on the card's damage; `mode` filters read the
        // completed card's to-hit mode (a damage-only card: normal); `row` filters the row name.
        // FR-CBT-92: an unused roll makes no card, so nothing is offered on it.
        card: unusedOn === null,
        ...(pending ? { toHitMode: pending.p.mode } : {}),
        row: row.name.slice(0, ROLL_ROW_MAX),
      },
    });
    const actor = { kind: "entity" as const, id: c.entityId, name: c.name };
    // FR-CBT-81, -83: every extra part, its own roll row of the entry, doubled on a crit.
    const extra = rollExtraParts(env, row.extra, { crit, actor, manual: input.manualExtra });
    const card = { ...withCardMods(cardRollOf(damage), damage), ...cardExtraOf(row.extra, extra) };
    const isPlayer = env.actor.role === "player";
    // Roll line: a player's is public (FR-DICE-13); the DM's is DM-only (FR-CBT-52), except when
    // it completes a player's card: the owner's rule, so the table sees the damage the player's
    // card now shows. A hidden attacker's line is never public (FR-CBT-24).
    const ownerRule = pending?.card.audience === "player";
    const payload: DamageCardPayload = withCardOffers(
      env,
      pending
        ? { ...pending.p, damage: card }
        : {
            encounterId: enc.id,
            attackerId: c.id,
            attackerName: c.name,
            attackName: row.name,
            damageType: row.damageType,
            mode: "normal",
            crit: false,
            toHit: null,
            damage: card,
            ...ref,
            ...(row.saveDc ? { saveDc: row.saveDc } : {}),
          },
      damage,
    );
    // FR-MOD-14: offered-die rows (after any dropped by the card cap) follow the base roll.
    const rollIds = [damage, ...extra].flatMap((r) => dice.rollIdsOf(r));
    const line = rollLine([damage, ...extra]);
    const entry = gameLog.append(env, {
      kind: ROLL_KIND,
      category: row.spec.category,
      actorName: c.name,
      payload: line.payload,
      dmPayload: line.dmPayload,
      rollIds,
      encounterId: enc.id,
      ...(isPlayer ? {} : { public: ownerRule && !c.hidden }),
    });
    const rolled: DomainEvent<{ cardId: string; rollIds: string[]; attached: boolean }> = {
      type: DamageRolled.type,
      campaignId: enc.campaignId,
      payload: { cardId: pending?.card.id ?? "", rollIds, attached: !!pending },
      changes: [entry],
    };
    env.emit(rolled);
    if (unusedOn) {
      // FR-CBT-92: no card; the completed card keeps the roll (its last 3), text unchanged.
      const total = card.total + extra.reduce((s, x) => s + x.total, 0);
      const unusedRolls = [...(unusedOn.p.unusedRolls ?? []), { rollId: damage.id, total }].slice(
        -UNUSED_ROLLS_MAX,
      );
      rolled.payload.cardId = unusedOn.card.id;
      updateNotification(env, unusedOn.card.id, {
        payload: fitCardPayload({ ...unusedOn.p, unusedRolls }),
      });
      return { cardId: unusedOn.card.id, rollIds, attached: false, unused: true };
    }
    if (pending) {
      updateNotification(env, pending.card.id, {
        text: damageCardText(payload),
        payload: fitCardPayload(payload),
      });
      recordOffers(env, pending.card.id, payload);
      return { cardId: pending.card.id, rollIds, attached: true };
    }
    const cardId = notify(env, {
      kind: DAMAGE_CARD_KIND,
      audience: isPlayer ? "player" : "dm",
      audiencePlayerId: isPlayer ? env.actor.playerId : null,
      text: damageCardText(payload),
      payload: fitCardPayload(payload),
      action: { label: "Apply", role: "dm" },
    });
    rolled.payload.cardId = cardId;
    recordOffers(env, cardId, payload);
    return { cardId, rollIds, attached: false };
  },
});
