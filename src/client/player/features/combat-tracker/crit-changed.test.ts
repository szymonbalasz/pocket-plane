// FR-CBT-127 (sprint 7, GM1): the owner's card view while a crit flip waits for new damage.
import { describe, expect, test } from "bun:test";
import {
  CRIT_CHANGED_TEXT,
  DAMAGE_CARD_KIND,
  type DamageCardPayload,
} from "@shared/combat-tracker/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { outcomeText } from "./card-view";

const card = (p: Partial<DamageCardPayload> = {}) =>
  ({
    id: "card1",
    kind: DAMAGE_CARD_KIND,
    state: "pending",
    payload: {
      encounterId: "enc",
      attackerId: "cm",
      attackerName: "Mira",
      attackName: "Dagger",
      damageType: "piercing",
      mode: "normal",
      crit: false,
      toHit: {
        rollId: "r1",
        dice: [[20, true]],
        constant: 3,
        total: 23,
        manual: true,
        natural: 20,
      },
      damage: null,
      ...p,
    },
  }) as unknown as NotificationRecord;

describe("FR-CBT-127 crit flip", () => {
  test('FR-CBT-127 crit flip: the owner\'s card reads "Critical changed by a reroll — roll damage again" while it waits', () => {
    expect(outcomeText(card({ crit: true, unusedRolls: [{ rollId: "d1", total: 6 }] }))).toBe(
      CRIT_CHANGED_TEXT,
    );
    // A plain to-hit-only card still waits for the DM.
    expect(outcomeText(card())).toBe("Waiting for DM");
  });
});
