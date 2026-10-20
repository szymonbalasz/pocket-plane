// Apply hit (sprint 5, FR-CBT-88, ADR-0053): the DM rules the to-hit of a pending card before
// its damage exists. One transaction: the DM-only `hit_ruling` row, one `cbt.attack` line per
// ruled target without damage (`awaitingDamage`), `HitApplied`. No HP, no `hp_change`, the card
// stays pending and unchanged; nothing is spent (FR-MOD-63: no apply hooks run). Not undoable.

import { companionSafeToHit, isCompanion } from "@shared/combat-tracker/companion";
import type { AttackLogDmPayload, AttackLogPayload } from "@shared/combat-tracker/log-kinds";
import { AcModPart } from "@shared/combat-tracker/log-kinds";
import { hitHint } from "@shared/combat-tracker/rules";
import {
  ApplyHitInput,
  type ApplyHitResult,
  CBT_INTENTS,
  DAMAGE_CARD_KIND,
  DamageCardPayload,
  LOG_KIND_ATTACK,
} from "@shared/combat-tracker/schemas";
import { effectiveAc } from "@shared/effect-modifiers/rules";
import { HitApplied } from "@shared/events/combat-tracker";
import { defineCommand } from "../../commands/commands";
import { conflict, invalid, notFound } from "../../commands/errors";
import { hitRuling } from "../../db/schema";
import { gameLog } from "../dice-roll-log";
import { cardRollIds, dmModNames, rolledOf } from "../effect-modifiers/card";
import { activeEffects } from "../effect-modifiers/roll-hook";
import { loadNotification } from "../notifications/helpers";
import { activeCombatant, statsOf } from "./guards";
import { cardRoll } from "./hp";
import {
  campaignOf,
  getCombatant,
  hitRulingChange,
  readEncounter,
  rulingOfCard,
  toHitRulingRecord,
} from "./rows";

/** FR-CBT-88: one code per case (`conflict` / `invalid` / `not_found`). */
export const HIT_ALREADY_APPLIED = "Hit already applied";

export const applyHitCommand = defineCommand({
  name: CBT_INTENTS.applyHit,
  input: ApplyHitInput,
  roles: ["dm"],
  execute(input, env): ApplyHitResult {
    const cid = campaignOf(env.actor);
    const card = loadNotification(env, input.cardId);
    if (card.kind !== DAMAGE_CARD_KIND) throw notFound("Damage card not found");
    const p = DamageCardPayload.parse(card.payload);
    const enc = readEncounter(env.tx, p.encounterId);
    if (enc.status !== "started") throw conflict("Encounter has ended");
    if (card.state !== "pending") throw conflict("No longer pending");
    if (rulingOfCard(env.tx, card.id)) throw conflict(HIT_ALREADY_APPLIED);
    if (!p.toHit) throw invalid("This card has no to-hit roll");
    if (!input.targets.some((t) => t.hit)) {
      const message = "Apply hit needs a Hit target";
      throw invalid(message, [{ path: ["targets"], message }]);
    }
    // FR-CBT-34's rule: every target active and non-removed, checked before anything is written.
    const targets = input.targets.map((t) => ({ ...t, c: activeCombatant(env, t.targetId).c }));
    const attacker = getCombatant(env.tx, cid, p.attackerId);
    const toHitRoll = cardRoll(env, p.toHit.rollId);
    const toHitRolled = rolledOf(toHitRoll.total, p.toHit);
    const toHitSet = input.toHitTotal !== toHitRolled;
    const toHitNames = p.toHit.mods ? dmModNames(env, p.toHit.rollId) : null;
    const rollIds = cardRollIds(p.toHit);
    const playerCard = card.audience === "player";
    const entries = targets.map(({ c: target, hit, multiplier }) => {
      // FR-MOD-24 (tier 2): the effective AC, as the damage Apply's target facts compute it.
      const who =
        target.kind === "pc" ? { characterId: target.entityId } : { combatantId: target.id };
      const ac = effectiveAc(statsOf(env, target).ac, activeEffects(env, who), who);
      const hitComputed = hitHint(toHitRoll.natural, input.toHitTotal, ac.ac);
      const lineToHit: AttackLogPayload["toHit"] = {
        dice: toHitSet ? null : toHitRoll.total - (p.toHit?.constant ?? 0),
        constant: p.toHit?.constant ?? 0,
        ...(p.toHit?.mods && !toHitSet ? { mods: p.toHit.mods } : {}),
        total: input.toHitTotal,
        natural: toHitRoll.natural,
      };
      const payload: AttackLogPayload = {
        targetName: target.name,
        attackName: p.attackName,
        damageType: p.damageType,
        // FR-CBT-114 (sprint 6): a companion attacker's line keeps the total only (ADR-0056).
        toHit: isCompanion(attacker) ? companionSafeToHit(lineToHit) : lineToHit,
        hit,
        damage: 0,
        multiplier,
        crit: p.crit,
        manual: { toHit: toHitRoll.manual, damage: false },
        awaitingDamage: true,
      };
      const dmPayload: AttackLogDmPayload = {
        targetAc: ac.ac,
        hitComputed,
        toHitRolled,
        damageRolled: null,
        damageTotal: 0,
        applied: 0,
        overkill: 0,
        overrides: { toHit: toHitSet, hit: hit !== hitComputed, damage: false },
        rolls: {
          toHit: {
            expression: toHitRoll.expression,
            mode: toHitRoll.mode,
            dice: toHitRoll.dice,
            constant: toHitRoll.constant,
          },
        },
        ...(toHitNames ? { mods: { toHit: toHitNames } } : {}),
        ...(ac.parts.length
          ? {
              acMods: ac.parts.slice(0, 6).map((x) =>
                AcModPart.parse({
                  effectId: x.effectId,
                  label: x.label.length > 60 ? `${x.label.slice(0, 59)}…` : x.label,
                  value: x.value,
                }),
              ),
            }
          : {}),
      };
      // FR-CBT-36: never public if the attacker or this target is hidden, else a player's card
      // is public, else the category setting (Apply hit sends no `public`).
      return gameLog.append(env, {
        kind: LOG_KIND_ATTACK,
        category: "attack",
        actorName: p.attackerName,
        payload,
        dmPayload,
        rollIds,
        encounterId: enc.id,
        public: attacker.hidden || target.hidden ? false : playerCard ? true : undefined,
      });
    });
    const id = env.ctx.ids.next();
    const row = env.tx
      .insert(hitRuling)
      .values({
        id,
        campaignId: cid,
        encounterId: enc.id,
        cardId: card.id,
        toHitTotal: input.toHitTotal,
        toHitSet,
        targets: input.targets.map(({ targetId, hit, multiplier }) => ({
          targetId,
          hit,
          multiplier,
        })),
        createdAt: env.ctx.clock.iso(),
      })
      .returning()
      .get();
    env.emit({
      type: HitApplied.type,
      campaignId: cid,
      payload: {
        cardId: card.id,
        encounterId: enc.id,
        rulingId: id,
        entryIds: entries.map((e) => e.id),
      },
      changes: [hitRulingChange(null, toHitRulingRecord(row)), ...entries],
    });
    return { rulingId: id };
  },
});
