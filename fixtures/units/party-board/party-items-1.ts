import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { addItem } from "@server/features/party-board/commands";

/**
 * PARTY §13 `party-items-1` (patch: party rows + their loot log rows only): Potion of healing
 * ×2, Torch ×10, Rope (50 ft) ×1; 3 `loot-received`. The Torch ×2 move party → Thorn joins in
 * P4 with `party.moveItem` (orchestrator ruling for P core); no sheet is touched yet.
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
  ],
});
