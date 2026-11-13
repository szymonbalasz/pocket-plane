// token-forms' DM token menu line (FR-FORM-15, registry FR-MAP-29): Form ▸ Base / each form, on a
// character token whose character has forms. One `forms.choose`; the server re-derives every token.
import { FormMenuItem } from "@ui/features/token-forms/forms";
import type { TokenMenuEntry, TokenMenuItemProps } from "../scenes-map/token-menu";

function FormItem({ token }: TokenMenuItemProps) {
  return <FormMenuItem characterId={token.characterId} />;
}

export const formsTokenMenu: readonly TokenMenuEntry[] = [
  { id: "forms.form", order: 27, available: (t) => t.characterId !== null, Item: FormItem },
];
