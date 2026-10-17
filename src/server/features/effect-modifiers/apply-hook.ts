// MOD's rule-trigger apply hook (FR-MOD-38, -40, -41, -42, -48; ADR-0043 D1, D3), a line in
// combat-tracker's `applyHooks`. Per target, `cbt.applyCard`'s `targets[].triggers` assign the
// card's offered parts: each lands floor((value ?? rolled) × (multiplier ?? row's)) on this Hit
// target (summed into the one `hpRules.apply`), its `trigger_use` row turns `used` (target,
// hp_change) and a feature-frequency trigger spends a use. A used charge (another `used` row in
// the window) or no use left → `conflict` unless `force` (recorded `forced`; a window charge
// spends nothing, a feature use is spent below zero to the floor, FR-MOD-59).
// Feature uses go through CHARX's one helper pair (`resources.ts`, FR-MOD-61).
// `cbt.undo` → `revert`: the row's uses back to `offered`, the one feature use its apply spent
// refunded (also from below zero, FR-MOD-59 (c)).
// FR-MOD-57 (sprint 4, rulings B3 / B4): each landed part's roll (`expression` + per-die `dice`
// from its roll row) goes in `dmPayload.parts`; a **public character** trigger's also in the
// public part (unless the DM set its value: players see the DM's value only).
// Both rewrite the owner's trigger state after the use rows flip (FR-MOD-54).
import { leftText } from "@shared/character-sheet/counters";
import type { AttackLineDmPart, AttackLinePart } from "@shared/combat-tracker/log-kinds";
import { MULTIPLIER_FACTOR } from "@shared/combat-tracker/rules";
import type { HpTriggerPart } from "@shared/combat-tracker/schemas";
import { windowed, windowWords } from "@shared/effect-modifiers/trigger-fire";
import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import type { CommandEnv } from "../../commands/commands";
import { CommandError, invalid } from "../../commands/errors";
import { roll, ruleTrigger, triggerUse } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { refundFeatureUse, spendFeatureUse } from "../character-sheet/resources";
import type { ApplyHook, ApplyTargetResult } from "../combat-tracker/apply-hooks";
import { startedEncounter } from "../combat-tracker/rows";
import { chargeFree, dieValues, featureUses } from "./trigger-hook";
import { triggerStates } from "./trigger-state-writes";

const none = (): ApplyTargetResult => ({ extraRaw: 0, parts: [], dm: {}, changes: [] });

/** FR-MOD-57: an offered part's roll as a line part carries it; no stored dice → expression only. */
function partRoll(env: Pick<CommandEnv, "tx">, rollId: string) {
  const r = env.tx.select({ dice: roll.dice }).from(roll).where(eq(roll.id, rollId)).get();
  const dice = r ? dieValues({ dice: r.dice as { value: number | null }[] }) : undefined;
  return dice ? { dice } : {};
}

/** FR-MOD-54: the trigger state of the owners whose use rows flipped (started encounter only). */
function statesOf(
  env: CommandEnv,
  uses: readonly { encounterId: string; ownerCombatantId: string }[],
): RecordChange[] {
  if (uses.length === 0) return [];
  const enc = startedEncounter(env.tx, env.actor.campaignId as string);
  const owners = uses.filter((u) => u.encounterId === enc?.id).map((u) => u.ownerCombatantId);
  return owners.length ? triggerStates(env, enc, [...new Set(owners)]) : [];
}

/**
 * FR-MOD-38, -40: a used charge / no use left. The issue names the part (`["triggers",
 * triggerId]`), so the DM's popup marks that chip "Used this turn" with a Force tick.
 */
const usedConflict = (triggerId: string, message: string) =>
  new CommandError("conflict", message, [{ path: ["triggers", triggerId], message }]);

