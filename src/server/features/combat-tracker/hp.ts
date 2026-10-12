// HP changes (FR-CBT-20–25): apply a damage card, direct damage / heal, strict-LIFO undo. Each
// is one transaction: HP + combat log entry + game-log line + card state.

import type { AttackLogDmPayload, AttackLogPayload } from "@shared/combat-tracker/log-kinds";
import { clampHp, hitHint, rawDamage } from "@shared/combat-tracker/rules";
import {
  ApplyCardInput,
  ApplyHpInput,
  CBT_INTENTS,
  type CombatantRecord,
  DAMAGE_CARD_KIND,
  DamageCardPayload,
  type DamageCardResolution,
  type HpChangeRecord,
  type HpChangeResult,
  LOG_KIND_ATTACK,
  LOG_KIND_HP,
  UndoInput,
} from "@shared/combat-tracker/schemas";
import {
  AttackApplied,
  CombatEntryUndone,
  HpApplied,
  type HpChangeFacts,
} from "@shared/events/combat-tracker";
import { and, desc, eq } from "drizzle-orm";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { conflict, notFound } from "../../commands/errors";
import { combatant, entity, hpChange, hpChangeSeqNext, roll } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { gameLog } from "../dice-roll-log";
import { reopenNotification, resolveNotification } from "../notifications";
import { loadNotification } from "../notifications/helpers";
import { activeCombatant, statsOf } from "./guards";
import { adjustPcHp } from "./pc-hp";
import {
  campaignOf,
  combatantChange,
  getCombatant,
  hpChangeChange,
  readCombatant,
  readEncounter,
  readHpChange,
  startedEncounter,
  toHpChangeRecord,
} from "./rows";

type Env = Pick<CommandEnv, "tx" | "ctx" | "actor">;

/** FR-CBT-22: monster → own HP clamped 0…hpMax; PC → `characters.adjustHp`. */
function applyDelta(
  env: Env,
  c: CombatantRecord,
  delta: number,
): { hpBefore: number; hpAfter: number; changes: RecordChange[] } {
  if (c.kind === "pc") {
    if (delta === 0) {
      const hp =
        env.tx.select({ hp: entity.hpCurrent }).from(entity).where(eq(entity.id, c.entityId)).get()
          ?.hp ?? 0;
      return { hpBefore: hp, hpAfter: hp, changes: [] };
    }
    const r = adjustPcHp(env, c.entityId, delta);
    return { hpBefore: r.hpBefore, hpAfter: r.hpAfter, changes: [r.change] };
  }
  const before = readCombatant(env.tx, c.id);
  const hpBefore = before.hpCurrent ?? 0;
  const hpAfter = clampHp(hpBefore, delta, before.hpMax ?? 0);
  if (hpAfter === hpBefore) return { hpBefore, hpAfter, changes: [] };
  env.tx.update(combatant).set({ hpCurrent: hpAfter }).where(eq(combatant.id, c.id)).run();
  return { hpBefore, hpAfter, changes: [combatantChange(before, readCombatant(env.tx, c.id))] };
}

type FactsInput = Omit<HpChangeFacts, "hpChangeId">;

function insertHpChange(env: Env, facts: FactsInput, entryId: string): HpChangeRecord {
  const id = env.ctx.ids.next();
  const row = env.tx
    .insert(hpChange)
    .values({
      id,
      campaignId: campaignOf(env.actor),
      seq: hpChangeSeqNext,
      at: env.ctx.clock.iso(),
      ...facts,
      entryId,
      undone: false,
      undoneAt: null,
    })
    .returning()
    .get();
  return toHpChangeRecord(row);
}

function rollTotal(env: Env, id: string): { total: number; natural: number | null } {
  const r = env.tx
    .select({ total: roll.total, natural: roll.natural })
    .from(roll)
    .where(and(eq(roll.id, id), eq(roll.campaignId, campaignOf(env.actor))))
    .get();
  if (!r) throw new Error(`Damage card roll ${id} missing`);
  return r;
}

