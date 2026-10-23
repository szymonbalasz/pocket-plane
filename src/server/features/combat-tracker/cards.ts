// Card helpers for gems (sprint 7, FR-CBT-126–129), called inside gems' `gem.spend`; generic
// names, nothing on the card says "gem". `findToHitCard` names the card a rerolled to-hit belongs
// to; `replaceToHit` (FR-CBT-126) moves a pending, unruled card onto the new to-hit; a crit flip
// with damage on the card (FR-CBT-127, OQ-CBT-85 A) sends the damage to "not used" and the card
// waits for a new damage roll (`cbt.rollDamage` doubles it after a natural 20). `maxDice`
// (FR-CBT-128) sets 1–3 weapon dice of the card's damage to their max on new roll rows.
// FR-GEM-42 (BL-63): both write the card with `updateNotification({emit: false})` and return its
// change; the caller's `GemSpent` carries it (one frame per spend). `cardLineItems` (FR-GEM-41,
// BL-62): a rerolled attack line's other items as the card now shows them.
import {
  type CardDiePick,
  type CardKnownDice,
  type CardPartRef,
  type CardToHit,
  cardPart,
  DAMAGE_CARD_KIND,
  DamageCardPayload,
  UNUSED_ROLLS_MAX,
} from "@shared/combat-tracker/schemas";
import type { DieResult, RollPayloadItem } from "@shared/dice-roll-log/schemas";
import { modsTotal } from "@shared/effect-modifiers/line";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { and, desc, eq } from "drizzle-orm";
import type { CommandEnv } from "../../commands/commands";
import { conflict, invalid, notFound } from "../../commands/errors";
import { notification, roll, triggerUse } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import type { Roll } from "../dice-roll-log/evaluate";
import type { OldEntry, RerollOthers } from "../dice-roll-log/reroll";
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
  /** The card's upsert, for the caller's event (FR-GEM-42). */
  change: RecordChange;
  /** The card's payload now. */
  payload: DamageCardPayload;
}

/**
 * FR-CBT-126: the pending, unruled card takes the rerolled to-hit (`item`, the new entry's payload
 * item: dice, constant, total incl. the copied mods, natural, manual); `crit` = natural 20;
 * `updateNotification` (no toast, same `seq`). FR-CBT-127: `crit` changed and damage on the card
 * → the damage (with its extra parts, offers and maxed dice) moves to `unusedRolls` as
 * `{rollId, total}` (cap 3, oldest dropped), `damage` null, its offered trigger uses dropped;
 * `diceMaxed` goes with it (review-a #15), so a new Combat gem may max the new damage. No event:
 * the change is returned (FR-GEM-42).
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
  let payload: DamageCardPayload = { ...p, toHit, crit };
  if (critFlipped && p.damage) {
    // FR-CBT-127: `diceMaxed` goes with the moved damage (review-a #15).
    const { diceMaxed: _maxed, ...rest } = payload;
    const total = p.damage.total + (p.damage.extra ?? []).reduce((s, x) => s + x.total, 0);
    const unusedRolls = [...(p.unusedRolls ?? []), { rollId: p.damage.rollId, total }].slice(
      -UNUSED_ROLLS_MAX,
    );
    payload = { ...rest, damage: null, unusedRolls };
    env.tx
      .delete(triggerUse)
      .where(and(eq(triggerUse.cardId, card.id), eq(triggerUse.state, "offered")))
      .run();
  }
  const change = updateNotification(
    env,
    card.id,
    { text: damageCardText(payload), payload: fitCardPayload(payload) },
    { emit: false },
  );
  return { critFlipped, change, payload };
}

/** A roll id and the ids it replaced (`replacesRollId`, newest first). */
function rollChain(env: Pick<CommandEnv, "tx" | "actor">, id: string): string[] {
  const ids = [id];
  for (let r = rollRow(env, id); r.replacesRollId && ids.length < 8; ) {
    ids.push(r.replacesRollId);
    r = rollRow(env, r.replacesRollId);
  }
  return ids;
}

/**
 * FR-GEM-41 (BL-62, FR-DICE-91): a rerolled attack line's other items as the card `p` shows them
 * now. An item whose roll is (or was replaced by) a card damage part takes that part's current
 * roll (maxed dice, total + its `mods`, FR-GEM-27); any other item is dropped (its damage went to
 * "not used" on a crit flip, FR-CBT-127); the rerolled to-hit's slot is the new `item`'s (it
 * matches no part). Roll ids: the old line's, the to-hit's and a maxed part's swapped for the new
 * rows, a dropped item's (with its part and offered rolls) left out.
 */
