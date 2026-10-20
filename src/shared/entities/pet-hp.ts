// `pet.adjustHp` (sprint 6, FR-ENT-36): a pet's kept HP out of a fight, sent by the DM and the
// pet's owner (the Party Companions tab, the companion card). Boundary schema for both sides.
import { z } from "zod";

export const PET_ADJUST_HP = "pet.adjustHp";

/** FR-ENT-36: as `char.adjustHp`, integer −999…999, ≠ 0. */
export const PET_HP_DELTA_MAX = 999;

export const PetAdjustHpIntent = z.strictObject({
  petId: z.string().min(1).max(64),
  delta: z
    .int()
    .min(-PET_HP_DELTA_MAX)
    .max(PET_HP_DELTA_MAX)
    .refine((d) => d !== 0, "Amount must not be 0"),
});
export type PetAdjustHpIntent = z.infer<typeof PetAdjustHpIntent>;

export const PetAdjustHpResult = z.strictObject({ before: z.int(), after: z.int() });
export type PetAdjustHpResult = z.infer<typeof PetAdjustHpResult>;

/** FR-ENT-36: the pet is an active combatant; its HP lives on the combatant (FR-CBT-113). */
export const PET_HP_IN_FIGHT = "In a fight the DM applies damage";
