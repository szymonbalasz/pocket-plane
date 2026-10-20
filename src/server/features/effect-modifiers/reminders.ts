// Turn-start reminders (FR-MOD-44; ADR-0043 D1, ADR-0035): MOD's `combatRuleHooks` line. On
// **Next** only (Prev never reminds; "Start round 1" is a Next), the new turn combatant's enabled
// `turnStart` triggers whose `requires` holds → one `mod-trigger` notification each: "Troll:
// Regeneration — regain 10 HP unless it took acid or fire damage". Audience: a monster → the
// DM; a PC → its owner, the DM while the combatant is hidden. No use rows. The same line carries
// the trigger-state writes (FR-MOD-54): every hook point, before the reminders.

import type { EncounterRecord } from "@shared/combat-tracker/schemas";
import { formulaValue } from "@shared/effect-modifiers/formula";
import {
  MOD_TRIGGER_KIND,
  ModTriggerPayload,
  type ModTriggerPayload as Payload,
} from "@shared/effect-modifiers/reminders";
import { formulaOwnerOf } from "@shared/effect-modifiers/trigger-fire";
import { reminderText } from "@shared/effect-modifiers/triggers";
import { eq } from "drizzle-orm";
import { combatant, entity } from "../../db/schema";
import { turnStartersOf } from "../combat-tracker/ranks";
import { toCombatantRecord } from "../combat-tracker/rows";
import type {
  CombatRuleDetails,
  CombatRuleEnv,
  CombatRuleHookSet,
} from "../combat-tracker/rule-hooks";
import { notify } from "../notifications";
import { defineNotificationKind } from "../notifications/kind";
import { ownerOf, requiresOf, triggersOf } from "./trigger-hook";
import { triggerStateRuleHooks } from "./trigger-state-hooks";

export const modTriggerKind = defineNotificationKind({
  kind: MOD_TRIGGER_KIND,
  ownerSpec: "effect-modifiers",
  payload: ModTriggerPayload,
  genericResolve: false,
});

export const modReminderHooks: CombatRuleHookSet = {
  started: triggerStateRuleHooks.started,
  added: triggerStateRuleHooks.added,
  ended: triggerStateRuleHooks.ended,
  turnChanged(env, enc, detail) {
    const states = triggerStateRuleHooks.turnChanged(env, enc);
    remind(env, enc, detail);
    return states;
  },
};

function remind(
  env: CombatRuleEnv,
  enc: EncounterRecord,
  detail: CombatRuleDetails["turnChanged"],
): void {
  if (detail.direction !== "next" || !detail.to.turnCombatantId) return;
  // FR-CBT-108 (sprint 6): an in-owner-turn companion's `turnStart` is its owner's.
  for (const id of turnStartersOf(env.tx, enc.id, detail.to.turnCombatantId))
    remindFor(env, enc, id);
}

function remindFor(env: CombatRuleEnv, enc: EncounterRecord, combatantId: string): void {
  const row = env.tx.select().from(combatant).where(eq(combatant.id, combatantId)).get();
  if (!row) return;
  const c = toCombatantRecord(row);
  const o = ownerOf(env, c.kind === "pc" ? { characterId: c.entityId } : { combatantId: c.id });
  if (!o) return;
  const triggers = triggersOf(env, o, "turnStart");
  if (triggers.length === 0) return;
  const requires = requiresOf(env, o);
  const player =
    c.kind === "pc" && !c.hidden
      ? (env.tx
          .select({ p: entity.ownerPlayerId })
          .from(entity)
          .where(eq(entity.id, c.entityId))
          .get()?.p ?? null)
      : null;
  for (const t of triggers) {
    if (t.rule.then.do !== "remind" || !requires(t.rule)) continue;
    const f = t.rule.then.value;
    const v = f === undefined ? null : formulaValue(f, formulaOwnerOf(o.stats));
    // A formula error skips the reminder (FR-MOD-34); there is no line to note it on.
    if (v && !v.ok) continue;
    const text = reminderText(t.rule.then.text, v?.ok ? v.value : null);
    const payload: Payload = {
      triggerName: t.name,
      creatureName: c.name.slice(0, 80),
      encounterId: enc.id,
      text: text.slice(0, 160),
    };
    notify(env, {
      kind: MOD_TRIGGER_KIND,
      audience: player ? "player" : "dm",
      audiencePlayerId: player,
      text: `${c.name}: ${t.name} — ${text}`.slice(0, 280),
      payload,
    });
  }
}
