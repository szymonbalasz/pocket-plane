// party-loot boundary schemas (LOOT §6, §8, §9). zod is the source of truth; the clients mirror
// the intent rules with these same schemas (FR-LOOT-16, FR-LOOT-18).
import { Endpoint, LootEntryKind, WireEndpoint } from "@shared/events/party-loot";
import { cleanText } from "@shared/notifications/schemas";
import { z } from "zod";

export { Endpoint, LootEntryKind, WireEndpoint };

export const LOOT_ENTRY_TYPE = "loot-entry";
export const PARTY_POT_TYPE = "party-pot";
export const WALLET_TYPE = "wallet";
/** *(S9)* Derived per-stronghold Stores balance (FR-LOOT-31). */
export const STORES_COIN_TYPE = "stores-coin";
/** FR-LOOT-11: snapshot window (newest entries by `seq`). */
export const LOOT_WINDOW = 100;
export const LOOT_TEXT_MAX = 200;
export const MOVE_TEXT_MAX = 100;
export const COIN_MAX = 999_999;

/** Storage / intent order. */
export const COINS = ["cp", "sp", "ep", "gp", "pp"] as const;
/** Display order (FR-LOOT-12, FR-LOOT-15). */
export const COINS_DISPLAY = ["pp", "gp", "ep", "sp", "cp"] as const;
export type CoinKey = (typeof COINS)[number];
export type Coins = Record<CoinKey, number>;

export const ZERO_COINS: Coins = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };

const Id = z.string().min(1).max(64);

/** FR-LOOT-02 / FR-LOOT-06 text: control characters removed, trimmed, then the length limit. */
const cleanedText = (max: number) =>
  z
    .string()
    .max(4 * max)
    .transform(cleanText)
    .pipe(z.string().max(max, `Text: at most ${max} characters`));

export const LootText = cleanedText(LOOT_TEXT_MAX);
export const MoveText = cleanedText(MOVE_TEXT_MAX);

/** FR-LOOT-02: signed integer, ±999 999. */
export const LootCoin = z.int().min(-COIN_MAX).max(COIN_MAX);
/** FR-LOOT-06: non-negative integer, ≤ 999 999. */
export const MoveCoin = z.int().min(0).max(COIN_MAX);
/** FR-LOOT-09: derived balances are unbounded signed safe integers. */
const Balance = z.int();

export const hasCoins = (c: Coins): boolean => COINS.some((k) => c[k] !== 0);

const NEEDS_SOMETHING = "Enter text or a non-zero coin";

/** `loot.add` (DM, FR-LOOT-03): every field optional; text or a non-zero coin. */
export const LootAddIntent = z
  .strictObject({
    text: LootText.default(""),
    cp: LootCoin.default(0),
    sp: LootCoin.default(0),
    ep: LootCoin.default(0),
    gp: LootCoin.default(0),
    pp: LootCoin.default(0),
  })
  .refine((v) => v.text !== "" || hasCoins(v), { message: NEEDS_SOMETHING });
export type LootAddIntent = z.input<typeof LootAddIntent>;
export type LootInput = z.output<typeof LootAddIntent>;

/** `loot.edit` (DM, FR-LOOT-04): a full replacement, every field required. */
export const LootEditIntent = z
  .strictObject({
    entryId: Id,
    text: LootText,
    cp: LootCoin,
    sp: LootCoin,
    ep: LootCoin,
    gp: LootCoin,
    pp: LootCoin,
  })
  .refine((v) => v.text !== "" || hasCoins(v), { message: NEEDS_SOMETHING });
export type LootEditIntent = z.input<typeof LootEditIntent>;

export function sameEndpoint(a: Endpoint, b: Endpoint): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "character") return a.characterId === (b as typeof a).characterId;
  if (a.kind === "stores") return a.strongholdId === (b as typeof a).strongholdId;
  return true;
}

const WORLD_PAIRS: readonly Endpoint["kind"][] = ["character", "stores"];
const WORLD_PAIRING = "Outside the party pairs with a character or Stores";

/**
 * FR-LOOT-06 pairing: `from ≠ to`; `world` only with a `character` *(S9: or a `stores`, FR-LOOT-30)*
 * at the other end.
 */
export function pairingError(from: Endpoint, to: Endpoint): string | null {
  if (sameEndpoint(from, to)) return "From and To must differ";
  if (from.kind === "world" && !WORLD_PAIRS.includes(to.kind)) return WORLD_PAIRING;
  if (to.kind === "world" && !WORLD_PAIRS.includes(from.kind)) return WORLD_PAIRING;
  return null;
}

/**
 * FR-LOOT-07 player moves: own character → party / another character, or party → own. *(S9)*
 * FR-LOOT-33 (OQ-LOOT-21 A): with a visible Stores (checked by the server), Stores ↔ party,
 * Stores → own character, own character → Stores. `owns` = an own character end at commit.
 */
