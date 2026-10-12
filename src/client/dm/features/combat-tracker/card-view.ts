// DM view of `damage-card` (FR-CBT-30): the card's action opens the attack popup (FR-CBT-19).
import { DAMAGE_CARD_KIND } from "@shared/combat-tracker/schemas";
import { defineNotificationView } from "@ui/features/notifications/views";
import { SwordIcon } from "lucide-react";
import { useCombatDialogs } from "./popup-store";

export const dmDamageCardView = defineNotificationView({
  kind: DAMAGE_CARD_KIND,
  icon: SwordIcon,
  // The popup is hosted by `cbt.initiative`'s companion (mounted whatever the window state).
  onAction(n) {
    useCombatDialogs.getState().openCard(n.id);
  },
});
