// gems (GEM, homebrew #140; optional per campaign, off by default, #312 / ADR-0058): record type
// `character-gems`, intents `gem.adjust` (DM) and `gem.spend` (owner or DM). Log kinds `gem.award`
// / `gem.spend` are in `@shared/dice-roll-log/kinds.ts`.
import type { Feature } from "../../services";
import { adjustGems, spendGem } from "./commands";
import { characterGemsType } from "./records";

export const gems: Feature = {
  name: "gems",
  register(r) {
    r.command(adjustGems, { intent: true });
    r.command(spendGem, { intent: true });
    r.recordType(characterGemsType);
  },
};