export const applyCard = defineCommand({
  name: CBT_INTENTS.applyCard,
  input: ApplyCardInput,
  execute(input, env): HpChangeResult {
    const card = loadNotification(env, input.cardId);
    if (card.kind !== DAMAGE_CARD_KIND) throw notFound("Damage card not found");
    if (card.state !== "pending") throw conflict("No longer pending");
    const p = DamageCardPayload.parse(card.payload);
    const enc = readEncounter(env.tx, p.encounterId);
    if (enc.status !== "started") throw conflict("Encounter has ended");
    const { c: target } = activeCombatant(env, input.targetId);
    const attacker = getCombatant(env.tx, enc.campaignId, p.attackerId);
    // FR-CBT-20: rolled values come from the card's roll rows, never the client (gems: FR-CBT-32).
    const toHitRoll = rollTotal(env, p.toHit.rollId);
    const damageRoll = rollTotal(env, p.damage.rollId);
    const targetAc = statsOf(env, target).ac;
    const hitComputed = hitHint(toHitRoll.natural, input.toHitTotal, targetAc);
    const raw = rawDamage(input.hit, input.damageTotal, input.multiplier);
    const hp = applyDelta(env, target, -raw);
    const applied = Math.abs(hp.hpBefore - hp.hpAfter);
    const overkill = Math.max(0, raw - hp.hpBefore);
    // FR-CBT-24: hidden attacker or target → never public; a player's card → public.
    const hidden = attacker.hidden || target.hidden;
    const playerCard = card.audience === "player";
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
      hit: input.hit,
      damage: raw,
      multiplier: input.multiplier,
      crit: p.crit,
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
        hit: input.hit !== hitComputed,
        damage: input.damageTotal !== damageRoll.total,
      },
    };
    const entry = gameLog.append(env, {
      kind: LOG_KIND_ATTACK,
      category: "attack",
      actorName: p.attackerName,
      payload: logPayload,
      dmPayload,
      rollIds: [p.toHit.rollId, p.damage.rollId],
      encounterId: enc.id,
      public: hidden ? false : playerCard ? true : input.public,
    });
    const facts: FactsInput = {
      encounterId: enc.id,
      kind: "damage",
      source: "card",
      cardId: card.id,
      rollIds: [p.toHit.rollId, p.damage.rollId],
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
      hit: input.hit,
      damageRolled: damageRoll.total,
      damageTotal: input.damageTotal,
      multiplier: input.multiplier,
      raw,
      applied,
      overkill,
      hpBefore: hp.hpBefore,
      hpAfter: hp.hpAfter,
    };
    const row = insertHpChange(env, facts, entry.id);
    env.emit({
      type: AttackApplied.type,
      campaignId: enc.campaignId,
      payload: { hpChangeId: row.id, ...facts },
      changes: [...hp.changes, hpChangeChange(null, row), entry],
    });
    const resolution: DamageCardResolution = {
      targetName: target.hidden ? null : target.name,
      hit: input.hit,
      multiplier: input.multiplier,
      applied,
    };
    resolveNotification(env, card.id, resolution);
    return { hpChangeId: row.id };
  },
});

export const applyHp = defineCommand({
  name: CBT_INTENTS.applyHp,
  input: ApplyHpInput,
  execute(input, env): HpChangeResult {
    const { c: target, enc } = activeCombatant(env, input.combatantId);
    const targetAc = statsOf(env, target).ac;
    const delta = input.kind === "damage" ? -input.amount : input.amount;
    const hp = applyDelta(env, target, delta);
    const applied = Math.abs(hp.hpBefore - hp.hpAfter);
    const overkill = input.kind === "damage" ? Math.max(0, input.amount - hp.hpBefore) : 0;
    const entry = gameLog.append(env, {
      kind: LOG_KIND_HP,
      category: input.kind === "damage" ? "damage" : "healing",
      actorName: "DM",
      payload: { targetName: target.name, kind: input.kind, amount: input.amount },
      dmPayload: { applied, hpBefore: hp.hpBefore, hpAfter: hp.hpAfter },
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
    };
    const row = insertHpChange(env, facts, entry.id);
    env.emit({
      type: HpApplied.type,
      campaignId: enc.campaignId,
      payload: { hpChangeId: row.id, ...facts },
      changes: [...hp.changes, hpChangeChange(null, row), entry],
    });
    return { hpChangeId: row.id };
  },
});

/** FR-CBT-25: the latest non-undone combat log entry of the started encounter, by `seq`. */
export function latestUndoable(env: Pick<CommandEnv, "tx">, encounterId: string) {
  const r = env.tx
    .select()
    .from(hpChange)
    .where(and(eq(hpChange.encounterId, encounterId), eq(hpChange.undone, false)))
    .orderBy(desc(hpChange.seq))
    .limit(1)
    .get();
  return r ? toHpChangeRecord(r) : null;
}

export const undoCommand = defineCommand({
  name: CBT_INTENTS.undo,
  input: UndoInput,
  execute({ expectedHpChangeId }, env): HpChangeResult {
    const enc = startedEncounter(env.tx, campaignOf(env.actor));
    const last = enc ? latestUndoable(env, enc.id) : null;
    if (!enc || !last) throw conflict("Nothing to undo");
    if (last.id !== expectedHpChangeId) throw conflict("Something else changed — check Undo");
    const target = readCombatant(env.tx, last.targetId);
    // I2: the inverse delta, clamped; it restores only this entry's own change.
    const hp = applyDelta(env, target, last.kind === "damage" ? last.applied : -last.applied);
    env.tx
      .update(hpChange)
      .set({ undone: true, undoneAt: env.ctx.clock.iso() })
      .where(eq(hpChange.id, last.id))
      .run();
    const entry = gameLog.markUndone(env, last.entryId);
    env.emit({
      type: CombatEntryUndone.type,
      campaignId: enc.campaignId,
      payload: { hpChangeId: last.id },
      changes: [...hp.changes, hpChangeChange(last, readHpChange(env.tx, last.id)), entry],
    });
    // I28: the owner's event first, then the card back to pending.
    if (last.cardId) reopenNotification(env, last.cardId);
    return { hpChangeId: last.id };
  },
});