export function playerMayMove(from: Endpoint, to: Endpoint, owns: (e: Endpoint) => boolean) {
  if (owns(from)) return to.kind === "party" || to.kind === "character" || to.kind === "stores";
  if (from.kind === "party") return owns(to) || to.kind === "stores";
  if (from.kind === "stores") return to.kind === "party" || owns(to);
  return false;
}

/** `loot.move` (DM, player; FR-LOOT-06). */
export const LootMoveIntent = z
  .strictObject({
    from: Endpoint,
    to: Endpoint,
    cp: MoveCoin.default(0),
    sp: MoveCoin.default(0),
    ep: MoveCoin.default(0),
    gp: MoveCoin.default(0),
    pp: MoveCoin.default(0),
    text: MoveText.default(""),
  })
  .superRefine((v, ctx) => {
    if (!hasCoins(v)) ctx.addIssue({ code: "custom", message: "Move at least one coin" });
    const err = pairingError(v.from, v.to);
    if (err) ctx.addIssue({ code: "custom", message: err, path: ["to"] });
  });
export type LootMoveIntent = z.input<typeof LootMoveIntent>;

export const LootResult = z.strictObject({ entryId: z.string() });
export type LootResult = z.infer<typeof LootResult>;

const entryFields = {
  id: z.string(),
  campaignId: z.string(),
  kind: LootEntryKind,
  from: WireEndpoint,
  to: WireEndpoint,
  text: z.string(),
  cp: z.int(),
  sp: z.int(),
  ep: z.int(),
  gp: z.int(),
  pp: z.int(),
  qty: z.int().min(1).max(9_999).optional(),
  /** *(S9)* Strictly increasing per campaign for new entries: players' order, then id (FR-LOOT-32). */
  createdAt: z.string(),
  editedAt: z.string().nullable(),
};

/**
 * Wire record `loot-entry` (FR-LOOT-01, LOOT §8), DM view. Kind `item` (FR-PARTY-25): `text` =
 * item name, `qty` 1–9 999, coins 0; `qty` is on the wire only when set. *(S9)* Ends may be
 * `stores` (FR-LOOT-30); DM-only copies `storesHidden` (FR-LOOT-32) and `itemHidden` (FR-LOOT-36),
 * on the wire only when true. The DM's ends are never `outside`.
 */
export const LootEntryRecord = z.strictObject({
  ...entryFields,
  seq: z.int(),
  storesHidden: z.literal(true).optional(),
  itemHidden: z.literal(true).optional(),
});
export type LootEntryRecord = z.infer<typeof LootEntryRecord>;

/**
 * *(S9)* `loot-entry`, player view (FR-LOOT-32, review rulings 3b, 7): no `seq`, no DM keys; a
 * DM-only Stores end reads `{kind: outside}`.
 */
export const PlayerLootEntryRecord = z.strictObject(entryFields);
export type PlayerLootEntryRecord = z.infer<typeof PlayerLootEntryRecord>;

/** Derived `party-pot` (FR-LOOT-09): id = campaignId. */
export const PartyPotRecord = z.strictObject({
  id: z.string(),
  campaignId: z.string(),
  cp: Balance,
  sp: Balance,
  ep: Balance,
  gp: Balance,
  pp: Balance,
});
export type PartyPotRecord = z.infer<typeof PartyPotRecord>;

/** Derived `wallet` (FR-LOOT-09): id = characterId. */
export const WalletRecord = z.strictObject({
  id: z.string(),
  campaignId: z.string(),
  characterId: z.string(),
  cp: Balance,
  sp: Balance,
  ep: Balance,
  gp: Balance,
  pp: Balance,
});
export type WalletRecord = z.infer<typeof WalletRecord>;

/**
 * *(S9)* Derived `stores-coin` (FR-LOOT-31): id = strongholdId; `hidden` (DM-only key, on the wire
 * only when true) = the stronghold's `dmOnly` when built.
 */
export const StoresCoinRecord = z.strictObject({
  id: z.string(),
  campaignId: z.string(),
  strongholdId: z.string(),
  cp: Balance,
  sp: Balance,
  ep: Balance,
  gp: Balance,
  pp: Balance,
  hidden: z.literal(true).optional(),
});
export type StoresCoinRecord = z.infer<typeof StoresCoinRecord>;

/** Notification kind `loot-received` (FR-LOOT-13). */
export const LOOT_RECEIVED_KIND = "loot-received";
export const LootReceivedPayload = z.strictObject({ entryId: z.string() });
export type LootReceivedPayload = z.infer<typeof LootReceivedPayload>;

export function coinsOf(r: Coins): Coins {
  return { cp: r.cp, sp: r.sp, ep: r.ep, gp: r.gp, pp: r.pp };
}
