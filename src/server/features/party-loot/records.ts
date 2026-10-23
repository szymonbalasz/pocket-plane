// Record types `loot-entry` (windowed, FR-LOOT-11), `party-pot` and `wallet` (derived,
// FR-LOOT-09). All campaign scope; DM full, player full for their own campaign (FR-LOOT-10).
// *(S9)* `loot-entry` is redacted for players (no `seq`, hidden Stores ends → `outside`, rows of
// DM-only Stores items hidden; FR-LOOT-32, -36) and derived `stores-coin` joins (FR-LOOT-31).
import {
  LOOT_ENTRY_TYPE,
  LOOT_WINDOW,
  LootEntryRecord,
  PARTY_POT_TYPE,
  PartyPotRecord,
  STORES_COIN_TYPE,
  StoresCoinRecord,
  WALLET_TYPE,
  WalletRecord,
} from "@shared/party-loot/schemas";
import {
  lootEntryVisibility,
  redactLootEntry,
  storesCoinVisibility,
} from "@shared/party-loot/visibility";
import { defineRecordType, type Visibility } from "../../ws/records";
import { listEntries, partyPot, storesCoins, wallets } from "./rows";

/** FR-LOOT-10: no DM-only field; the scope gate keeps other campaigns out. */
export const lootVisibility = (): Visibility => "full";

export const lootEntryType = defineRecordType<LootEntryRecord>({
  type: LOOT_ENTRY_TYPE,
  scope: "campaign",
  schema: LootEntryRecord,
  idOf: (r) => r.id,
  campaignOf: (r) => r.campaignId,
  visibility: (r, v) => lootEntryVisibility(r, v),
  redact: (r) => redactLootEntry(r),
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

/** *(S9)* FR-LOOT-31: in the snapshot (≤ 8 rows, not windowed); players hidden while `hidden`. */
export const storesCoinType = defineRecordType<StoresCoinRecord>({
  type: STORES_COIN_TYPE,
  scope: "campaign",
  derived: true,
  schema: StoresCoinRecord,
  idOf: (r) => r.id,
  campaignOf: (r) => r.campaignId,
  visibility: (r, v) => storesCoinVisibility(r, v),
  snapshot: ({ db }, v) => storesCoins(db, v.campaignId),
});
