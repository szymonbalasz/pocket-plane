// party-loot (LOOT): intents `loot.add`, `loot.edit`, `loot.move`; record types `loot-entry`,
// `party-pot`, `wallet`; internal helper `partyLoot.add` (FR-LOOT-03) for later features.
import type { Feature } from "../../services";
import { add, lootAdd, lootEdit, lootMove } from "./commands";
import { lootEntryType, partyPotType, walletType } from "./records";

/** `partyLoot.add(env, input) → {entryId}`, in the caller's transaction (FR-LOOT-03). */
export const partyLoot = { add } as const;

export const partyLootFeature: Feature = {
  name: "party-loot",
  register(r) {
    r.command(lootAdd, { intent: true });
    r.command(lootEdit, { intent: true });
    r.command(lootMove, { intent: true });
    r.recordType(lootEntryType);
    r.recordType(partyPotType);
    r.recordType(walletType);
  },
};
