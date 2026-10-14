// FR-CBT-59 / FR-NOTE-23: the player view of `damage-card` holds the same end-rule constant as
// the server kind and the DM view.
import { describe, expect, test } from "bun:test";
import { DAMAGE_CARD_END_RULE } from "@shared/combat-tracker/end-rule";
import { DAMAGE_CARD_KIND } from "@shared/combat-tracker/schemas";
import { playerNotificationViews } from "../../notification-views";

describe("FR-NOTE-23 registry", () => {
  test("FR-NOTE-23 registry: player damage-card view references DAMAGE_CARD_END_RULE", () => {
    expect(playerNotificationViews.get(DAMAGE_CARD_KIND)?.endRule).toBe(DAMAGE_CARD_END_RULE);
  });
});
