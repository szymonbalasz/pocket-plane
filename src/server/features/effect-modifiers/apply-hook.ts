// MOD's rule-trigger apply hook (FR-MOD-38, -40, -41, -42, -48; ADR-0043 D1, D3), a line in
// combat-tracker's `applyHooks`. Per target, `cbt.applyCard`'s `targets[].triggers` assign the
// card's offered parts: each lands floor((value ?? rolled) × (multiplier ?? row's)) on this Hit
// target (summed into the one `hpRules.apply`), its `trigger_use` row turns `used` (target,
// hp_change) and a feature-frequency trigger spends a use. A used charge (another `used` row in
// the window) or no use left → `conflict` unless `force` (recorded `forced`, spends nothing).
// `cbt.undo` → `revert`: the row's uses back to `offered`, feature uses refunded.
import type { AttackLineDmPart, AttackLinePart } from "@shared/combat-tracker/log-kinds";
import { MULTIPLIER_FACTOR } from "@shared/combat-tracker/rules";
import type { HpTriggerPart } from "@shared/combat-tracker/schemas";
import { windowed, windowWords } from "@shared/effect-modifiers/trigger-fire";
import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import { conflict, invalid } from "../../commands/errors";
import { ruleTrigger, triggerUse } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import type { ApplyHook, ApplyTargetResult } from "../combat-tracker/apply-hooks";
import { refundFeatureUse, spendFeatureUse } from "./feature-uses";
import { chargeFree, featureUses } from "./trigger-hook";

const none = (): ApplyTargetResult => ({ extraRaw: 0, parts: [], dm: {}, changes: [] });

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
    const changes: RecordChange[] = [];
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
            if (!x.force) throw conflict(`${part.label} was already used ${windowWords(every)}`);
            forced = true;
          }
        } else if (typeof every === "object" && t.characterId !== null) {
          const uses = featureUses(env, t.characterId, every.feature);
          if (!uses || uses.left <= 0) {
            if (!x.force) throw conflict(`${part.label}: no ${uses?.name ?? "feature"} uses left`);
            forced = true;
          } else {
            const change = spendFeatureUse(env, t.characterId, every.feature);
            if (change) changes.push(change);
            featureId = every.feature;
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
      }
      out.extraRaw += value;
      // FR-MOD-47: the label in public lines iff the trigger is public; values always.
      parts.push({ label: t?.public ? part.label : null, value, type: part.type });
      dmParts.push({
        triggerId: part.triggerId,
        label: part.label,
        rolled: part.value,
        ...(forced ? { forced: true as const } : {}),
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
    return { ...out, parts, dm: { parts: dmParts }, triggerParts, changes };
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
    return changes;
  },
};
