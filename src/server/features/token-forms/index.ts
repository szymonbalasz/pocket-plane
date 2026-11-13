// Token forms (FORM, ADR-0081). No record type of its own: forms ride the character (`entity`), the
// copy rides the token. The effect hook line lives in combat-extras' `effect-hooks.ts`.
import type { Feature } from "../../services";
import { chooseForm, putForms, putPresetWithForm } from "./commands";

export const tokenForms: Feature = {
  name: "token-forms",
  register(r) {
    r.command(putForms, { intent: true });
    r.command(chooseForm, { intent: true });
    r.command(putPresetWithForm);
  },
};
