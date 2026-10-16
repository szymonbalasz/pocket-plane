// Roll-hook parts on combat's damage card and outcome line (FR-MOD-16, -19, -20): the card's
// to-hit / damage part carries the player-safe `mods` and a total that includes them; at apply,
// the rolled value = base + parts and the DM's names come from the roll line's `dmPayload`.
import { CARD_MODS_MAX, type CardRoll } from "@shared/combat-tracker/schemas";
import {
  type DmModPart,
  RollEntryDmPayload,
  RollEntryPayload,
} from "@shared/dice-roll-log/schemas";
import { modsTotal } from "@shared/effect-modifiers/line";
import { and, eq, sql } from "drizzle-orm";
import type { CommandEnv } from "../../commands/commands";
import { conflict } from "../../commands/errors";
import { gameLogEntry } from "../../db/schema";
import { dice, type EvaluatedRoll } from "../dice-roll-log";

/**
 * A card roll with the roll's parts: `total` includes them, `mods` lists them (player-safe).
 * More than `CARD_MODS_MAX` parts → `conflict` (the card would outgrow its payload cap).
 * Per-die `dice` stay on the roll entry only (FR-MOD-19, D9: no card bytes).
 */
export function withCardMods<T extends CardRoll>(card: T, r: EvaluatedRoll): T {
  const mods = dice.rollPayloadItem(r).mods?.map(({ dice: _dice, ...m }) => m);
  if (!mods || !r.mods) return card;
  if (mods.length > CARD_MODS_MAX) {
    throw conflict(`At most ${CARD_MODS_MAX} effect modifiers on an attack or damage roll`);
  }
  return { ...card, total: card.total + r.mods.modTotal, mods };
}

/** FR-MOD-16: the rolled value of a card part = its base roll + its parts. */
export const rolledOf = (base: number, part: Pick<CardRoll, "mods"> | null | undefined) =>
  base + modsTotal(part?.mods);

/** Every roll id of a card part: the base roll and its bonus-die rows (FR-DICE-26). */
export const cardRollIds = (part: Pick<CardRoll, "rollId" | "mods"> | null | undefined) =>
  part ? [part.rollId, ...(part.mods ?? []).flatMap((m) => (m.rollId ? [m.rollId] : []))] : [];

/**
 * FR-MOD-20: the DM's names of a card part's mods, read from the `roll` line that rolled it
 * (`dmPayload`, same index as the payload item with that roll). Null without parts.
 */
export function dmModNames(
  env: Pick<CommandEnv, "tx" | "actor">,
  rollId: string,
): DmModPart[] | null {
  const rows = env.tx
    .select({ payload: gameLogEntry.payload, dmPayload: gameLogEntry.dmPayload })
    .from(gameLogEntry)
    .where(
      and(
        eq(gameLogEntry.campaignId, env.actor.campaignId as string),
        eq(gameLogEntry.kind, "roll"),
        sql`exists (select 1 from json_each(${gameLogEntry.rollIds}) where value = ${rollId})`,
      ),
    )
    .all();
  for (const row of rows) {
    const items = RollEntryPayload.safeParse(row.payload);
    const dm = RollEntryDmPayload.safeParse(row.dmPayload);
    if (!items.success || !dm.success) continue;
    const i = items.data.findIndex((it) => it.rollId === rollId);
    const names = dm.data.items[i]?.mods;
    if (names?.length) return names;
  }
  return null;
}
