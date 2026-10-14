// `damage-card`'s end rule (FR-CBT-59, FR-NOTE-23, ADR-0034): a pending card is dismissed when its
// encounter ends (it can't be applied after End, FR-CBT-10). One constant, referenced by the
// server kind (`card-kind.ts`) and both clients' views (`card-view.ts`).
import type { EncounterEndRule } from "@shared/notifications/end-rule";

export const DAMAGE_CARD_END_RULE: EncounterEndRule = {
  onEncounterEnd: "dismiss",
  encounterIdOf: (p) =>
    typeof p === "object" &&
    p !== null &&
    "encounterId" in p &&
    typeof (p as { encounterId: unknown }).encounterId === "string"
      ? (p as { encounterId: string }).encounterId
      : null,
};
