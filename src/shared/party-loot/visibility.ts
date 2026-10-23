// *(S9)* Pure ledger visibility (FR-LOOT-31, -32, -36; ADR-0066): reads record + viewer only, so the
// record-type registry, the leak tests and the clients share one rule. Before sprint 9 every row
// was full for the campaign (FR-LOOT-10); DM-only Stores and DM-only Stores items change that.
import type { PartyItemRecord } from "@shared/party-board/schemas";
import type {
  LootEntryRecord,
  PlayerLootEntryRecord,
  StoresCoinRecord,
  WireEndpoint,
} from "./schemas";

export type LedgerVisibility = "full" | "redacted" | "hidden";

/** Structural slice of the connection's viewer. */
export interface LedgerViewer {
  role: "dm" | "player";
}

/** FR-LOOT-32: a hidden Stores end reads `outside` for players (never `world`, review ruling 3b). */
function playerEnd(e: WireEndpoint, storesHidden: boolean): WireEndpoint {
  return storesHidden && e.kind === "stores" ? { kind: "outside" } : e;
}

const offParty = (e: WireEndpoint) => e.kind === "world" || e.kind === "outside";

/**
 * FR-LOOT-32 / -36: DM full. A player: hidden if the entry adds / removes a DM-only Stores item
 * (`itemHidden`) or if, after the hidden Stores ends turn `outside`, no end is party-side; else
 * redacted (every player entry drops `seq`, review ruling 7).
 */
export function lootEntryVisibility(r: LootEntryRecord, v: LedgerViewer): LedgerVisibility {
  if (v.role === "dm") return "full";
  if (r.itemHidden) return "hidden";
  const hidden = r.storesHidden === true;
  if (offParty(playerEnd(r.from, hidden)) && offParty(playerEnd(r.to, hidden))) return "hidden";
  return "redacted";
}

/** FR-LOOT-32 player redaction: no `seq`, no DM keys, hidden Stores ends → `outside`. */
export function redactLootEntry(r: LootEntryRecord): PlayerLootEntryRecord {
  const { seq: _seq, storesHidden, itemHidden: _item, from, to, ...rest } = r;
  return {
    ...rest,
    from: playerEnd(from, storesHidden === true),
    to: playerEnd(to, storesHidden === true),
  };
}

/** FR-LOOT-31: DM full; a player hidden while the stronghold is DM-only, else full (no key left). */
export function storesCoinVisibility(r: StoresCoinRecord, v: LedgerViewer): LedgerVisibility {
  if (v.role === "dm") return "full";
  return r.hidden ? "hidden" : "full";
}

/**
 * FR-LOOT-32 / -36: DM full; a player never receives a row of a hidden Stores or a DM-only Stores
 * item; any other row in full (both keys are on the wire only when true).
 */
export function partyItemVisibility(r: PartyItemRecord, v: LedgerViewer): LedgerVisibility {
  if (v.role === "dm") return "full";
  return r.storesHidden || r.dmOnly ? "hidden" : "full";
}
