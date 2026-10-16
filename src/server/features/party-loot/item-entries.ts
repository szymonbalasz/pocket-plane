// party-loot's add helper for item rows (FR-PARTY-25; PARTY slices by assignment, seams S8): one
// `loot_entry` of kind `item` (`text` = item name, `qty`, coins 0) in the caller's transaction.
// Pot and wallet sums are unaffected (coins 0). Callers: `party.addItem` / `removeItem` /
// `moveItem`.
import { type Endpoint, type LootEntryRecord, ZERO_COINS } from "@shared/party-loot/schemas";
import type { CommandEnv } from "../../commands/commands";
import { lootEntry, lootEntrySeqNext } from "../../db/schema";
import { endpointColumns, getEntry } from "./rows";

export function insertItemEntry(
  env: CommandEnv,
  campaignId: string,
  from: Endpoint,
  to: Endpoint,
  name: string,
  qty: number,
): LootEntryRecord {
  const id = env.ctx.ids.next();
  const f = endpointColumns(from);
  const t = endpointColumns(to);
  env.tx
    .insert(lootEntry)
    .values({
      id,
      campaignId,
      seq: lootEntrySeqNext,
      kind: "item",
      fromKind: f.kind,
      fromCharacterId: f.characterId,
      toKind: t.kind,
      toCharacterId: t.characterId,
      text: name,
      ...ZERO_COINS,
      qty,
      createdAt: env.ctx.clock.iso(),
      editedAt: null,
    })
    .run();
  return getEntry(env.tx, campaignId, id) as LootEntryRecord;
}
