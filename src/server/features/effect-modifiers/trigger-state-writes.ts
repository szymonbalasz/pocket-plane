// Trigger state writes (FR-MOD-53, -54; ADR-0049 D1): the one place `trigger-state` rows are
// derived and written. `triggerStates(env, encounter, combatantIds?)` rewrites the rows of the
// started encounter (or of the given combatants) to what the committed rows say now and returns
// the changes for the causing event; unchanged rows are not rewritten, an encounter that isn't
// started has no rows. Callers: MOD's combat rule-hook line (started / added / turnChanged /
// ended), its effect-hook line, apply hook (apply / revert), roll hook (a `roll` trigger spent at
// once), trigger commands and the owner-copy hook. A display copy: no rule reads these rows.
//
// Imports stay to the schema, `@shared` and row readers: the roll hook (imported by
// `dice.evaluate`) imports this module.
import type { EncounterRecord } from "@shared/combat-tracker/schemas";
import { requiresMet, windowKey } from "@shared/effect-modifiers/trigger-fire";
import { type TriggerStateRecord, triggerCharge } from "@shared/effect-modifiers/trigger-state";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { CommandEnv } from "../../commands/commands";
import type { Tx } from "../../db/client";
import {
  combatant,
  effect,
  effectPreset,
  ruleTrigger,
  triggerState,
  triggerUse,
} from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { triggerStateChange } from "./trigger-state";

type Read = Pick<Tx, "select">;
type Env = Pick<CommandEnv, "tx" | "ctx">;

/** A row's derived and copied fields (no id, no `updatedAt`). */
export type TriggerStateValues = Omit<TriggerStateRecord, "id" | "updatedAt">;

const keyOf = (r: { combatantId: string; triggerId: string }) => `${r.combatantId}|${r.triggerId}`;

/**
 * FR-MOD-53, pure over committed rows: one row per (enabled trigger, owner combatant) of a
 * started encounter, for every active combatant (removed ones keep theirs) or just `combatantIds`.
 * A PC → its character's triggers; a monster → its definition's, one row per combatant. Five
 * indexed reads, whatever the encounter's size.
 */
export function deriveTriggerStates(
  read: Read,
  enc: EncounterRecord,
  combatantIds?: readonly string[],
): TriggerStateValues[] {
  if (enc.status !== "started" || combatantIds?.length === 0) return [];
  const fighters = read
    .select()
    .from(combatant)
    .where(
      and(
        eq(combatant.encounterId, enc.id),
        eq(combatant.active, true),
        ...(combatantIds ? [inArray(combatant.id, [...combatantIds])] : []),
      ),
    )
    .orderBy(asc(combatant.seq))
    .all();
  if (fighters.length === 0) return [];
  const triggers = read
    .select()
    .from(ruleTrigger)
    .where(and(eq(ruleTrigger.campaignId, enc.campaignId), eq(ruleTrigger.enabled, true)))
    .orderBy(asc(ruleTrigger.seq))
    .all();
  if (triggers.length === 0) return [];
  const effects = read
    .select({
      presetKey: effect.presetKey,
      targetCharacterId: effect.targetCharacterId,
      targetCombatantId: effect.targetCombatantId,
    })
    .from(effect)
    .where(and(eq(effect.campaignId, enc.campaignId), isNull(effect.endedAt)))
    .all();
  const origins = new Map(
    triggers.some((t) => t.rule.requires)
      ? read
          .select({ id: effectPreset.id, originKey: effectPreset.originKey })
          .from(effectPreset)
          .where(eq(effectPreset.campaignId, enc.campaignId))
          .all()
          .map((p) => [p.id, p.originKey])
      : [],
  );
  const originOf = (k: string) => origins.get(k) ?? null;
  const used = new Set(
    read
      .select({
        triggerId: triggerUse.triggerId,
        combatantId: triggerUse.ownerCombatantId,
        window: triggerUse.window,
      })
      .from(triggerUse)
      .where(and(eq(triggerUse.encounterId, enc.id), eq(triggerUse.state, "used")))
      .all()
      .map((u) => `${u.combatantId}|${u.triggerId}|${u.window}`),
  );
  const out: TriggerStateValues[] = [];
  for (const k of fighters) {
    const pc = k.kind === "pc";
    const mine = triggers.filter((t) =>
      pc ? t.characterId === k.entityId : t.definitionId === k.entityId,
    );
    if (mine.length === 0) continue;
    const keys = effects
      .filter((e) => (pc ? e.targetCharacterId === k.entityId : e.targetCombatantId === k.id))
      .map((e) => e.presetKey);
    const ownTurn = enc.turnCombatantId === k.id;
    for (const t of mine) {
      const every = t.rule.every;
      out.push({
        campaignId: enc.campaignId,
        encounterId: enc.id,
        combatantId: k.id,
        triggerId: t.id,
        characterId: t.characterId,
        ownerPlayerId: t.characterId ? t.ownerPlayerId : null,
        name: t.name,
        on: t.rule.on,
        armed: requiresMet(t.rule, keys, originOf),
        charge: triggerCharge(t.rule, {
          ownTurn,
          used: used.has(`${k.id}|${t.id}|${windowKey(every, enc)}`),
        }),
        featureId: typeof every === "object" ? every.feature : null,
      });
    }
  }
  return out;
}

