import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { addItem } from "@server/features/party-board/commands";
import { moveItem } from "@server/features/party-board/item-commands";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import { PARTY_ITEM_TYPE } from "@shared/party-board/schemas";

/** Party row index in this fixture (creation order). */
export const PARTY_ITEMS_1 = { potion: 0, torch: 1, rope: 2 } as const;

/**
 * PARTY §13 `party-items-1` (patch, seams S10): Potion of healing ×2, Torch ×10, Rope (50 ft) ×1
 * (3 `loot-received`), then Torch ×2 party → Thorn via `party.moveItem` (appends one row to
 * Thorn's `items`; no other sheet field). 4 item log rows.
 */
export default defineFixture({
  key: "party-items-1",
  kind: "setup",
  requires: ["char-mira-full", "char-thorn", "loot-wallets"],
  ownerSpec: "party-board",
  steps: [
    step(addItem, { name: "Potion of healing", qty: 2, notes: "" }),
    step(addItem, { name: "Torch", qty: 10, notes: "" }),
    step(addItem, { name: "Rope (50 ft)", qty: 1, notes: "" }),
    step(moveItem, (r) => ({
      from: { kind: "party" as const },
      to: { kind: "character" as const, characterId: r.id("char-thorn", ENTITY_TYPE) },
      qty: 2,
      itemId: r.id("party-items-1", PARTY_ITEM_TYPE, PARTY_ITEMS_1.torch),
    })),
  ],
});
