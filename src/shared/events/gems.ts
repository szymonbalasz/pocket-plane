// Domain events of gems (GEM §9). Logged, not undoable (OQ-GEM-09 A: the DM corrects with ±).
import { GemKind } from "@shared/gems/schemas";
import { z } from "zod";
import { defineEvent } from "./types";

/** FR-GEM-07: count + (award only, FR-GEM-09) the `gem.award` line. */
export const GemsAdjusted = defineEvent({
  type: "GemsAdjusted",
  payload: z
    .object({
      characterId: z.string(),
      gem: GemKind,
      delta: z.int(),
      held: z.int(),
      entryId: z.string().optional(),
    })
    .strict(),
  logged: true,
  undoable: false,
});

/**
 * FR-GEM-12: count − cost + the `gem.spend` line. The reroll (`rerollEntryId`,
 * `supersededEntryId`) and Combat gem (`cardId`) fields come with those spends.
 */
export const GemSpent = defineEvent({
  type: "GemSpent",
  payload: z
    .object({
      characterId: z.string(),
      gem: GemKind,
      cost: z.int().min(1),
      held: z.int(),
      entryId: z.string(),
      rerollEntryId: z.string().optional(),
      supersededEntryId: z.string().optional(),
      cardId: z.string().optional(),
      rollIds: z.array(z.string()),
    })
    .strict(),
  logged: true,
  undoable: false,
});
