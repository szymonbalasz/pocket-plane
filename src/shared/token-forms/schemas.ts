// Token forms (FORM §8, §9; ADR-0081): a character's named alternate token images. One schema for
// the server, fixtures and both clients.
import { z } from "zod";

export const FORM_INTENTS = {
  put: "forms.put",
  choose: "forms.choose",
} as const;

/** FR-FORM-01: at most 6 forms per character; names 1–24 characters. */
export const FORMS_MAX = 6;
export const FORM_NAME_MAX = 24;

const Id = z.string().min(1);

/** One stored form (JSON leaf `entity.token_forms`). */
export const TokenForm = z.strictObject({
  id: Id,
  name: z.string().min(1).max(FORM_NAME_MAX),
  imageAssetId: Id,
});
export type TokenForm = z.infer<typeof TokenForm>;

/** Trimmed, no control characters, 1–24. */
const FormName = z
  .string()
  .transform((s) => s.trim())
  .pipe(
    z
      .string()
      .min(1, "Name the form")
      .max(FORM_NAME_MAX, `At most ${FORM_NAME_MAX} characters`)
      // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
      .refine((s) => !/[\u0000-\u001f\u007f]/.test(s), "No control characters"),
  );

/** FR-FORM-02: a form as sent; no `id` = a new form. */
export const TokenFormInput = z.strictObject({
  id: Id.optional(),
  name: FormName,
  imageAssetId: Id,
});
export type TokenFormInput = z.infer<typeof TokenFormInput>;

export const PutFormsInput = z
  .strictObject({
    characterId: Id,
    forms: z.array(TokenFormInput).max(FORMS_MAX, `Up to ${FORMS_MAX} forms`),
  })
  .superRefine((v, c) => {
    const seen = new Set<string>();
    v.forms.forEach((f, i) => {
      const k = f.name.toLowerCase();
      if (seen.has(k))
        c.addIssue({
          code: "custom",
          path: ["forms", i, "name"],
          message: "Each form needs its own name",
        });
      seen.add(k);
    });
    const ids = v.forms.flatMap((f) => (f.id ? [f.id] : []));
    if (new Set(ids).size !== ids.length)
      c.addIssue({ code: "custom", path: ["forms"], message: "A form is listed twice" });
  });
export type PutFormsInput = z.infer<typeof PutFormsInput>;

export const ChooseFormInput = z.strictObject({ characterId: Id, formId: Id.nullable() });
export type ChooseFormInput = z.infer<typeof ChooseFormInput>;
