// Offered rule-trigger parts on combat's damage card and roll line (FR-MOD-19, -37, -51; ADR-0043
// D1). The roll hook rolled them (`mods.offered`, not in the total); the card caller puts them on
// the card's `damage.triggers` with their settle facts, fits the card into its kind's cap
// (dropping offers from the last: their roll rows go, a DM note says so; never a failed roll),
// writes the roll line (damage item `offered`, DM names, `notes`) and, once the card id is known,
// records one server-only `trigger_use` row `offered` per part.
import type {
  CardDamage,
  CardTriggerPart,
  DamageCardPayload,
} from "@shared/combat-tracker/schemas";
import {
  ROLL_NOTES_MAX,
  type RollEntryDmPayload,
  type RollPayloadItem,
} from "@shared/dice-roll-log/schemas";
import { windowKey } from "@shared/effect-modifiers/trigger-fire";
import { jsonBytes } from "@shared/notifications/schemas";
import { eq } from "drizzle-orm";
import type { CommandEnv } from "../../commands/commands";
import { roll, triggerUse, triggerUseSeqNext } from "../../db/schema";
import { DAMAGE_CARD_PAYLOAD_MAX_BYTES } from "../combat-tracker/card-kind";
import { readEncounter } from "../combat-tracker/rows";
import { dice, type EvaluatedRoll } from "../dice-roll-log";
import type { OfferedPart } from "../dice-roll-log/roll-hooks";
import { triggersByIds } from "./trigger-hook";

/** FR-MOD-19: a card's offered part = the hook's offer without `public` / `dice`. */
const cardPart = (o: OfferedPart): CardTriggerPart => ({
  triggerId: o.triggerId,
  label: o.label,
  value: o.value,
  expression: o.expression,
  rollId: o.rollId,
  type: o.type,
  ...(o.auto ? { auto: true } : {}),
  ...(o.ask ? { ask: o.ask } : {}),
  ...(o.marked ? { marked: o.marked } : {}),
  ...(o.hurt ? { hurt: true } : {}),
  ...(o.untick ? { untick: true } : {}),
});

/**
 * FR-MOD-37 (R10): the card with its damage roll's offers on `damage.triggers`. Over the kind's
 * 4 KB cap → drop offers from the last: their roll rows are deleted (same transaction), the
 * roll's `offered` shrinks and gets the DM note "+ N triggers skipped".
 */
export function withCardOffers(
  env: Pick<CommandEnv, "tx">,
  payload: DamageCardPayload,
  damage: EvaluatedRoll | null,
): DamageCardPayload {
  const offered = damage?.mods?.offered;
  if (!damage?.mods || !offered?.length || !payload.damage) return payload;
  const at = (n: number): DamageCardPayload => {
    const { triggers: _t, ...rest } = payload.damage as CardDamage;
    const parts = offered.slice(0, n).map(cardPart);
    return { ...payload, damage: parts.length ? { ...rest, triggers: parts } : rest };
  };
  let n = offered.length;
  while (n > 0 && jsonBytes(at(n)) > DAMAGE_CARD_PAYLOAD_MAX_BYTES) n--;
  const dropped = offered.slice(n);
  if (dropped.length) {
    for (const o of dropped) env.tx.delete(roll).where(eq(roll.id, o.rollId)).run();
    damage.mods.offered = offered.slice(0, n);
    const k = dropped.length;
    damage.mods.notes = [
      ...(damage.mods.notes ?? []),
      `+ ${k} trigger${k === 1 ? "" : "s"} skipped`,
    ];
  }
  return at(n);
}

/**
 * The `roll` line of these rolls: payload items + `dmPayload` with the offers (damage item
 * `offered`, label iff the trigger is public; DM names) and every hook note (DM only, ≤ 4).
 */
export function rollLine(rolls: readonly EvaluatedRoll[]): {
  payload: RollPayloadItem[];
  dmPayload: RollEntryDmPayload | undefined;
} {
  const payload = rolls.map((r) => {
    const item = dice.rollPayloadItem(r);
    const offered = r.mods?.offered;
    if (item.offered || !offered?.length) return item;
    return {
      ...item,
      offered: offered.map((o) => ({
        label: o.public ? o.label : null,
        value: o.value,
        expression: o.expression,
        rollId: o.rollId,
        type: o.type,
        ...(o.auto ? { auto: true as const } : {}),
        ...(o.dice ? { dice: o.dice } : {}),
      })),
    };
  });
  const notes = [...new Set(rolls.flatMap((r) => r.mods?.notes ?? []))].slice(0, ROLL_NOTES_MAX);
  const anyOffer = rolls.some((r) => r.mods?.offered?.length);
  let dm = dice.rollDmPayload(rolls);
  if (!dm && !anyOffer && notes.length === 0) return { payload, dmPayload: undefined };
  dm ??= { items: rolls.map(() => ({ mods: [] })) };
  const items = dm.items.map((it, i) => {
    const offered = rolls[i]?.mods?.offered;
    if (it.offered || !offered?.length) return it;
    return { ...it, offered: offered.map((o) => ({ triggerId: o.triggerId, label: o.label })) };
  });
  const merged = [...new Set([...(dm.notes ?? []), ...notes])].slice(0, ROLL_NOTES_MAX);
  return { payload, dmPayload: { ...dm, items, ...(merged.length ? { notes: merged } : {}) } };
}

/**
 * FR-MOD-37, -42: one `trigger_use` row `offered` per part on the card (window = the started
 * encounter's key for the trigger's frequency now; owner = the card's attacker combatant).
 */
export function recordOffers(env: CommandEnv, cardId: string, payload: DamageCardPayload): void {
  const parts = payload.damage?.triggers ?? [];
  if (parts.length === 0) return;
  const enc = readEncounter(env.tx, payload.encounterId);
  const triggers = new Map(
    triggersByIds(
      env,
      parts.map((p) => p.triggerId),
    ).map((t) => [t.id, t]),
  );
  const now = env.ctx.clock.iso();
  parts.forEach((p, part) => {
    const t = triggers.get(p.triggerId);
    if (!t) return;
    env.tx
      .insert(triggerUse)
      .values({
        id: env.ctx.ids.next(),
        campaignId: enc.campaignId,
        encounterId: enc.id,
        seq: triggerUseSeqNext,
        triggerId: t.id,
        ownerCombatantId: payload.attackerId,
        window: windowKey(t.rule.every, enc),
        state: "offered",
        cardId,
        rollId: p.rollId,
        part,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  });
}
