// HP changes (FR-CBT-21–25, FR-CBT-34–36): apply a damage card to 1–20 targets, direct damage /
// heal, strict-LIFO undo of one apply at a time. Each is one transaction: HP + combat log entries
// + game-log lines + card state. HP, temp HP, death counters and concentration go through
// combat-extras' `hpRules` (FR-CBTX-01/02): owner event first, then its cards (FR-CBTX-17).

import type {
  AttackLogDmPayload,
  AttackLogPayload,
  AttackLogRolls,
} from "@shared/combat-tracker/log-kinds";
import { hitHint, rawDamage, undoGroup } from "@shared/combat-tracker/rules";
import {
  ApplyCardTargetsInput,
  ApplyHpInput,
  CBT_INTENTS,
  DAMAGE_CARD_KIND,
  DamageCardPayload,
  type DamageCardTargetOutcome,
  type DamageCardTargetsResolution,
  type HpChangeRecord,
  type HpChangeResult,
  type HpChangesResult,
  LOG_KIND_ATTACK,
  LOG_KIND_HP,
  UndoInput,
  type UndoResult,
} from "@shared/combat-tracker/schemas";
import type { DieResult } from "@shared/dice-roll-log/schemas";
import {
  AttackApplied,
  CombatEntryUndone,
  HpApplied,
  type HpChangeFacts,
} from "@shared/events/combat-tracker";
import { and, desc, eq } from "drizzle-orm";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { conflict, notFound } from "../../commands/errors";
import { hpChange, hpChangeSeqNext, roll } from "../../db/schema";
import type { DomainEvent, RecordChange } from "../../events/types";
import { type Applied, hpRules, hpTargetOf } from "../combat-extras/hp-rules";
import { gameLog } from "../dice-roll-log";
import { reopenNotification, resolveNotification } from "../notifications";
import { loadNotification } from "../notifications/helpers";
import { activeCombatant, statsOf } from "./guards";
import {
  campaignOf,
  getCombatant,
  hpChangeChange,
  readCombatant,
  readEncounter,
  readHpChange,
  startedEncounter,
  toHpChangeRecord,
} from "./rows";

type Env = CommandEnv;

type FactsInput = Omit<HpChangeFacts, "hpChangeId">;

/** FR-CBTX-21: the combat-extras columns of a row, from `hpRules.apply`. */
const playFacts = (a: Applied) => ({
  tempBefore: a.tempBefore,
  tempAfter: a.tempAfter,
  deathBefore: a.deathBefore,
  deathAfter: a.deathAfter,
});

function insertHpChange(env: Env, id: string, facts: FactsInput, entryId: string): HpChangeRecord {
  const row = env.tx
    .insert(hpChange)
    .values({
      id,
      campaignId: campaignOf(env.actor),
      seq: hpChangeSeqNext,
      at: env.ctx.clock.iso(),
      ...facts,
      noteIds: [],
      entryId,
      undone: false,
      undoneAt: null,
    })
    .returning()
    .get();
  return toHpChangeRecord(row);
}

/**
 * Emits the owner event, then `hpRules.after` (cards follow it, FR-CBTX-17); the cards it made
 * go into the row's and the event's `noteIds` (the event is validated at commit).
 */
function emitWithCards(
  env: Env,
  type: string,
  a: Applied,
  row: HpChangeRecord,
  facts: FactsInput,
  extra: RecordChange[],
): void {
  const payload: HpChangeFacts = { hpChangeId: row.id, ...facts, noteIds: [] };
  const rowChange = hpChangeChange(null, row);
  const event: DomainEvent = {
    type,
    campaignId: row.campaignId,
    payload,
    changes: [...a.changes, rowChange, ...extra],
  };
  env.emit(event);
  const noteIds = hpRules.after(env, a, { encounterId: row.encounterId, hpChangeId: row.id });
  if (noteIds.length === 0) return;
  env.tx.update(hpChange).set({ noteIds }).where(eq(hpChange.id, row.id)).run();
  payload.noteIds = noteIds;
  rowChange.after = readHpChange(env.tx, row.id);
}

/** A card's roll row: totals for apply, dice for the DM's line (FR-CBT-53). */
function cardRoll(env: Env, id: string) {
  const r = env.tx
    .select({
      total: roll.total,
      natural: roll.natural,
      expression: roll.expression,
      mode: roll.mode,
      manual: roll.manual,
      dice: roll.dice,
      constant: roll.constant,
    })
    .from(roll)
    .where(and(eq(roll.id, id), eq(roll.campaignId, campaignOf(env.actor))))
    .get();
  if (!r) throw new Error(`Damage card roll ${id} missing`);
  const dice = (r.dice as DieResult[]).map((d) => [d.value, d.kept] as [number | null, boolean]);
  return { ...r, dice };
}

