// FR-CBT-120 (sprint 6, OQ-CBT-81 B): a summon's linked concentration ends (failed save,
// Incapacitated, End effect, replaced: any reason) → combat's `effectHooks` line clears the link
// and creates one DM card `cbt-summon-concentration` per owner and concentration, in that
// transaction. The card resolves itself in the transaction that leaves none of its summons
// active with that owner (`resolveSummonCards`: Dismiss by the owner or the DM, turn hostile,
// release); End dismisses it (end rule). Players get nothing: the cleared link is DM-only, so the
// redacted upsert is identical and the hub drops it (FR-SYNC-17 / -19).
import type { EffectRecord } from "@shared/combat-extras/schemas";
import { isCompanion } from "@shared/combat-tracker/companion";
import type { CombatantRecord } from "@shared/combat-tracker/schemas";
import {
  SUMMON_CARD_KIND,
  SummonCardPayload,
  type SummonCardResolution,
  summonCardAction,
  summonCardText,
} from "@shared/combat-tracker/summon-card-kind";
import { and, asc, eq } from "drizzle-orm";
import type { CommandEnv } from "../../commands/commands";
import { combatant, notification } from "../../db/schema";
import type { DomainEvent, RecordChange } from "../../events/types";
import type { EffectHook } from "../combat-extras/effect-hooks";
import { readEffect } from "../combat-extras/rows";
import { getRow } from "../entities/rows";
import { notify, resolveNotification } from "../notifications";
import { campaignOf, combatantChange, combatantsOf, readCombatant } from "./rows";

/**
 * `effectHooks` line (ADR-0049, append-only registry in combat-extras): for every changed PC
 * whose linked summons' concentration has ended. Effect hooks never emit, so the card's row rides
 * on the causing event's changes (no `NotificationCreated` of its own; clients infer "new" from
 * the store, FR-NOTE-13).
 */
export const summonConcentrationEffectHook: EffectHook = {
  id: "combat-tracker.summon-concentration",
  effectsChanged(env, { creatures, encounter }) {
    if (encounter?.status !== "started") return [];
    const owners = new Set(creatures.flatMap((c) => ("characterId" in c ? [c.characterId] : [])));
    if (owners.size === 0) return [];
    const linked = combatantsOf(env.tx, encounter.id).filter(
      (r) =>
        r.active &&
        r.concentrationEffectId !== null &&
        r.ownerCharacterId !== null &&
        owners.has(r.ownerCharacterId),
    );
    // One card per owner + concentration, summons in `seq` order.
    const groups = new Map<string, { effect: EffectRecord; rows: CombatantRecord[] }>();
    for (const r of linked) {
      const e = readEffect(env.tx, r.concentrationEffectId as string);
      if (e.endedAt === null) continue;
      const key = `${r.ownerCharacterId}:${e.id}`;
      const g = groups.get(key) ?? { effect: e, rows: [] };
      g.rows.push(r);
      groups.set(key, g);
    }
    const out: RecordChange[] = [];
    for (const { effect, rows } of groups.values()) {
      for (const r of rows) {
        env.tx
          .update(combatant)
          .set({ concentrationEffectId: null })
          .where(eq(combatant.id, r.id))
          .run();
        out.push(combatantChange(r, readCombatant(env.tx, r.id)));
      }
      const ownerId = rows[0]?.ownerCharacterId as string;
      const owner = getRow(env.tx as CommandEnv["tx"], ownerId)?.name ?? "";
      const captured: DomainEvent[] = [];
      notify(
        { ...env, emit: (e) => captured.push(e) },
        {
          kind: SUMMON_CARD_KIND,
          audience: "dm",
          text: summonCardText(
            owner,
            effect.label ?? "",
            rows.map((r) => r.name),
          ),
          payload: {
            encounterId: encounter.id,
            ownerCharacterId: ownerId,
            effectId: effect.id,
            combatantIds: rows.map((r) => r.id),
          } satisfies SummonCardPayload,
          action: { label: summonCardAction(rows.length), role: "dm" },
        },
      );
      out.push(...captured.flatMap((e) => e.changes));
    }
    return out;
  },
};

/** Pending cards of the encounter, `seq` order. */
export function pendingSummonCards(
  env: Pick<CommandEnv, "tx" | "actor">,
  encounterId: string,
): { id: string; payload: SummonCardPayload }[] {
  return env.tx
    .select({ id: notification.id, payload: notification.payload })
    .from(notification)
    .where(
      and(
        eq(notification.campaignId, campaignOf(env.actor)),
        eq(notification.kind, SUMMON_CARD_KIND),
        eq(notification.state, "pending"),
      ),
    )
    .orderBy(asc(notification.seq))
    .all()
    .map((n) => ({ id: n.id, payload: SummonCardPayload.parse(n.payload) }))
    .filter((n) => n.payload.encounterId === encounterId);
}

/** A card's summons still active with its owner (the ones its actions act on). */
export function summonsLeft(
  rows: readonly CombatantRecord[],
  p: SummonCardPayload,
): CombatantRecord[] {
  const ids = new Set(p.combatantIds);
  return rows.filter(
    (r) => ids.has(r.id) && r.active && isCompanion(r) && r.ownerCharacterId === p.ownerCharacterId,
  );
}

/**
 * FR-CBT-120: after the caller's own event, every pending card of the encounter with none of its
 * summons left resolves by rule with `outcome`. None → nothing.
 */
export function resolveSummonCards(
  env: CommandEnv,
  encounterId: string,
  outcome: SummonCardResolution["outcome"],
): void {
  const cards = pendingSummonCards(env, encounterId);
  if (cards.length === 0) return;
  const rows = combatantsOf(env.tx, encounterId);
  for (const c of cards) {
    if (summonsLeft(rows, c.payload).length > 0) continue;
    resolveNotification(env, c.id, { outcome }, { byRule: true });
  }
}
