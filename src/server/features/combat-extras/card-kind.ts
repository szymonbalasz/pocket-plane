// Notification kind `cbtx-concentration` (FR-CBTX-17, protocol §32): created by `hpRules.after`,
// resolved by `cbtx.rollConcentration` (as the actor) or closed by a rule (`ended` / `undone`,
// FR-CBTX-43); never by `note.resolve`. No end rule: it stays pending at End (OQ-CBTX-15).
import {
  ConcentrationCardPayload,
  ConcentrationCardResolution,
} from "@shared/combat-extras/intents";
import { CONCENTRATION_CARD_KIND } from "@shared/combat-extras/schemas";
import { defineNotificationKind } from "../notifications/kind";

export const concentrationCardKind = defineNotificationKind({
  kind: CONCENTRATION_CARD_KIND,
  ownerSpec: "combat-extras",
  payload: ConcentrationCardPayload,
  resolution: ConcentrationCardResolution,
  genericResolve: false,
});
