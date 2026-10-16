// Rule-trigger intents and results (MOD §9, FR-MOD-45; protocol §34). Strict zod; none optimistic.
// DM; the owner player for their own character's triggers while the sheet is unlocked.
import { z } from "zod";
import { TRIGGER_NAME_MAX } from "./trigger-records";
import { TriggerRule } from "./triggers";

export const TRIGGER_INTENTS = {
  putTrigger: "mod.putTrigger",
  deleteTrigger: "mod.deleteTrigger",
} as const;

const Id = z.string().min(1).max(64);

// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the rule.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** The trigger's name = its part label (MOD §8.2): trimmed, 1–40, no control characters. */
export const TriggerName = z
  .string()
  .max(200)
  .refine((s) => !CONTROL.test(s), { message: "Name must not contain control characters" })
  .transform((s) => s.trim())
  .refine((s) => s.length >= 1, { message: "Name is required" })
  .refine((s) => [...s].length <= TRIGGER_NAME_MAX, {
    message: `Name must be at most ${TRIGGER_NAME_MAX} characters`,
  });

/**
 * A trigger as the DM or owner writes it (FR-MOD-32, -45). No `id` → create; with `id` →
 * replace (same owner). Exactly one of `characterId` / `definitionId`. `enabled` absent = on;
 * `public` absent = on for a character, off for a definition (OQ-MOD-26).
 */
export const TriggerInput = z
  .strictObject({
    id: Id.optional(),
    characterId: Id.nullable().default(null),
    definitionId: Id.nullable().default(null),
    name: TriggerName,
    enabled: z.boolean().default(true),
    public: z.boolean().optional(),
    rule: TriggerRule,
  })
  .superRefine((v, ctx) => {
    if ((v.characterId === null) === (v.definitionId === null)) {
      ctx.addIssue({
        code: "custom",
        path: ["characterId"],
        message: "A character or a monster definition",
      });
    }
  });
export type TriggerInput = z.input<typeof TriggerInput>;

export const PutTriggerInput = z.strictObject({ trigger: TriggerInput });
export type PutTriggerInput = z.input<typeof PutTriggerInput>;
export const PutTriggerResult = z.object({ triggerId: z.string() });
export type PutTriggerResult = z.infer<typeof PutTriggerResult>;

export const DeleteTriggerInput = z.strictObject({ triggerId: Id });
export type DeleteTriggerInput = z.input<typeof DeleteTriggerInput>;
