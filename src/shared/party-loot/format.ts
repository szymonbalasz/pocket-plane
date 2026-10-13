// Pure party-loot rules shared by the server and both clients (FR-LOOT-12, FR-LOOT-13).
import { TEXT_MAX } from "@shared/notifications/schemas";
import { COINS, COINS_DISPLAY, type CoinKey, type Coins } from "./schemas";

/** U+2212, the display minus (FR-LOOT-12). */
export const MINUS = "−";

const signed = (n: number) => (n < 0 ? `${MINUS}${-n}` : String(n));

/** The non-zero coins in display order, e.g. `[{coin: "gp", value: 50}]`. */
export function nonZeroCoins(c: Coins): { coin: CoinKey; value: number }[] {
  return COINS_DISPLAY.filter((k) => c[k] !== 0).map((k) => ({ coin: k, value: c[k] }));
}

/** One coin, e.g. "50 gp" / "−2 gp". */
export const formatCoin = (coin: CoinKey, value: number) => `${signed(value)} ${coin}`;

/** FR-LOOT-12: "50 gp, 30 sp", negatives with "−"; all zero → "". */
export function formatCoins(c: Coins): string {
  return nonZeroCoins(c)
    .map((x) => formatCoin(x.coin, x.value))
    .join(", ");
}

/** FR-LOOT-12: pp×10 + gp + ep/2 + sp/10 + cp/100. Summed in cp so it stays exact. */
export function gpValue(c: Coins): number {
  const cp = c.pp * 1000 + c.gp * 100 + c.ep * 50 + c.sp * 10 + c.cp;
  return cp / 100;
}

/** The gp value to 2 decimals, "−" for negatives (FR-LOOT-15 Tooltip). */
export function formatGpValue(c: Coins): string {
  const v = gpValue(c);
  const s = Math.abs(v).toFixed(2);
  return v < 0 ? `${MINUS}${s}` : s;
}

/** FR-LOOT-03 / FR-LOOT-13: a loot entry notifies iff no coin is negative. */
export function notifiesLoot(c: Coins): boolean {
  return COINS.every((k) => c[k] >= 0);
}

/** FR-LOOT-13: "Party loot: ‹text› (‹coins›)" / "Party loot: ‹text›" / "Party loot: ‹coins›", ≤ 280. */
export function lootNotificationText(text: string, c: Coins): string {
  const coins = formatCoins(c);
  const body = text && coins ? `${text} (${coins})` : text || coins;
  const full = `Party loot: ${body}`;
  return full.length > TEXT_MAX ? `${full.slice(0, TEXT_MAX - 1)}…` : full;
}