export const modApplyHook: ApplyHook = {
  id: "effect-modifiers.triggers",
  beforeTarget(env, a) {
    const assigned = a.input.triggers ?? [];
    if (assigned.length === 0 || !a.input.hit) return none();
    const offers = a.card.damage?.triggers ?? [];
    const out = none();
    const dmParts: z.infer<typeof AttackLineDmPart>[] = [];
    const triggerParts: HpTriggerPart[] = [];
    const parts: AttackLinePart[] = [];
    const rollIds: string[] = [];
    const dmRollIds: string[] = [];
    const changes: RecordChange[] = [];
    const flipped: { encounterId: string; ownerCombatantId: string }[] = [];
    for (const x of assigned) {
      const part = offers.find((o) => o.triggerId === x.triggerId);
      if (!part) {
        throw invalid("No such trigger part on this card", [
          { path: ["targets", "triggers"], message: "No such trigger part on this card" },
        ]);
      }
      const use = env.tx
        .select()
        .from(triggerUse)
        .where(
          and(
            eq(triggerUse.cardId, a.cardId),
            eq(triggerUse.triggerId, part.triggerId),
            eq(triggerUse.state, "offered"),
          ),
        )
        .get();
      const t = env.tx.select().from(ruleTrigger).where(eq(ruleTrigger.id, part.triggerId)).get();
      let forced = false;
      let featureId: string | null = null;
      // A deleted trigger (its uses cascaded) settles as rolled, without a charge.
      if (t && use) {
        const every = t.rule.every;
        if (windowed(every)) {
          if (!chargeFree(env, t.id, use.ownerCombatantId, use.encounterId, use.window)) {
            if (!x.force) {
              throw usedConflict(t.id, `${part.label} was already used ${windowWords(every)}`);
            }
            forced = true;
          }
        } else if (typeof every === "object" && t.characterId !== null) {
          const uses = featureUses(env, t.characterId, every.feature);
          if (!uses || uses.left <= 0) {
            if (!x.force) {
              throw usedConflict(t.id, `${part.label}: no ${uses?.name ?? "feature"} uses left`);
            }
            forced = true;
          }
          // FR-MOD-59 (b): Force spends the use too (below zero, to the floor; at the floor
          // `conflict` even with Force). A broken link (no row / `usesMax`) spends nothing.
          if (uses) {
            const spent = spendFeatureUse(env, t.characterId, every.feature, { overspend: forced });
            if (spent.ok) {
              changes.push(spent.change);
              featureId = every.feature;
            } else if (spent.reason === "floor") {
              throw usedConflict(
                t.id,
                `${part.label}: ${spent.name} is at ${leftText(spent.left)} / ${spent.max} — reset it first`,
              );
            }
          }
        }
      }
      const multiplier = x.multiplier ?? a.input.multiplier;
      const value = Math.max(
        0,
        Math.floor((x.value ?? part.value) * MULTIPLIER_FACTOR[multiplier]),
      );
      if (use) {
        env.tx
          .update(triggerUse)
          .set({
            state: "used",
            targetId: a.target.id,
            hpChangeId: a.hpChangeId,
            value,
            multiplier,
            forced,
            featureId,
            updatedAt: env.ctx.clock.iso(),
          })
          .where(eq(triggerUse.id, use.id))
          .run();
        flipped.push(use);
      }
      out.extraRaw += value;
      const set = x.value !== undefined && x.value !== part.value;
      const rolled = { expression: part.expression, ...partRoll(env, part.rollId) };
      // FR-MOD-57 (B3, B4): monster triggers' dice stay DM-only whatever `public` says.
      const publicDice = !!t?.public && t.characterId !== null && !set;
      // The part's roll id goes where its dice go (rulings B4).
      (publicDice ? rollIds : dmRollIds).push(part.rollId);
      // FR-MOD-47: the label in public lines iff the trigger is public; values always.
      parts.push({
        label: t?.public ? part.label : null,
        value,
        type: part.type,
        ...(multiplier !== "normal" ? { multiplier } : {}),
        ...(publicDice ? rolled : {}),
      });
      dmParts.push({
        triggerId: part.triggerId,
        label: part.label,
        rolled: part.value,
        // FR-MOD-40: "(DM set; rolled 7)" after an edited value.
        ...(set ? { set: true as const } : {}),
        ...(forced ? { forced: true as const } : {}),
        ...rolled,
      });
      triggerParts.push({
        triggerId: part.triggerId,
        name: part.label,
        value,
        multiplier,
        type: part.type,
        forced,
      });
    }
    changes.push(...statesOf(env, flipped));
    return {
      ...out,
      parts,
      rollIds,
      dm: { parts: dmParts, ...(dmRollIds.length ? { rollIds: dmRollIds } : {}) },
      triggerParts,
      changes,
    };
  },
  revert(env, row) {
    const uses = env.tx.select().from(triggerUse).where(eq(triggerUse.hpChangeId, row.id)).all();
    const changes: RecordChange[] = [];
    for (const u of uses) {
      if (u.featureId) {
        const t = env.tx.select().from(ruleTrigger).where(eq(ruleTrigger.id, u.triggerId)).get();
        const change = t?.characterId ? refundFeatureUse(env, t.characterId, u.featureId) : null;
        if (change) changes.push(change);
      }
      env.tx
        .update(triggerUse)
        .set({
          state: "offered",
          targetId: null,
          hpChangeId: null,
          value: null,
          multiplier: null,
          forced: false,
          featureId: null,
          updatedAt: env.ctx.clock.iso(),
        })
        .where(eq(triggerUse.id, u.id))
        .run();
    }
    changes.push(...statesOf(env, uses));
    return changes;
  },
};
