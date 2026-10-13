// party-loot boundary schemas (LOOT §6, §8, §9). zod is the source of truth; the clients mirror
// the intent rules with these same schemas (FR-LOOT-16, FR-LOOT-18).
import { Endpoint } from "@shared/events/party-loot";
import { cleanText } from "@shared/notifications/schemas";
import { z } from "zod";

export { Endpoint };

export const LOOT_ENTRY_TYPE = "loot-entry";
export const PARTY_POT_TYPE = "party-pot";
export const WALLET_TYPE = "wallet";
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
  return a.kind !== "character" || a.characterId === (b as typeof a).characterId;
}

/** FR-LOOT-06 pairing: `from ≠ to`; `world` only with a `character` at the other end. */
export function pairingError(from: Endpoint, to: Endpoint): string | null {
  if (sameEndpoint(from, to)) return "From and To must differ";
  if (from.kind === "world" && to.kind !== "character")
    return "Outside the party pairs with a character";
  if (to.kind === "world" && from.kind !== "character")
    return "Outside the party pairs with a character";
  return null;
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

/** Wire record `loot-entry` (FR-LOOT-01, LOOT §8); no DM-only field (FR-LOOT-10). */
export const LootEntryRecord = z.strictObject({
  id: z.string(),
  campaignId: z.string(),
  seq: z.int(),
  kind: z.enum(["loot", "move"]),
  from: Endpoint,
  to: Endpoint,
  text: z.string(),
  cp: z.int(),
  sp: z.int(),
  ep: z.int(),
  gp: z.int(),
  pp: z.int(),
  createdAt: z.string(),
  editedAt: z.string().nullable(),
});
export type LootEntryRecord = z.infer<typeof LootEntryRecord>;

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

/** Notification kind `loot-received` (FR-LOOT-13). */
export const LOOT_RECEIVED_KIND = "loot-received";
export const LootReceivedPayload = z.strictObject({ entryId: z.string() });
export type LootReceivedPayload = z.infer<typeof LootReceivedPayload>;

export function coinsOf(r: Coins): Coins {
  return { cp: r.cp, sp: r.sp, ep: r.ep, gp: r.gp, pp: r.pp };
}
