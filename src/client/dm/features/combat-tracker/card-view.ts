// DM view of `damage-card` (FR-CBT-30): the card's action opens the attack popup (FR-CBT-19) over
// the toast / Notifications row it was clicked in, and that toast closes (FR-CBT-75, FR-NOTE-26).
// Its toast keeps clear of the attacker's likely targets (FR-CBT-56, FR-NOTE-32; P3 glitch 2).
// Text with the offered rule-trigger parts muted after the damage (FR-MOD-48, R7).
import { DAMAGE_CARD_END_RULE } from "@shared/combat-tracker/end-rule";
import {
  COMBATANT_TYPE,
  type CombatantView,
  DAMAGE_CARD_KIND,
  DamageCardPayload,
} from "@shared/combat-tracker/schemas";
import { CardOffersText } from "@ui/features/effect-modifiers/card-offers";
import { defineNotificationView } from "@ui/features/notifications/views";
import { SwordIcon } from "lucide-react";
import { placementTokenIds } from "./popup-placement";
import { useCombatDialogs } from "./popup-store";

export const dmDamageCardView = defineNotificationView({
  kind: DAMAGE_CARD_KIND,
  icon: SwordIcon,
  render: CardOffersText,
  // FR-CBT-59: End dismisses pending cards (the End confirm counts them).
  endRule: DAMAGE_CARD_END_RULE,
  // The popup is hosted by `cbt.initiative`'s companion (mounted whatever the window state).
  onAction(n, ctx) {
    useCombatDialogs.getState().openCard(n.id, ctx.origin.rect);
    ctx.closeToast();
  },
  avoidTokens(n, store) {
    const p = DamageCardPayload.safeParse(n.payload);
    if (!p.success) return [];
    // Any scene: only the tokens drawn on the DM's canvas are measured.
    return placementTokenIds({
      rowTokenIds: [],
      combatants: Object.values(store.records[COMBATANT_TYPE] ?? {}) as CombatantView[],
      encounterId: p.data.encounterId,
      attackerId: p.data.attackerId,
      tokenSceneOf: () => "drawn",
      viewedSceneId: "drawn",
    });
  },
});
