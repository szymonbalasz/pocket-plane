// Effect writes shared by commands, the HP rules and the rule hooks (FR-CBTX-03–13): insert with
// limits, soft end with the concentration cascade (FR-CBTX-10), restore into free slots
// (FR-CBTX-07, -22), card closures by rule (FR-CBTX-43). All run in the caller's transaction and
// return the rows for the caller's event; card closures emit, so callers run them after their
// own event.
import {
  ConcentrationCardPayload,
  type ConcentrationCardResolution,
} from "@shared/combat-extras/intents";
import { effectName } from "@shared/combat-extras/rules";
import {
  CONCENTRATION_CARD_KIND,
  EFFECTS_PER_CAMPAIGN_MAX,
  EFFECTS_PER_TARGET_MAX,
  type EffectEndedReason,
  type EffectRecord,
} from "@shared/combat-extras/schemas";
import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";
import { conflict } from "../../commands/errors";
import { effect, effectSeqNext, notification } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { campaignOf } from "../combat-tracker/rows";
import { resolveNotification } from "../notifications";
import {
  activeEffectsOf,
  type Env,
  effectChange,
  effectTargetName,
  readEffect,
  toEffectRecord,
} from "./rows";

export type NewEffect = Omit<
  typeof effect.$inferInsert,
  "id" | "campaignId" | "seq" | "createdAt" | "updatedAt"
>;

/** FR-CBTX-04: ≤ 20 active per target, ≤ 300 per campaign (`conflict`). */
export function checkLimits(
  env: Env,
  cols: { targetCombatantId: string | null; targetCharacterId: string | null },
  adding: number,
): void {
  if (activeEffectsOf(env.tx, cols).length + adding > EFFECTS_PER_TARGET_MAX) {
    throw conflict(`At most ${EFFECTS_PER_TARGET_MAX} effects per creature`);
  }
  const n =
    env.tx
      .select({ n: count() })
      .from(effect)
      .where(and(eq(effect.campaignId, campaignOf(env.actor)), isNull(effect.endedAt)))
      .get()?.n ?? 0;
  if (n + adding > EFFECTS_PER_CAMPAIGN_MAX) {
    throw conflict(`At most ${EFFECTS_PER_CAMPAIGN_MAX} active effects per campaign`);
  }
}

