// Card helpers for gems (sprint 7, FR-CBT-126–129), called inside gems' `gem.spend`; generic
// names, nothing on the card says "gem". `findToHitCard` names the card a rerolled to-hit belongs
// to; `replaceToHit` (FR-CBT-126) moves a pending, unruled card onto the new to-hit; a crit flip
// with damage on the card (FR-CBT-127, OQ-CBT-85 A) sends the damage to "not used" and the card
// waits for a new damage roll (`cbt.rollDamage` doubles it after a natural 20).
import {
  type CardToHit,
  DAMAGE_CARD_KIND,
  DamageCardPayload,
  UNUSED_ROLLS_MAX,
} from "@shared/combat-tracker/schemas";
import type { RollPayloadItem } from "@shared/dice-roll-log/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { and, desc, eq } from "drizzle-orm";
import type { CommandEnv } from "../../commands/commands";
import { conflict, notFound } from "../../commands/errors";
import { notification, triggerUse } from "../../db/schema";
import {
  loadNotification,
  toNotificationRecord,
  updateNotification,
} from "../notifications/helpers";
import { damageCardText, fitCardPayload } from "./card-kind";
import { rulingOfCard } from "./rows";

/** FR-CBT-126: the DM's Apply hit already ruled on the card. */
export const ALREADY_RULED = "The DM already ruled on this attack";

/** The damage card whose to-hit is `rollId` (any state), newest first; null = none. */
export function findToHitCard(
  env: Pick<CommandEnv, "tx" | "actor">,
  rollId: string,
): { card: NotificationRecord; p: DamageCardPayload } | null {
  const cid = env.actor.campaignId;
  if (!cid) return null;
  const rows = env.tx
    .select()
    .from(notification)
    .where(and(eq(notification.campaignId, cid), eq(notification.kind, DAMAGE_CARD_KIND)))
    .orderBy(desc(notification.seq))
    .all();
  for (const r of rows) {
    const p = DamageCardPayload.safeParse(r.payload);
    if (p.success && p.data.toHit?.rollId === rollId)
      return { card: toNotificationRecord(r), p: p.data };
  }
  return null;
}

/** FR-CBT-126: why this card can't follow a reroll (`conflict`), or null. */
export function toHitBlock(env: Pick<CommandEnv, "tx">, card: NotificationRecord): string | null {
  if (card.state !== "pending") return "The attack was already applied";
  if (rulingOfCard(env.tx, card.id)) return ALREADY_RULED;
  return null;
}

export interface ReplacedToHit {
  /** The card's crit changed with damage on it: the damage moved to `unusedRolls`. */
  critFlipped: boolean;
}

/**
 * FR-CBT-126: the pending, unruled card takes the rerolled to-hit (`item`, the new entry's payload
 * item: dice, constant, total incl. the copied mods, natural, manual); `crit` = natural 20;
 * `updateNotification` (no toast, same `seq`). FR-CBT-127: `crit` changed and damage on the card
 * → the damage (with its extra parts, offers and maxed dice) moves to `unusedRolls` as
 * `{rollId, total}` (cap 3, oldest dropped), `damage` null, its offered trigger uses dropped;
 * `diceMaxed` goes with it (review-a #15), so a new Combat gem may max the new damage.
 */
export function replaceToHit(
  env: CommandEnv,
  cardId: string,
  item: RollPayloadItem,
): ReplacedToHit {
  const card = loadNotification(env, cardId);
  if (card.kind !== DAMAGE_CARD_KIND) throw notFound("Damage card not found");
  const block = toHitBlock(env, card);
  if (block) throw conflict(block);
  const p = DamageCardPayload.parse(card.payload);
  if (!p.toHit) throw conflict("This card has no to-hit roll");
  const toHit: CardToHit = {
    rollId: item.rollId,
    dice: item.dice.map((d) => [d.value, d.kept] as [number | null, boolean]),
    constant: item.constant,
    total: item.total,
    manual: item.manual,
    ...(p.toHit.mods ? { mods: p.toHit.mods } : {}),
    natural: item.natural,
  };
  const crit = item.natural === 20;
  const critFlipped = crit !== p.crit && p.damage !== null;
  // GM2's `diceMaxed` (FR-CBT-128) never survives a flip; unknown keys never reach the payload.
  const { diceMaxed: _maxed, ...base } = p as DamageCardPayload & { diceMaxed?: true };
  let payload: DamageCardPayload = { ...base, toHit, crit };
  if (critFlipped && p.damage) {
    const total = p.damage.total + (p.damage.extra ?? []).reduce((s, x) => s + x.total, 0);
    const unusedRolls = [...(p.unusedRolls ?? []), { rollId: p.damage.rollId, total }].slice(
      -UNUSED_ROLLS_MAX,
    );
    payload = { ...payload, damage: null, unusedRolls };
    env.tx
      .delete(triggerUse)
      .where(and(eq(triggerUse.cardId, card.id), eq(triggerUse.state, "offered")))
      .run();
  }
  updateNotification(env, card.id, {
    text: damageCardText(payload),
    payload: fitCardPayload(payload),
  });
  return { critFlipped };
}

export const cards = { findToHitCard, toHitBlock, replaceToHit } as const;
