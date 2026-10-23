// party-loot's add helper for item rows (FR-PARTY-25; PARTY slices by assignment, seams S8): one
// `loot_entry` of kind `item` (`text` = item name, `qty`, coins 0) in the caller's transaction.
// Pot and wallet sums are unaffected (coins 0). Callers: `party.addItem` / `removeItem` /
// `moveItem`, *(S9)* `hold.delete` (Stores items to the party, FR-LOOT-38).
import type { Endpoint, LootEntryRecord } from "@shared/party-loot/schemas";
import type { CommandEnv } from "../../commands/commands";
import { insertLootEntry } from "./rows";

export function insertItemEntry(
  env: CommandEnv,
  campaignId: string,
  from: Endpoint,
  to: Endpoint,
  name: string,
  qty: number,
  /** *(S9)* FR-LOOT-36: the row adds / removes a DM-only Stores item (`world ↔ stores`). */
  itemHidden = false,
): LootEntryRecord {
  return insertLootEntry(env, campaignId, { kind: "item", from, to, text: name, qty, itemHidden });
}
