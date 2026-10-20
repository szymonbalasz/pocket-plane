// Notification kind `cbt-summon-concentration` (sprint 6, FR-CBT-120, protocol §23): created by
// combat's `effectHooks` line when a summon's linked concentration ends (`./concentration-card`),
// resolved by `cbt.dismiss {notificationId}` (`dismissed`) or by rule once none of its summons is
// left (`hostile` / `gone`); never by `note.resolve`. Dismissed with its encounter (FR-NOTE-23).
import {
  SUMMON_CARD_KIND,
  SummonCardPayload,
  SummonCardResolution,
  summonCardEndRule,
} from "@shared/combat-tracker/summon-card-kind";
import { defineNotificationKind } from "../notifications/kind";

export const summonCardKind = defineNotificationKind({
  kind: SUMMON_CARD_KIND,
  ownerSpec: "combat-tracker",
  payload: SummonCardPayload,
  resolution: SummonCardResolution,
  genericResolve: false,
  endRule: summonCardEndRule,
});