export function cardLineItems(
  env: Pick<CommandEnv, "tx" | "actor">,
  p: DamageCardPayload,
  item: RollPayloadItem,
  old: OldEntry,
): RerollOthers {
  const parts = p.damage ? [p.damage, ...(p.damage.extra ?? [])] : [];
  const chains = parts.map((part) => rollChain(env, part.rollId));
  const items = old.items.map((x, i): RollPayloadItem | null => {
    if (i === old.at) return item;
    const at = chains.findIndex((c) => c.includes(x.rollId));
    const part = parts[at];
    if (!part) return null;
    if (part.rollId === x.rollId) return x;
    const row = rollRow(env, part.rollId);
    return {
      ...x,
      rollId: row.id,
      manual: row.manual,
      dice: row.dice,
      total: row.total + modsTotal(x.mods),
    };
  });
  const swap = new Map<string, string>();
  const dropped = new Set<string>();
  old.items.forEach((x, i) => {
    const now = items[i];
    if (now) {
      if (now.rollId !== x.rollId) swap.set(x.rollId, now.rollId);
      return;
    }
    dropped.add(x.rollId);
    for (const m of x.mods ?? []) if (m.rollId) dropped.add(m.rollId);
    for (const o of x.offered ?? []) if (o.rollId) dropped.add(o.rollId);
  });
  const rollIds = old.rollIds.filter((id) => !dropped.has(id)).map((id) => swap.get(id) ?? id);
  return { items, rollIds };
}

/** FR-CBT-128: why a card can't take maxed dice now (`conflict`). */
export const ALREADY_APPLIED = "Already applied";
export const NO_DAMAGE_YET = "No damage on the card yet";
export const ALREADY_MAXED = "Dice already maxed on this card";
/** FR-CBT-128 (OQ-GEM-13 A): a part entered as a physical total. */
export const ENTER_EACH_DIE = "Enter each die first";

/** FR-CBT-128: one maxed die (the spend line's detail, gems FR-GEM-30). */
export interface MaxedDie {
  part: CardPartRef;
  /** The part's damage type (base: the card's; null = untyped). */
  type: string | null;
  faces: number;
  from: number;
  to: number;
}

interface MaxedPart {
  part: CardPartRef;
  row: Roll;
  /** The part's dice with every value known and the picked ones at their faces. */
  dice: DieResult[];
  indices: number[];
}

/** FR-CBT-128: what `applyMaxDice` writes, checked; nothing written yet. */
export interface MaxDicePlan {
  card: NotificationRecord;
  p: DamageCardPayload;
  parts: MaxedPart[];
  dice: MaxedDie[];
  /** The card's damage (every weapon part) before and after. */
  from: number;
  to: number;
}

const bad = (message: string, path: (string | number)[]) => invalid(message, [{ path, message }]);
const keptSum = (dice: readonly DieResult[]) =>
  dice.reduce((s, d) => s + (d.kept ? (d.value ?? 0) : 0), 0);

/**
 * FR-CBT-128: checks the picks against the card and works out the new dice; writes nothing.
 * Card `pending` (else `conflict` "Already applied"), damage attached (incl. the damage step after
 * Apply hit, FR-CBT-134), `diceMaxed` unset (else `conflict`). Each pick a kept die of the base
 * or an extra weapon part (never `mods` / `triggers`: they are no part), below its max, each die
 * once (`invalid`); a part stored as a physical total needs `known` (count / faces matching, kept
 * sum = the stored dice total), else `invalid` "Enter each die first".
 */
export function planMaxDice(
  env: CommandEnv,
  cardId: string,
  picks: readonly CardDiePick[],
  known: readonly CardKnownDice[] = [],
): MaxDicePlan {
  const card = loadNotification(env, cardId);
  if (card.kind !== DAMAGE_CARD_KIND) throw notFound("Damage card not found");
  if (card.state !== "pending") throw conflict(ALREADY_APPLIED);
  const p = DamageCardPayload.parse(card.payload);
  if (!p.damage) throw conflict(NO_DAMAGE_YET);
  if (p.diceMaxed) throw conflict(ALREADY_MAXED);
  const byPart = new Map<CardPartRef, MaxedPart>();
  const dice: MaxedDie[] = [];
  picks.forEach((pick, i) => {
    const part = cardPart(p, pick.part);
    if (!part) throw bad("No such damage part", ["dice", i, "part"]);
    let planned = byPart.get(pick.part);
    if (!planned) {
      const row = rollRow(env, part.rollId);
      planned = { part: pick.part, row, dice: knownDice(row, pick.part, known), indices: [] };
      byPart.set(pick.part, planned);
    }
    if (planned.indices.includes(pick.index)) throw bad("Each die once", ["dice", i]);
    const die = planned.dice[pick.index];
    if (!die) throw bad("No such die", ["dice", i, "index"]);
    if (!die.kept) throw bad("A dropped die can't be maxed", ["dice", i, "index"]);
    const value = die.value ?? 0;
    if (value >= die.faces) throw bad("Already at its max", ["dice", i, "index"]);
    planned.dice[pick.index] = { ...die, value: die.faces };
    planned.indices.push(pick.index);
    const type = pick.part === "base" ? p.damageType : (p.damage?.extra?.[pick.part]?.type ?? null);
    dice.push({ part: pick.part, type, faces: die.faces, from: value, to: die.faces });
  });
  const from = p.damage.total + (p.damage.extra ?? []).reduce((s, x) => s + x.total, 0);
  const gained = dice.reduce((s, d) => s + d.to - d.from, 0);
  return { card, p, parts: [...byPart.values()], dice, from, to: from + gained };
}