export const applyCard = defineCommand({
  name: CBT_INTENTS.applyCard,
  input: ApplyCardTargetsInput,
  execute(input, env): HpChangesResult {
    const card = loadNotification(env, input.cardId);
    if (card.kind !== DAMAGE_CARD_KIND) throw notFound("Damage card not found");
    const p = DamageCardPayload.parse(card.payload);
    const enc = readEncounter(env.tx, p.encounterId);
    // FR-CBT-10: End also dismissed the card (FR-CBT-59); the ended encounter is the reason.
    if (enc.status !== "started") throw conflict("Encounter has ended");
    if (card.state !== "pending") throw conflict("No longer pending");
    // FR-CBT-34: every target active and non-removed, checked before anything is written.
    const targets = input.targets.map((t) => ({ ...t, c: activeCombatant(env, t.targetId).c }));
    const attacker = getCombatant(env.tx, enc.campaignId, p.attackerId);
    // Rolled values come from the card's roll rows, never the client (gems: FR-CBT-32).
    const toHitRoll = cardRoll(env, p.toHit.rollId);
    const damageRoll = cardRoll(env, p.damage.rollId);
    // FR-CBT-53: physical flags for everyone; the dice breakdown for the DM only (FR-DICE-28).
    const manual = { toHit: toHitRoll.manual, damage: damageRoll.manual };
    const rolls: AttackLogRolls = {
      toHit: {
        expression: toHitRoll.expression,
        mode: toHitRoll.mode,
        dice: toHitRoll.dice,
        constant: toHitRoll.constant,
      },
      damage: {
        expression: damageRoll.expression,
        dice: damageRoll.dice,
        constant: damageRoll.constant,
        crit: p.crit,
      },
    };
    const playerCard = card.audience === "player";
    const rollIds = [p.toHit.rollId, p.damage.rollId];
    const hpChangeIds: string[] = [];
    const outcomes: DamageCardTargetOutcome[] = [];
    for (const { c: target, hit, multiplier } of targets) {
      const targetAc = statsOf(env, target).ac;
      const hitComputed = hitHint(toHitRoll.natural, input.toHitTotal, targetAc);
      const raw = rawDamage(hit, input.damageTotal, multiplier);
      // Allocated first: effects ended `down` point at this row (FR-CBTX-16, -22).
      const hpChangeId = env.ctx.ids.next();
      const hp = hpRules.apply(env, hpTargetOf(target), {
        kind: "damage",
        raw,
        crit: p.crit,
        hpChangeId,
      });
      // `applied` = HP lost; temp HP took `absorbed` first (FR-CBTX-15).
      const applied = Math.abs(hp.hpBefore - hp.hpAfter);
      const overkill = Math.max(0, raw - hp.absorbed - hp.hpBefore);
      const logPayload: AttackLogPayload = {
        targetName: target.name,
        attackName: p.attackName,
        damageType: p.damageType,
        toHit: {
          dice: input.toHitTotal === toHitRoll.total ? toHitRoll.total - p.toHit.constant : null,
          constant: p.toHit.constant,
          total: input.toHitTotal,
          natural: toHitRoll.natural,
        },
        hit,
        damage: raw,
        multiplier,
        crit: p.crit,
        manual,
      };
      const dmPayload: AttackLogDmPayload = {
        targetAc,
        hitComputed,
        toHitRolled: toHitRoll.total,
        damageRolled: damageRoll.total,
        damageTotal: input.damageTotal,
        applied,
        overkill,
        overrides: {
          toHit: input.toHitTotal !== toHitRoll.total,
          hit: hit !== hitComputed,
          damage: input.damageTotal !== damageRoll.total,
        },
        rolls,
        ...(hp.absorbed > 0 ? { absorbed: hp.absorbed } : {}),
      };
      // FR-CBT-36: one line per target; never public if the attacker or this target is hidden,
      // else a player's card is public, else the DM's choice / category setting (FR-CBT-24).
      const entry = gameLog.append(env, {
        kind: LOG_KIND_ATTACK,
        category: "attack",
        actorName: p.attackerName,
        payload: logPayload,
        dmPayload,
        rollIds,
        encounterId: enc.id,
        public: attacker.hidden || target.hidden ? false : playerCard ? true : input.public,
      });
      const facts: FactsInput = {
        encounterId: enc.id,
        kind: "damage",
        source: "card",
        cardId: card.id,
        rollIds,
        attackerId: p.attackerId,
        attackerName: p.attackerName,
        attackName: p.attackName,
        damageType: p.damageType,
        targetId: target.id,
        targetEntityId: target.entityId,
        targetName: target.name,
        targetAc,
        toHitRolled: toHitRoll.total,
        toHitTotal: input.toHitTotal,
        natural: toHitRoll.natural,
        hitComputed,
        hit,
        damageRolled: damageRoll.total,
        damageTotal: input.damageTotal,
        multiplier,
        raw,
        applied,
        overkill,
        hpBefore: hp.hpBefore,
        hpAfter: hp.hpAfter,
        ...playFacts(hp),
      };
      const row = insertHpChange(env, hpChangeId, facts, entry.id);
      emitWithCards(env, AttackApplied.type, hp, row, facts, [entry]);
      hpChangeIds.push(row.id);
      // #138: the rolling player sees each outcome; a hidden target's name never. FR-CBTX-15:
      // `applied` = damage dealt (HP lost + absorbed), so a target's temp HP never shows.
      outcomes.push({
        targetName: target.hidden ? null : target.name,
        hit,
        multiplier,
        applied: applied + hp.absorbed,
      });
    }
    const resolution: DamageCardTargetsResolution = { targets: outcomes };
    resolveNotification(env, card.id, resolution);
    return { hpChangeIds };
  },
});

