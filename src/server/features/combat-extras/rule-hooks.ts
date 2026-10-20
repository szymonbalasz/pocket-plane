// combat-extras' combat rule hooks (FR-CBTX-01, ADR-0035) and token-changed hook (ADR-0028).
// They run in the causing command's transaction, after its event is emitted (so card closures
// follow it), and return the `effect` rows for that event:
//   started / added — hidden copies of the new PC combatants' effects (FR-CBTX-13);
//   turnChanged     — Next: expiry (FR-CBTX-06); Prev: restore what that Next expired (-07);
//   ended           — monster and timed effects end; PC effects stay, visible (FR-CBTX-12).
// `cbtxEffectHookLine`, the last combat rule-hook line, runs the effect hooks (FR-CBTX-51) for
// whatever the lines before it changed, once per hook point.
import { expiresAt } from "@shared/combat-extras/rules";
import type { EffectRecord } from "@shared/combat-extras/schemas";
import type { CombatantRecord, EncounterRecord } from "@shared/combat-tracker/schemas";
import type { TokenRecord } from "@shared/scenes-map/schemas";
import { and, asc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { combatant, effect } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { turnStartersOf } from "../combat-tracker/ranks";
import { combatantsOf, toCombatantRecord } from "../combat-tracker/rows";
import type { CombatRuleEnv, CombatRuleHookSet } from "../combat-tracker/rule-hooks";
import type { TokenHookEnv } from "../scenes-map/token-hooks";
import { tokenHiddenForPlayers } from "../scenes-map/visibility-hooks";
import { closeCardsOfEnded, endEffects, restoreEffects, runEffectHooks } from "./effects";
import {
  activeEffectsOf,
  combatantTargetColumns,
  effectChange,
  readEffect,
  toEffectRecord,
} from "./rows";

type Read = Pick<CombatRuleEnv, "tx">;

/** FR-CBTX-13: writes `hidden` on the active effects of these combatants' creatures. */
export function syncHidden(
  env: Pick<CombatRuleEnv, "tx" | "ctx">,
  rows: readonly CombatantRecord[],
): RecordChange[] {
  const out: RecordChange[] = [];
  for (const c of rows) {
    // Sprint 6 (FR-CBT-116): a companion of a hidden owner counts as hidden.
    const hidden = c.hidden || c.ownerHidden;
    for (const e of activeEffectsOf(env.tx, combatantTargetColumns(c))) {
      if (e.hidden === hidden) continue;
      env.tx
        .update(effect)
        .set({ hidden, updatedAt: env.ctx.clock.iso() })
        .where(eq(effect.id, e.id))
        .run();
      out.push(effectChange(e, readEffect(env.tx, e.id)));
    }
  }
  return out;
}

const pcsAmong = (env: Read, enc: EncounterRecord, ids: readonly string[]) => {
  const want = new Set(ids);
  return combatantsOf(env.tx, enc.id).filter((c) => want.has(c.id) && c.kind === "pc");
};

/** Active timed effects of the encounter (the only ones a turn can end). */
const timedEffects = (env: Read, encounterId: string): EffectRecord[] =>
  env.tx
    .select()
    .from(effect)
    .where(
      and(eq(effect.encounterId, encounterId), isNull(effect.endedAt), isNotNull(effect.endsRound)),
    )
    .orderBy(asc(effect.seq))
    .all()
    .map(toEffectRecord);

export const cbtxRuleHooks: CombatRuleHookSet = {
  started: (env, enc, d) => syncHidden(env, pcsAmong(env, enc, d.combatantIds)),
  added: (env, enc, d) => syncHidden(env, pcsAmong(env, enc, d.combatantIds)),
  turnChanged(env, enc, d) {
    if (d.direction === "next") {
      // Concentrations last, so a timed link that is due ends `expired` itself (the DM toast
      // names it), not by the cascade.
      // FR-CBT-108 (sprint 6): an in-owner-turn companion's anchor is its owner's turn start.
      const starters = turnStartersOf(env.tx, enc.id, d.to.turnCombatantId);
      const due = timedEffects(env, enc.id)
        .filter((e) =>
          (starters.length ? starters : [null]).some((id) =>
            expiresAt(e, { round: d.to.round, turnCombatantId: id }),
          ),
        )
        .sort((a, b) => Number(a.kind === "concentration") - Number(b.kind === "concentration"));
      if (due.length === 0) return [];
      // Stamped with the new turn: Prev from it restores exactly these (FR-CBTX-07).
      const ended = endEffects(env, due, "expired", {
        endedRound: d.to.round,
        endedTurnId: d.to.turnCombatantId,
      });
      closeCardsOfEnded(env, ended);
      return ended.changes;
    }
    if (d.from.turnCombatantId === null) return [];
    const back = env.tx
      .select()
      .from(effect)
      .where(
        and(
          eq(effect.encounterId, enc.id),
          inArray(effect.endedReason, ["expired", "concentration"]),
          eq(effect.endedRound, d.from.round),
          eq(effect.endedTurnId, d.from.turnCombatantId),
        ),
      )
      .orderBy(asc(effect.seq))
      .all()
      .map(toEffectRecord);
    const r = restoreEffects(env, back);
    d.notRestored.push(...r.notRestored);
    return r.changes;
  },
  ended(env, enc, d) {
    const rows = combatantsOf(env.tx, enc.id).filter((c) => d.combatantIds.includes(c.id));
    const monsterIds = rows.filter((c) => c.kind === "monster").map((c) => c.id);
    const conds = [and(eq(effect.encounterId, enc.id), isNotNull(effect.endsRound))];
    if (monsterIds.length > 0) conds.push(inArray(effect.targetCombatantId, monsterIds));
    const toEnd = env.tx
      .select()
      .from(effect)
      .where(and(isNull(effect.endedAt), or(...conds)))
      .orderBy(asc(effect.seq))
      .all()
      .map(toEffectRecord);
    const ended = endEffects(env, toEnd, "encounter-ended");
    // FR-CBTX-12: PC effects stay; the PC has no active combatant any more → visible.
    const pcs = rows.filter((c) => c.kind === "pc").map((c) => ({ ...c, hidden: false }));
    const shown = syncHidden(env, pcs);
    closeCardsOfEnded(env, ended);
    return [...ended.changes, ...shown];
  },
};

/**
 * FR-CBTX-51: effect hooks after the combat rule lines (expiry on Next, restore on Prev, End),
 * with the encounter as the command left it. Registered last in `combatRuleHooks`.
 */
const effectsChangedLine = (env: CombatRuleEnv, enc: EncounterRecord) => runEffectHooks(env, enc);
export const cbtxEffectHookLine: CombatRuleHookSet = {
  started: effectsChangedLine,
  added: effectsChangedLine,
  turnChanged: effectsChangedLine,
  ended: effectsChangedLine,
};

/**
 * Token-changed hook `cbtx` (FR-CBTX-13, ADR-0028): hide / reveal of a token bound to an active
 * combatant copies `hidden` onto its creature's active effects. Runs after combat's own hook.
 * Hidden = `tokenHiddenForPlayers` (hidden or fog-hidden, FR-FOG-14).
 */
export function cbtxTokenHook(
  env: TokenHookEnv,
  before: TokenRecord,
  after: TokenRecord | null,
): RecordChange[] {
  if (!after) return [];
  const hidden = tokenHiddenForPlayers(after);
  if (tokenHiddenForPlayers(before) === hidden) return [];
  const bound = env.tx
    .select()
    .from(combatant)
    .where(
      and(
        eq(combatant.tokenId, before.id),
        eq(combatant.campaignId, before.campaignId),
        eq(combatant.active, true),
      ),
    )
    .all()
    .map((r) => ({ ...toCombatantRecord(r), hidden }));
  // Sprint 6 (FR-CBT-116): a hidden owner PC hides its companions (and their effects) too.
  const companions = bound
    .filter((c) => c.kind === "pc")
    .flatMap((pc) =>
      env.tx
        .select()
        .from(combatant)
        .where(
          and(
            eq(combatant.encounterId, pc.encounterId),
            eq(combatant.ownerCharacterId, pc.entityId),
            eq(combatant.active, true),
          ),
        )
        .all()
        .map((r) => ({ ...toCombatantRecord(r), ownerHidden: hidden })),
    );
  return syncHidden(env, [...bound, ...companions]);
}
