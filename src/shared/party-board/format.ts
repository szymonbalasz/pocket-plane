// Pure party-board texts shared by the server and both clients (PARTY §8 derived values):
// notification texts, share labels, item-row text, split preview.
import { TEXT_MAX } from "@shared/notifications/schemas";
import { formatCoins } from "@shared/party-loot/format";
import type { WireEndpoint } from "@shared/party-loot/schemas";
import type { RedactedSharedWith, SharedWith } from "./schemas";
import type { SplitResult } from "./split";

const cut = (s: string) => (s.length > TEXT_MAX ? `${s.slice(0, TEXT_MAX - 1)}…` : s);

/** FR-PARTY-06: "New handout: ‹title›", cut to 280. */
export const handoutSharedText = (title: string) => cut(`New handout: ${title}`);

/**
 * FR-PARTY-19, FR-PARTY-49 (BL-48: an item said "Party loot:"): "Party inventory: ‹name› ×‹qty›",
 * cut to 280. Coin and loot entries keep FR-LOOT-13's "Party loot: …".
 */
export const itemAddedText = (name: string, qty: number) => cut(`Party inventory: ${name} ×${qty}`);

/**
 * FR-PARTY-25 end label: "Party", "Outside the party", or the character's name. *(S9)* A Stores
 * end: "‹Stronghold› Stores" when named, else "Stores (removed)" (FR-LOOT-35); a redacted
 * `outside` end reads "Outside the party" (FR-LOOT-32).
 */
export function endLabel(
  end: WireEndpoint,
  characterName: (id: string) => string,
  strongholdName: (id: string) => string | undefined = () => undefined,
): string {
  if (end.kind === "party") return "Party";
  if (end.kind === "world" || end.kind === "outside") return "Outside the party";
  if (end.kind === "stores") return storesLabel(strongholdName(end.strongholdId));
  return characterName(end.characterId);
}

/** *(S9)* FR-LOOT-35: "‹Stronghold› Stores"; an id without an index row → "Stores (removed)". */
export const storesLabel = (name: string | undefined) =>
  name === undefined ? "Stores (removed)" : `${name} Stores`;

/** FR-PARTY-25 `loot.log` item row: "‹from› → ‹to›: ‹name› ×‹qty›". */
export function itemRowText(
  entry: { from: WireEndpoint; to: WireEndpoint; text: string; qty: number },
  characterName: (id: string) => string,
): string {
  const from = endLabel(entry.from, characterName);
  const to = endLabel(entry.to, characterName);
  return `${from} → ${to}: ${entry.text} ×${entry.qty}`;
}

/** FR-PARTY-12 DM share Badge: "Not shared" / "Everyone" / player names (unknown ids skipped). */
export function dmShareLabel(s: SharedWith, playerName: (id: string) => string | undefined) {
  if (s.mode === "none") return "Not shared";
  if (s.mode === "all") return "Everyone";
  return s.playerIds
    .map(playerName)
    .filter((n): n is string => n !== undefined)
    .join(", ");
}

/** FR-PARTY-13 player row label: "Everyone" / "Shared with you" (no other names, OQ-PARTY-10). */
export const playerShareLabel = (s: RedactedSharedWith) =>
  s.mode === "all" ? "Everyone" : "Shared with you";

/** FR-PARTY-27 preview: "Each gets ‹coins›; ‹coins› stays in the pot" (no remainder → no tail). */
export function splitPreview(r: SplitResult): string {
  const each = `Each gets ${formatCoins(r.share)}`;
  const rest = formatCoins(r.remainder);
  return rest ? `${each}; ${rest} stays in the pot` : each;
}
