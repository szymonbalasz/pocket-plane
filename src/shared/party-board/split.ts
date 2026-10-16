// Pure split math (FR-PARTY-26, OQ-PARTY-06): ⌊coin / n⌋ per denomination, the remainder stays
// in the pot; no conversion.
import { COINS, type Coins, hasCoins, ZERO_COINS } from "@shared/party-loot/schemas";

export interface SplitResult {
  /** Each character's share. */
  share: Coins;
  /** What stays in the pot. */
  remainder: Coins;
}

/** Splits `coins` between `n` characters; `null` when `n` isn't a positive integer (no one ticked). */
export function splitCoins(coins: Coins, n: number): SplitResult | null {
  if (!Number.isInteger(n) || n < 1) return null;
  const share = { ...ZERO_COINS };
  const remainder = { ...ZERO_COINS };
  for (const k of COINS) {
    share[k] = Math.floor(coins[k] / n);
    remainder[k] = coins[k] - share[k] * n;
  }
  return { share, remainder };
}

/** FR-PARTY-26: "Nothing to split" when no one is chosen or every share is 0. */
export function nothingToSplit(coins: Coins, n: number): boolean {
  const r = splitCoins(coins, n);
  return r === null || !hasCoins(r.share);
}
