import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { lootAdd, lootEdit } from "@server/features/party-loot/commands";
import { LOOT_ENTRY_TYPE } from "@shared/party-loot/schemas";

/**
 * LOOT §13: e1 "Goblin chief's pouch" 12 gp 30 sp; e2 "Potion of healing ×2"; e3 "Silver idol"
 * 500 gp, then edited to 50 gp; e4 coins only 5 pp; e5 "Paid the ferryman" −2 gp (a spend).
 * Pot: 5 pp, 60 gp, 30 sp. Side effects: 4 `loot-received` notifications (e1–e4); e3's still
 * says 500 gp.
 */
export default defineFixture({
  key: "loot-1",
  kind: "setup",
  requires: ["campaign"],
  ownerSpec: "party-loot",
  steps: [
    step(lootAdd, { text: "Goblin chief's pouch", gp: 12, sp: 30 }),
    step(lootAdd, { text: "Potion of healing ×2" }),
    step(lootAdd, { text: "Silver idol", gp: 500 }),
    step(lootAdd, { pp: 5 }),
    step(lootAdd, { text: "Paid the ferryman", gp: -2 }),
    step(lootEdit, (r) => ({
      entryId: r.id("loot-1", LOOT_ENTRY_TYPE, 2),
      text: "Silver idol",
      cp: 0,
      sp: 0,
      ep: 0,
      gp: 50,
      pp: 0,
    })),
  ],
});
