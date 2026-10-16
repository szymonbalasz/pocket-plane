import { setLook, setLookFor } from "@server/features/dice-extras/commands";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { type DiceLook, STYLE_LOOK } from "@shared/dice-extras/looks";

/** DICEX §13 `dicex-looks`: the DM's and player-1's stored looks; player-2 keeps the default. */
export const DICEX_LOOKS = {
  dm: { ...STYLE_LOOK.obsidian, material: "metal" },
  player1: { style: "crimson", body: "#8b1a1a", pips: "#ffffff", material: "metal" },
} satisfies Record<string, DiceLook>;

/**
 * DM: Obsidian, metal. player-1 (as player-1, via the loader's internal `dicex.setLookFor`):
 * Crimson, body `#8b1a1a`, pips `#ffffff`, metal. player-2: no row (default Sapphire). Writes
 * only `dice-look` rows (seams S10).
 */
export default defineFixture({
  key: "dicex-looks",
  kind: "setup",
  requires: ["player-1", "player-2"],
  ownerSpec: "dice-extras",
  steps: [
    step(setLook, DICEX_LOOKS.dm),
    step(setLookFor, (r) => ({ playerId: r.id("player-1", "player"), look: DICEX_LOOKS.player1 })),
  ],
});