export function insertEffect(env: Env, v: NewEffect): EffectRecord {
  const now = env.ctx.clock.iso();
  const row = env.tx
    .insert(effect)
    .values({
      ...v,
      id: env.ctx.ids.next(),
      campaignId: campaignOf(env.actor),
      seq: effectSeqNext,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  return toEffectRecord(row);
}

export function updateEffectRow(
  env: Env,
  before: EffectRecord,
  set: Partial<typeof effect.$inferInsert>,
): RecordChange {
  env.tx
    .update(effect)
    .set({ ...set, updatedAt: env.ctx.clock.iso() })
    .where(eq(effect.id, before.id))
    .run();
  return effectChange(before, readEffect(env.tx, before.id));
}

/** Stamps of a soft end besides the reason (Prev restores by turn, undo by HP change). */
export interface EndStamps {
  endedRound?: number | null;
  endedTurnId?: string | null;
  endedByHpChangeId?: string | null;
}

export interface Ended {
  changes: RecordChange[];
  /** Every effect ended, cascade included, in end order. */
  ended: EffectRecord[];
  /** Concentrations among them: their pending cards close `ended` after the caller's event. */
  concentrationIds: string[];
}

/**
 * Soft-ends `list` (active ones only) with `reason`; every active effect linked to an ended
 * concentration ends with it (`concentration`, same stamps; FR-CBTX-10).
 */
export function endEffects(
  env: Env,
  list: readonly EffectRecord[],
  reason: EffectEndedReason,
  stamps: EndStamps = {},
): Ended {
  const out: Ended = { changes: [], ended: [], concentrationIds: [] };
  const done = new Set<string>();
  const end = (e: EffectRecord, why: EffectEndedReason) => {
    if (done.has(e.id) || e.endedAt !== null) return;
    done.add(e.id);
    const change = updateEffectRow(env, e, {
      endedAt: env.ctx.clock.iso(),
      endedReason: why,
      endedRound: stamps.endedRound ?? null,
      endedTurnId: stamps.endedTurnId ?? null,
      endedByHpChangeId: stamps.endedByHpChangeId ?? null,
    });
    out.changes.push(change);
    out.ended.push(change.after as EffectRecord);
    if (e.kind !== "concentration") return;
    out.concentrationIds.push(e.id);
    const linked = env.tx
      .select()
      .from(effect)
      .where(and(eq(effect.concentrationId, e.id), isNull(effect.endedAt)))
      .orderBy(asc(effect.seq))
      .all()
      .map(toEffectRecord);
    for (const l of linked) end(l, "concentration");
  };
  for (const e of list) end(e, reason);
  return out;
}

/** Pending concentration cards of the actor's campaign for these concentrations, seq order. */
export function pendingCardsFor(env: Env, concentrationIds: readonly string[]): string[] {
  if (concentrationIds.length === 0) return [];
  const want = new Set(concentrationIds);
  return env.tx
    .select({ id: notification.id, payload: notification.payload })
    .from(notification)
    .where(
      and(
        eq(notification.campaignId, campaignOf(env.actor)),
        eq(notification.kind, CONCENTRATION_CARD_KIND),
        eq(notification.state, "pending"),
      ),
    )
    .orderBy(asc(notification.seq))
    .all()
    .filter((n) => want.has(ConcentrationCardPayload.parse(n.payload).effectId))
    .map((n) => n.id);
}

/** FR-CBTX-43: closes cards by rule (`ended`, `undone`), skipping the action-owner check. */
export function closeCards(
  env: Env,
  ids: readonly string[],
  outcome: Extract<ConcentrationCardResolution, { outcome: string }>["outcome"],
): void {
  for (const id of ids) resolveNotification(env, id, { outcome }, { byRule: true });
}

/** FR-CBTX-10: after the caller's event, every pending card of the ended concentrations. */
export function closeCardsOfEnded(env: Env, ended: Pick<Ended, "concentrationIds">): void {
  closeCards(env, pendingCardsFor(env, ended.concentrationIds), "ended");
}

/** "Frightened (Goblin)" — an effect's name with its target's. */
export const effectLabelWithTarget = (env: Pick<Env, "tx">, e: EffectRecord) =>
  `${effectName(e)} (${effectTargetName(env.tx, e)})`;

/** True if restoring `e` would take a slot already filled (one concentration / condition key). */
function slotTaken(env: Env, e: EffectRecord, restoring: ReadonlySet<string>): boolean {
  if (e.kind === "custom") return false;
  return activeEffectsOf(env.tx, e).some(
    (o) =>
      !restoring.has(o.id) &&
      o.kind === e.kind &&
      (e.kind === "concentration" || o.condition === e.condition),
  );
}

/**
 * FR-CBTX-07 / -22: reactivates soft-ended effects; concentrations first, then the rest. A
 * taken slot, or a link whose concentration stays ended, keeps the row ended and names it in
 * `notRestored`. Restoring never fails the command.
 */
export function restoreEffects(
  env: Env,
  list: readonly EffectRecord[],
): { changes: RecordChange[]; notRestored: string[] } {
  const changes: RecordChange[] = [];
  const notRestored: string[] = [];
  const order = [...list].sort(
    (a, b) =>
      Number(b.kind === "concentration") - Number(a.kind === "concentration") || a.seq - b.seq,
  );
  const restored = new Set<string>();
  for (const e of order) {
    const now = readEffect(env.tx, e.id);
    if (now.endedAt === null) continue;
    const linkDead =
      now.concentrationId !== null &&
      !restored.has(now.concentrationId) &&
      readEffect(env.tx, now.concentrationId).endedAt !== null;
    if (linkDead || slotTaken(env, now, restored)) {
      notRestored.push(effectLabelWithTarget(env, now));
      continue;
    }
    changes.push(
      updateEffectRow(env, now, {
        endedAt: null,
        endedReason: null,
        endedRound: null,
        endedTurnId: null,
        endedByHpChangeId: null,
      }),
    );
    restored.add(now.id);
  }
  return { changes, notRestored };
}

/** Active effects of the campaign ended by an HP change (undo, FR-CBTX-22). */
export function endedByHpChange(env: Env, hpChangeId: string): EffectRecord[] {
  return env.tx
    .select()
    .from(effect)
    .where(eq(effect.endedByHpChangeId, hpChangeId))
    .orderBy(asc(effect.seq))
    .all()
    .map(toEffectRecord);
}

/** Effects by id (any state). */
export function effectsIn(env: Env, ids: readonly string[]): EffectRecord[] {
  if (ids.length === 0) return [];
  return env.tx
    .select()
    .from(effect)
    .where(inArray(effect.id, [...ids]))
    .orderBy(asc(effect.seq))
    .all()
    .map(toEffectRecord);
}
