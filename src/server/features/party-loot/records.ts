// Record types `loot-entry` (windowed, FR-LOOT-11), `party-pot` and `wallet` (derived,
// FR-LOOT-09). All campaign scope; DM full, player full for their own campaign (FR-LOOT-10).
import {
  LOOT_ENTRY_TYPE,
  LOOT_WINDOW,
  LootEntryRecord,
  PARTY_POT_TYPE,
  PartyPotRecord,
  WALLET_TYPE,
  WalletRecord,
} from "@shared/party-loot/schemas";
import { defineRecordType, type Visibility } from "../../ws/records";
import { listEntries, partyPot, wallets } from "./rows";

/** FR-LOOT-10: no DM-only field; the scope gate keeps other campaigns out. */
export const lootVisibility = (): Visibility => "full";

export const lootEntryType = defineRecordType<LootEntryRecord>({
  type: LOOT_ENTRY_TYPE,
  scope: "campaign",
  schema: LootEntryRecord,
  idOf: (r) => r.id,
  campaignOf: (r) => r.campaignId,
  visibility: lootVisibility,
  // The whole log, oldest first; the registry cuts the newest 100 before the filter (ADR-0029).
  snapshot: ({ db }, v) => listEntries(db, v.campaignId),
  window: { orderBy: "seq", size: LOOT_WINDOW },
});

export const partyPotType = defineRecordType<PartyPotRecord>({
  type: PARTY_POT_TYPE,
  scope: "campaign",
  schema: PartyPotRecord,
  idOf: (r) => r.id,
  campaignOf: (r) => r.campaignId,
  visibility: lootVisibility,
  snapshot: ({ db }, v) => [partyPot(db, v.campaignId)],
});

export const walletType = defineRecordType<WalletRecord>({
  type: WALLET_TYPE,
  scope: "campaign",
  schema: WalletRecord,
  idOf: (r) => r.id,
  campaignOf: (r) => r.campaignId,
  visibility: lootVisibility,
  snapshot: ({ db }, v) => wallets(db, v.campaignId),
});
