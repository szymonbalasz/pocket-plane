import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { addItem } from "@server/features/party-board/commands";
import { lootAdd, lootMove } from "@server/features/party-loot/commands";
import { ENTITY_TYPE } from "@shared/entities/schemas";

/**
 * RECAP §13 `recap-loot-haul` (`sp-s9` only, not session-sim-13: it changes the party pot;
 * review-a ruling 20), in the fixture session (the load clock):
 * - "Bandit Camp strongbox" +40 gp 25 sp (world → party); "Healer's fee" −5 gp (a spend);
 * - `party.addItem` "Bandit captain's map" ×1 (world → party);
 * - Thorn's own "Silver ring" 15 gp (world → Thorn).
 *
 * The `sp-s9` recap (one fixture session, key `fromN` 1), DM | players. The facts come from
 * session-sim-12's units (`st-past-crypt`, `sb-past-bandits` via `stats-b-past`, `sb-luck-rolls`,
 * the running ambush):
 * - Fights (oldest first): "Old Crypt" | "Fight 1 · ‹load date›": kills Skeleton, Skeleton 2
 *   (Thorn), down Mira; "Bandit Camp" | "Fight 2": kills Bandit (Mira) | same, + the hidden
 *   Bandit Captain (Thorn, eye-off) | —; down Thorn (Bandit 2); Still standing Bandit 2, Bandit 3
 *   (DM). "Ambush at the Ford" | "Fight 3": running; a hidden DM kill on the Goblin | nothing.
 * - Party (by Dealt): Thorn 63 | 43 dealt, kills 3 | 2, downed 1; Mira 25, kills 1, downed 1.
 * - Notable rolls: 6 | 4 (the DM adds Thorn's hidden nat 20, marked, and the DM's "Bandit"
 *   nat 20; players never see either).
 * - Loot (same for all, 13 rows): loot-1's 5 rows, loot-wallets' "Rope" (Mira → world, −1 gp),
 *   party-items-1's 3 items, then these 4. Totals +109 gp 55 sp 5 pp; Potion of healing ×2,
 *   Torch ×10, Rope (50 ft) ×1, Bandit captain's map ×1. Moves (pot ↔ wallets, Torch → Thorn)
 *   are left out.
 */
export default defineFixture({
  key: "recap-loot-haul",
  kind: "setup",
  requires: ["loot-1", "char-mira", "char-thorn"],
  ownerSpec: "session-recap",
  steps: [
    step(lootAdd, { text: "Bandit Camp strongbox", gp: 40, sp: 25 }),
    step(lootAdd, { text: "Healer's fee", gp: -5 }),
    step(addItem, { name: "Bandit captain's map", qty: 1, notes: "" }),
    step(lootMove, (r) => ({
      from: { kind: "world" as const },
      to: { kind: "character" as const, characterId: r.id("char-thorn", ENTITY_TYPE) },
      gp: 15,
      text: "Silver ring",
    })),
  ],
});