function rollRow(env: Pick<CommandEnv, "tx" | "actor">, id: string): Roll {
  const r = env.tx.select().from(roll).where(eq(roll.id, id)).get();
  if (!r || r.campaignId !== env.actor.campaignId) throw new Error(`Card roll ${id} missing`);
  return { ...r, dice: r.dice as DieResult[] };
}

/** The part's dice with every value known: a physical total takes `known` (OQ-GEM-13 A). */
function knownDice(row: Roll, part: CardPartRef, known: readonly CardKnownDice[]): DieResult[] {
  const at = known.findIndex((k) => k.part === part);
  const k = known[at];
  if (row.dice.every((d) => d.value !== null)) {
    if (k) throw bad("This part's dice are known", ["known", at]);
    return row.dice.map((d) => ({ ...d }));
  }
  if (!k) throw bad(ENTER_EACH_DIE, ["known"]);
  if (k.dice.length !== row.dice.length) throw bad(`Enter ${row.dice.length} dice`, ["known", at]);
  const dice = row.dice.map((d, i) => ({ ...d, value: k.dice[i] as number }));
  if (dice.some((d) => (d.value as number) > d.faces)) {
    throw bad("A die is above its faces", ["known", at]);
  }
  const stored = row.total - row.constant;
  if (keptSum(dice) !== stored) {
    throw bad(`The dice add up to ${keptSum(dice)}, not ${stored}`, ["known", at]);
  }
  return dice;
}

/**
 * FR-CBT-128: writes a plan: per touched part a new roll row (a copy of the part's row with the
 * picked dice at their faces, `replacesRollId` = the old id, `manual` kept, total recomputed); the
 * card part takes the new `rollId`, `dice`, `total` (base: + its mods, FR-MOD-16) and `maxed`; the
 * card `diceMaxed`; `updateNotification` (no toast, same `seq`, no event: FR-GEM-42). `ids`: the
 * new rows' ids when the caller named them already (its event, in `plan.parts` order). Returns
 * the new roll ids and the card's change for the caller's event.
 */
export function applyMaxDice(
  env: CommandEnv,
  plan: MaxDicePlan,
  ids: readonly string[] = [],
): { rollIds: string[]; change: RecordChange } {
  const { p } = plan;
  if (!p.damage) throw conflict(NO_DAMAGE_YET);
  let damage = p.damage;
  const rollIds: string[] = [];
  for (const [i, part] of plan.parts.entries()) {
    const total = keptSum(part.dice) + part.row.constant;
    const next: Roll = {
      ...part.row,
      id: ids[i] ?? env.ctx.ids.next(),
      at: env.ctx.clock.iso(),
      rollerRole: env.actor.role === "player" ? "player" : "dm",
      rollerPlayerId: env.actor.role === "player" ? env.actor.playerId : null,
      dice: part.dice,
      total,
      replacesRollId: part.row.id,
    };
    env.tx.insert(roll).values(next).run();
    rollIds.push(next.id);
    const patch = {
      rollId: next.id,
      dice: part.dice.map((d) => [d.value, d.kept] as [number | null, boolean]),
      maxed: [...part.indices].sort((a, b) => a - b),
    };
    const at = part.part;
    if (at === "base") {
      // The card total keeps its mods (FR-MOD-16): old total − old row + new row.
      damage = { ...damage, ...patch, total: damage.total - part.row.total + total };
    } else if (damage.extra) {
      const extra = damage.extra.map((x, i) => (i === at ? { ...x, ...patch, total } : x));
      damage = { ...damage, extra };
    }
  }
  const payload: DamageCardPayload = { ...p, damage, diceMaxed: true };
  const change = updateNotification(
    env,
    plan.card.id,
    { text: damageCardText(payload), payload: fitCardPayload(payload) },
    { emit: false },
  );
  return { rollIds, change };
}

/** FR-CBT-128: `cards.maxDice(env, cardId, picks, known?)`, plan + write in one call. */
export function maxDice(
  env: CommandEnv,
  cardId: string,
  picks: readonly CardDiePick[],
  known?: readonly CardKnownDice[],
): { rollIds: string[]; change: RecordChange } {
  return applyMaxDice(env, planMaxDice(env, cardId, picks, known));
}

export const cards = {
  findToHitCard,
  toHitBlock,
  replaceToHit,
  cardLineItems,
  planMaxDice,
  applyMaxDice,
  maxDice,
} as const;
