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
import { conflict, invalid, notFound } from "../../commands/errors";
import { hpChange, hpChangeSeqNext, roll } from "../../db/schema";
import type { DomainEvent, RecordChange } from "../../events/types";
import { type Applied, hpRules, hpTargetOf } from "../combat-extras/hp-rules";
import { gameLog } from "../dice-roll-log";
import { cardRollIds, dmModNames, rolledOf } from "../effect-modifiers/card";
import { reopenNotification, resolveNotification } from "../notifications";
import { loadNotification } from "../notifications/helpers";
import { ApplyHooks } from "./apply-hooks";
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

function insertHpChange(
  env: Env,
  id: string,
  facts: FactsInput,
  entryId: string,
  triggerParts: HpChangeRecord["triggerParts"] = [],
  damageParts: HpChangeRecord["damageParts"] = null,
): HpChangeRecord {
  const row = env.tx
    .insert(hpChange)
    .values({
      id,
      campaignId: campaignOf(env.actor),
      seq: hpChangeSeqNext,
      at: env.ctx.clock.iso(),
      ...facts,
      noteIds: [],
      triggerParts,
      damageParts,
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

/**
 * `cbt.applyCard` with a server's apply hooks (FR-MOD-38): per target, after the weapon raw and
 * before `hpRules.apply`; their extra raw joins the one `hpRules.apply`, their parts the line.
 */
export const applyCardWith = (hooks: ApplyHooks) =>
  defineCommand({
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
      // FR-CBT-72: `toHitTotal` iff the card has a to-hit roll; `damageTotal` unless the card has
      // no damage roll and every target misses. A typed total on a card without a damage roll =
      // "DM set" (`damageRolled` null).
      const { toHitTotal } = input;
      if (p.toHit && toHitTotal === undefined) throw invalid("To-hit total needed");
      if (!p.toHit && toHitTotal !== undefined) throw invalid("This card has no to-hit roll");
      const allMiss = input.targets.every((t) => !t.hit);
      if (input.damageTotal === undefined && (p.damage || !allMiss)) throw invalid("Damage needed");
      const damageTotal = input.damageTotal ?? 0;
      // FR-CBT-82 (sprint 4): the extra parts' values and per-target multipliers, card order;
      // never more than the card has.
      const extraParts = p.damage?.extra ?? [];
      if ((input.extraTotals?.length ?? 0) > extraParts.length) {
        const message = "More part totals than the card has";
        throw invalid(message, [{ path: ["extraTotals"], message }]);
      }
      input.targets.forEach((t, i) => {
        if ((t.extraMultipliers?.length ?? 0) > extraParts.length) {
          const message = "More part multipliers than the card has";
          throw invalid(message, [{ path: ["targets", i, "extraMultipliers"], message }]);
        }
      });
      // FR-CBT-34: every target active and non-removed, checked before anything is written.
      const targets = input.targets.map((t) => ({ ...t, c: activeCombatant(env, t.targetId).c }));
      const attacker = getCombatant(env.tx, enc.campaignId, p.attackerId);
      // Rolled values come from the card's roll rows, never the client (gems: FR-CBT-32).
      const toHitRoll = p.toHit ? cardRoll(env, p.toHit.rollId) : null;
      const damageRoll = p.damage ? cardRoll(env, p.damage.rollId) : null;
      // FR-MOD-16: rolled = base row + the card part's mods (bonus dice are part rows, never
      // summed into the base), so an unedited effect-modified total never reads as "DM set".
      const toHitRolled = toHitRoll ? rolledOf(toHitRoll.total, p.toHit) : null;
      const damageRolled = damageRoll ? rolledOf(damageRoll.total, p.damage) : null;
      // FR-CBT-82: each part's rolled value from its roll row; the DM's value, else rolled.
      const extras = extraParts.map((x, i) => {
        const r = cardRoll(env, x.rollId);
        return { type: x.type, roll: r, rolled: r.total, total: input.extraTotals?.[i] ?? r.total };
      });
      // FR-MOD-20: the DM line names every part (from the roll line's `dmPayload`).
      const toHitNames = p.toHit?.mods ? dmModNames(env, p.toHit.rollId) : null;
      const damageNames = p.damage?.mods ? dmModNames(env, p.damage.rollId) : null;
      const dmMods: AttackLogDmPayload["mods"] = {
        ...(toHitNames ? { toHit: toHitNames } : {}),
        ...(p.damage?.mods
          ? {
              damage: p.damage.mods.map((m, i) => ({
                ...m,
                label: damageNames?.[i]?.label ?? m.label,
              })),
            }
          : {}),
      };
      // FR-CBT-53: physical flags for everyone; the dice breakdown for the DM only (FR-DICE-28).
      const manual = { toHit: toHitRoll?.manual ?? false, damage: damageRoll?.manual ?? false };
      const rolls: AttackLogRolls = {
        ...(toHitRoll
          ? {
              toHit: {
                expression: toHitRoll.expression,
                mode: toHitRoll.mode,
                dice: toHitRoll.dice,
                constant: toHitRoll.constant,
              },
            }
          : {}),
        ...(damageRoll
          ? {
              damage: {
                expression: damageRoll.expression,
                dice: damageRoll.dice,
                constant: damageRoll.constant,
                crit: p.crit,
              },
            }
          : {}),
        // FR-CBT-84: the extra parts' dice stay DM-only (rulings B4).
        ...(extras.length
          ? {
              extra: extras.map((x) => ({
                type: x.type,
                expression: x.roll.expression,
                dice: x.roll.dice,
                constant: x.roll.constant,
                rolled: x.rolled,
                ...(x.total !== x.rolled ? { set: true as const } : {}),
              })),
            }
          : {}),
      };
      const playerCard = card.audience === "player";
      const rollIds = [
        ...cardRollIds(p.toHit),
        ...cardRollIds(p.damage),
        ...extraParts.map((x) => x.rollId),
      ];
      const hpChangeIds: string[] = [];
      const outcomes: DamageCardTargetOutcome[] = [];
      for (const { c: target, ...targetInput } of targets) {
        const { hit, multiplier } = targetInput;
        // FR-CBT-82: raw = floor(base × m) + Σ floor(extra_i × m_i); a miss lands nothing.
        const parts = extras.map((x, i) => {
          const m = targetInput.extraMultipliers?.[i] ?? multiplier;
          return { ...x, multiplier: m, raw: rawDamage(hit, x.total, m) };
        });
        const weaponRaw =
          rawDamage(hit, damageTotal, multiplier) + parts.reduce((s, x) => s + x.raw, 0);
        // Allocated first: effects ended `down` point at this row (FR-CBTX-16, -22), and the apply
        // hooks name it (FR-MOD-38).
        const hpChangeId = env.ctx.ids.next();
        const hooked = hooks.beforeTarget(env, {
          card: p,
          cardId: card.id,
          target,
          input: targetInput,
          hpChangeId,
          targetAc: statsOf(env, target).ac,
          weaponRaw,
        });
        // FR-MOD-24 (tier 2): a hook may give the effective AC.
        const targetAc = hooked.targetAc;
        // FR-CBT-72: a damage-only card has no to-hit facts (null in the row and the line).
        const hitComputed = toHitRoll
          ? hitHint(toHitRoll.natural, toHitTotal ?? (toHitRolled as number), targetAc)
          : null;
        // FR-MOD-38: the target's raw = weapon raw + its trigger parts, one `hpRules.apply`.
        const raw = weaponRaw + hooked.extraRaw;
        const hp = hpRules.apply(env, hpTargetOf(target), {
          kind: "damage",
          raw,
          crit: p.crit,
          hpChangeId,
        });
        // `applied` = HP lost; temp HP took `absorbed` first (FR-CBTX-15).
        const applied = Math.abs(hp.hpBefore - hp.hpAfter);
        const overkill = Math.max(0, raw - hp.absorbed - hp.hpBefore);
        const lineToHit =
          toHitRoll && p.toHit && toHitTotal !== undefined
            ? {
                dice: toHitTotal === toHitRolled ? toHitRoll.total - p.toHit.constant : null,
                constant: p.toHit.constant,
                ...(p.toHit.mods && toHitTotal === toHitRolled ? { mods: p.toHit.mods } : {}),
                total: toHitTotal,
                natural: toHitRoll.natural,
              }
            : null;
        const logPayload: AttackLogPayload = {
          targetName: target.name,
          attackName: p.attackName,
          damageType: p.damageType,
          toHit: lineToHit,
          hit,
          damage: raw,
          multiplier,
          crit: p.crit,
          manual,
          ...(hooked.parts.length ? { parts: hooked.parts } : {}),
          // FR-CBT-84: the extra parts after their multiplier (public, like the damage).
          ...(hit && parts.length
            ? {
                damageParts: parts.map((x) => ({
                  type: x.type,
                  value: x.raw,
                  ...(x.multiplier !== "normal" ? { multiplier: x.multiplier } : {}),
                })),
              }
            : {}),
        };
        const dmPayload: AttackLogDmPayload = {
          targetAc,
          hitComputed,
          toHitRolled,
          damageRolled,
          damageTotal,
          applied,
          overkill,
          overrides: {
            toHit: toHitRoll !== null && toHitTotal !== toHitRolled,
            hit: hitComputed !== null && hit !== hitComputed,
            // An all-miss apply without a total sets nothing.
            damage: input.damageTotal !== undefined && damageTotal !== damageRolled,
          },
          rolls,
          ...(dmMods.toHit || dmMods.damage ? { mods: dmMods } : {}),
          ...(hp.absorbed > 0 ? { absorbed: hp.absorbed } : {}),
          ...hooked.dm,
        };
        // FR-CBT-36: one line per target; never public if the attacker or this target is hidden,
        // else a player's card is public, else the DM's choice / category setting (FR-CBT-24).
        const entry = gameLog.append(env, {
          kind: LOG_KIND_ATTACK,
          category: "attack",
          actorName: p.attackerName,
          payload: logPayload,
          dmPayload,
          // FR-MOD-57: + public character-trigger rolls (the others ride in `dmPayload.rollIds`).
          rollIds: [...rollIds, ...hooked.rollIds],
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
          toHitRolled,
          toHitTotal: toHitRoll ? (toHitTotal ?? null) : null,
          natural: toHitRoll?.natural ?? null,
          hitComputed,
          hit,
          damageRolled,
          damageTotal,
          multiplier,
          raw,
          applied,
          overkill,
          hpBefore: hp.hpBefore,
          hpAfter: hp.hpAfter,
          ...playFacts(hp),
        };
        // FR-CBT-84: hp_change `damageParts` (DM, stats); `raw` above keeps the whole amount.
        const damageParts = parts.length
          ? parts.map((x) => ({
              type: x.type,
              rolled: x.rolled,
              total: x.total,
              multiplier: x.multiplier,
              raw: x.raw,
            }))
          : null;
        const row = insertHpChange(
          env,
          hpChangeId,
          facts,
          entry.id,
          hooked.triggerParts,
          damageParts,
        );
        emitWithCards(env, AttackApplied.type, hp, row, facts, [entry, ...hooked.changes]);
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

/** `cbt.applyCard` with the registry's hooks (fixtures; the server registers its own list). */
export const applyCard = applyCardWith(new ApplyHooks());

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

/**
 * `cbt.undo` with a server's apply hooks: `revert` per undone row, in its transaction, before the
 * card is reopened (FR-MOD-41).
 */
export const undoCommandWith = (hooks: ApplyHooks) =>
  defineCommand({
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
        // FR-MOD-41: the hooks undo their own rows (trigger uses back to offered, refunds).
        const hookChanges = hooks.revert(env, row);
        env.emit({
          type: CombatEntryUndone.type,
          campaignId: enc.campaignId,
          payload: { hpChangeId: row.id },
          changes: [
            ...hp.changes,
            hpChangeChange(row, readHpChange(env.tx, row.id)),
            entry,
            ...hookChanges,
          ],
        });
        // FR-CBTX-22: this row's pending concentration cards close `undone` after its event.
        hpRules.afterRevert(env, hp);
      }
      // I28: the owner's events first, then the card back to pending (once per apply).
      if (last.cardId) reopenNotification(env, last.cardId);
      return { hpChangeIds: unit.map((r) => r.id), notRestored };
    },
  });

/** `cbt.undo` with the registry's hooks (fixtures; the server registers its own list). */
export const undoCommand = undoCommandWith(new ApplyHooks());