export const applyHp = defineCommand({
  name: CBT_INTENTS.applyHp,
  input: ApplyHpInput,
  execute(input, env): HpChangeResult {
    const { c: target, enc } = activeCombatant(env, input.combatantId);
    const targetAc = statsOf(env, target).ac;
    const hpChangeId = env.ctx.ids.next();
    const hp = hpRules.apply(env, hpTargetOf(target), {
      kind: input.kind,
      raw: input.amount,
      hpChangeId,
    });
    const applied = Math.abs(hp.hpBefore - hp.hpAfter);
    const overkill =
      input.kind === "damage" ? Math.max(0, input.amount - hp.absorbed - hp.hpBefore) : 0;
    const entry = gameLog.append(env, {
      kind: LOG_KIND_HP,
      category: input.kind === "damage" ? "damage" : "healing",
      actorName: "DM",
      payload: { targetName: target.name, kind: input.kind, amount: input.amount },
      dmPayload: {
        applied,
        hpBefore: hp.hpBefore,
        hpAfter: hp.hpAfter,
        ...(hp.absorbed > 0 ? { absorbed: hp.absorbed } : {}),
      },
      rollIds: [],
      encounterId: enc.id,
      public: target.hidden ? false : input.public,
    });
    const facts: FactsInput = {
      encounterId: enc.id,
      kind: input.kind,
      source: "direct",
      cardId: null,
      rollIds: [],
      attackerId: null,
      attackerName: null,
      attackName: null,
      damageType: null,
      targetId: target.id,
      targetEntityId: target.entityId,
      targetName: target.name,
      targetAc,
      toHitRolled: null,
      toHitTotal: null,
      natural: null,
      hitComputed: null,
      hit: null,
      damageRolled: null,
      damageTotal: input.amount,
      multiplier: null,
      raw: input.amount,
      applied,
      overkill,
      hpBefore: hp.hpBefore,
      hpAfter: hp.hpAfter,
      ...playFacts(hp),
    };
    const row = insertHpChange(env, hpChangeId, facts, entry.id);
    emitWithCards(env, HpApplied.type, hp, row, facts, [entry]);
    return { hpChangeId: row.id };
  },
});

/** FR-CBT-35: the encounter's undo unit (latest non-undone entry + its card's), latest first. */
export function undoUnit(env: Pick<CommandEnv, "tx">, encounterId: string): HpChangeRecord[] {
  const rows = env.tx
    .select()
    .from(hpChange)
    .where(and(eq(hpChange.encounterId, encounterId), eq(hpChange.undone, false)))
    .orderBy(desc(hpChange.seq))
    .all()
    .map(toHpChangeRecord);
  return undoGroup(rows);
}

export const undoCommand = defineCommand({
  name: CBT_INTENTS.undo,
  input: UndoInput,
  execute({ expectedHpChangeId }, env): UndoResult {
    const enc = startedEncounter(env.tx, campaignOf(env.actor));
    const unit = enc ? undoUnit(env, enc.id) : [];
    const last = unit[0];
    if (!enc || !last) throw conflict("Nothing to undo");
    if (last.id !== expectedHpChangeId) throw conflict("Something else changed — check Undo");
    const notRestored: string[] = [];
    for (const row of unit) {
      const target = readCombatant(env.tx, row.targetId);
      // I2: the inverse delta, clamped; it restores only this entry's own change. FR-CBTX-22:
      // temp HP, death counters by delta, effects it ended (free slots only).
      const hp = hpRules.revert(env, row, target);
      notRestored.push(...hp.notRestored);
      env.tx
        .update(hpChange)
        .set({ undone: true, undoneAt: env.ctx.clock.iso() })
        .where(eq(hpChange.id, row.id))
        .run();
      const entry = gameLog.markUndone(env, row.entryId);
      env.emit({
        type: CombatEntryUndone.type,
        campaignId: enc.campaignId,
        payload: { hpChangeId: row.id },
        changes: [...hp.changes, hpChangeChange(row, readHpChange(env.tx, row.id)), entry],
      });
      // FR-CBTX-22: this row's pending concentration cards close `undone` after its event.
      hpRules.afterRevert(env, hp);
    }
    // I28: the owner's events first, then the card back to pending (once per apply).
    if (last.cardId) reopenNotification(env, last.cardId);
    return { hpChangeIds: unit.map((r) => r.id), notRestored };
  },
});
