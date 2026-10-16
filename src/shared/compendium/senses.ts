// Creature core `senses` (FR-CHARX-49 / -53) as compendium's adapter fills it (FR-CMP-05, seams S6).
// TODO (C1): V0 (fix/vision-core) adds the real zod to `@shared/entities/schemas`; switch to it.
// Field names and bounds mirror the spec: ints 0–120 step 5, bools; absent = 0, 0, false, false.
import { z } from "zod";

export const SENSES_FT_MAX = 120;

const feet = z
  .number()
  .int()
  .min(0)
  .max(SENSES_FT_MAX)
  .refine((n) => n % 5 === 0, { message: "Senses: multiple of 5 ft" });

export const CreatureSenses = z.strictObject({
  visionFt: feet,
  darkvisionFt: feet,
  seesMagicalDarkness: z.boolean(),
  seesInvisible: z.boolean().optional(),
});
export type CreatureSenses = z.infer<typeof CreatureSenses>;