/** The stored rows of an encounter (or of some of its combatants), stable order. */
function storedStates(
  read: Read,
  encounterId: string,
  combatantIds?: readonly string[],
): TriggerStateRecord[] {
  return read
    .select()
    .from(triggerState)
    .where(
      and(
        eq(triggerState.encounterId, encounterId),
        ...(combatantIds ? [inArray(triggerState.combatantId, [...combatantIds])] : []),
      ),
    )
    .orderBy(asc(triggerState.combatantId), asc(triggerState.triggerId))
    .all();
}

const sameValues = (a: TriggerStateRecord, b: TriggerStateValues): boolean =>
  a.characterId === b.characterId &&
  a.ownerPlayerId === b.ownerPlayerId &&
  a.name === b.name &&
  a.on === b.on &&
  a.armed === b.armed &&
  a.charge === b.charge &&
  a.featureId === b.featureId;

/**
 * FR-MOD-54: rewrites `encounter`'s rows (all, or `combatantIds`') to `deriveTriggerStates` in
 * the caller's transaction: insert / update / delete only what differs. An encounter that isn't
 * started loses all its rows (End). Null → nothing (out of combat).
 */
export function triggerStates(
  env: Env,
  enc: EncounterRecord | null,
  combatantIds?: readonly string[],
): RecordChange[] {
  if (!enc || combatantIds?.length === 0) return [];
  const scope = enc.status === "started" ? combatantIds : undefined;
  const stored = new Map(storedStates(env.tx, enc.id, scope).map((r) => [keyOf(r), r]));
  const want = deriveTriggerStates(env.tx, enc, scope);
  if (stored.size === 0 && want.length === 0) return [];
  const now = env.ctx.clock.iso();
  const changes: RecordChange[] = [];
  for (const v of want) {
    const before = stored.get(keyOf(v));
    stored.delete(keyOf(v));
    if (before && sameValues(before, v)) continue;
    const after: TriggerStateRecord = {
      ...v,
      id: before?.id ?? env.ctx.ids.next(),
      updatedAt: now,
    };
    if (before) env.tx.update(triggerState).set(after).where(eq(triggerState.id, before.id)).run();
    else env.tx.insert(triggerState).values(after).run();
    changes.push(triggerStateChange(before ?? null, after));
  }
  for (const before of stored.values()) {
    env.tx.delete(triggerState).where(eq(triggerState.id, before.id)).run();
    changes.push(triggerStateChange(before, null));
  }
  return changes;
}

/** A deleted trigger's rows (before the delete, so each is listed; the FK would cascade them). */
export function dropTriggerStates(env: Env, triggerId: string): RecordChange[] {
  const rows = env.tx
    .select()
    .from(triggerState)
    .where(eq(triggerState.triggerId, triggerId))
    .all();
  if (rows.length === 0) return [];
  env.tx.delete(triggerState).where(eq(triggerState.triggerId, triggerId)).run();
  return rows.map((r) => triggerStateChange(r, null));
}

/** The started encounter's combatants of some creatures (a PC by its character), seq order. */
export function combatantsOfCreatures(
  read: Read,
  enc: EncounterRecord,
  creatures: readonly ({ characterId: string } | { combatantId: string })[],
): string[] {
  const chars = new Set(creatures.flatMap((c) => ("characterId" in c ? [c.characterId] : [])));
  const ids = new Set(creatures.flatMap((c) => ("combatantId" in c ? [c.combatantId] : [])));
  return read
    .select({ id: combatant.id, kind: combatant.kind, entityId: combatant.entityId })
    .from(combatant)
    .where(and(eq(combatant.encounterId, enc.id), eq(combatant.active, true)))
    .orderBy(asc(combatant.seq))
    .all()
    .filter((k) => ids.has(k.id) || (k.kind === "pc" && chars.has(k.entityId)))
    .map((k) => k.id);
}
