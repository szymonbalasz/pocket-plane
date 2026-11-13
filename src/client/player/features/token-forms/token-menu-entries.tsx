// token-forms' player token menu line (FR-FORM-15): Form ▸ on a token of the player's own
// character (the only characters a player holds in full) that has forms.
import { FormMenuItem, hasForms } from "@ui/features/token-forms/forms";
import type { PlayerTokenMenuEntry, PlayerTokenMenuItemProps } from "../scenes-map/token-menu";

function FormItem({ token }: PlayerTokenMenuItemProps) {
  return <FormMenuItem characterId={token.characterId} />;
}

export const formsTokenMenu: readonly PlayerTokenMenuEntry[] = [
  {
    id: "forms.form",
    order: 20,
    available: (t, store) => store !== undefined && hasForms(store, t.characterId),
    Item: FormItem,
  },
];
