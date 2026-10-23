// party-loot (LOOT): intents `loot.add`, `loot.edit`, `loot.move`, `loot.split` (FR-PARTY-26);
// record types `loot-entry`, `party-pot`, `wallet`; internal helper `partyLoot.add` (FR-LOOT-03)
// for later features. *(S9)* derived `stores-coin` (FR-LOOT-31).
import type { Feature } from "../../services";
import { add, lootAdd, lootEdit, lootMove, lootSplit } from "./commands";
import { lootEntryType, partyPotType, storesCoinType, walletType } from "./records";

/** `partyLoot.add(env, input) → {entryId}`, in the caller's transaction (FR-LOOT-03). */
export const partyLoot = { add } as const;

export const partyLootFeature: Feature = {
  name: "party-loot",
  register(r) {
    r.command(lootAdd, { intent: true });
    r.command(lootEdit, { intent: true });
    r.command(lootMove, { intent: true });
    r.command(lootSplit, { intent: true });
    r.recordType(lootEntryType);
    r.recordType(partyPotType);
    r.recordType(walletType);
    r.recordType(storesCoinType);
  },
};
