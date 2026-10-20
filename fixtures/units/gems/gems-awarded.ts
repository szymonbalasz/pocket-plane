import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { adjustGems } from "@server/features/gems/commands";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import type { GemAdjustInput, GemKind } from "@shared/gems/schemas";

/** GEM §13 counts: Fortune 6 shows a count above the "max 5" label (FR-GEM-08). */
export const GEMS_AWARDED: Record<"mira" | "brakka" | "thorn", Partial<Record<GemKind, number>>> = {
  mira: { inspiration: 2, combat: 1, fortune: 1 },
  brakka: { combat: 2, action: 3, divine: 1, fortune: 6 },
  thorn: { inspiration: 1 },
};

const FIXTURE: Record<keyof typeof GEMS_AWARDED, string> = {
  mira: "char-mira",
  brakka: "char-brakka",
  thorn: "char-thorn",
};

/** One `gem.adjust` per award (delta ≤ 5, FR-GEM-07), so each writes its public award line. */
const awards = (Object.keys(GEMS_AWARDED) as (keyof typeof GEMS_AWARDED)[]).flatMap((who) =>
  Object.entries(GEMS_AWARDED[who]).flatMap(([gem, n]) =>
    (n > 5 ? [5, n - 5] : [n]).map((delta) =>
      step(
        adjustGems,
        (r): GemAdjustInput => ({
          characterId: r.id(FIXTURE[who], ENTITY_TYPE),
          gem: gem as GemKind,
          delta,
        }),
      ),
    ),
  ),
);

/**
 * GEM §13 `gems-awarded`: Mira Inspiration 2, Combat 1, Fortune 1; Brakka Combat 2, Action 3,
 * Divine 1, Fortune 6 (5 + 1); Thorn Inspiration 1. DM awards (public lines). Gems must be on.
 */
export default defineFixture({
  key: "gems-awarded",
  kind: "setup",
  requires: ["gems-on", "char-mira", "char-brakka", "char-thorn"],
  ownerSpec: "gems",
  steps: awards,
});
