// R7 (FR-MOD-44, -48): this client's views: the damage card renders its offered parts
// (`mod-card-offer`), and the `mod-trigger` reminder is registered (info: no action, no end rule).
import { describe, expect, test } from "bun:test";
import { DAMAGE_CARD_KIND, type DamageCardPayload } from "@shared/combat-tracker/schemas";
import { MOD_TRIGGER_KIND } from "@shared/effect-modifiers/reminders";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { renderToStaticMarkup } from "react-dom/server";
import { dmNotificationViews } from "../../notification-views";

const payload: DamageCardPayload = {
  encounterId: "enc",
  attackerId: "brakka",
  attackerName: "Brakka",
  attackName: "Greataxe",
  damageType: "slashing",
  mode: "normal",
  crit: false,
  toHit: null,
  damage: {
    rollId: "r2",
    dice: [[8, true]],
    constant: 4,
    total: 14,
    manual: true,
    triggers: [
      {
        triggerId: "df",
        label: "Divine Fury",
        value: 6,
        expression: "1d6+2",
        rollId: "r3",
        type: "radiant",
      },
    ],
  },
};

describe("FR-MOD-48 / -44 dm views", () => {
  test("FR-MOD-48 the damage-card view renders the offered part", () => {
    const Render = dmNotificationViews.get(DAMAGE_CARD_KIND)?.render;
    if (!Render) throw new Error("no damage-card render");
    const n = {
      id: "n1",
      kind: DAMAGE_CARD_KIND,
      state: "pending",
      text: "Brakka: 14 slashing (Greataxe) (+ 6 radiant Divine Fury on a hit)",
      payload,
      resolution: null,
    } as unknown as NotificationRecord;
    expect(renderToStaticMarkup(<Render notification={n} />)).toContain(
      'data-testid="mod-card-offer" data-record-id="df">+ 6 radiant Divine Fury</span>',
    );
  });

  test("FR-MOD-44 mod-trigger registered: info, no action, no end rule", () => {
    const v = dmNotificationViews.get(MOD_TRIGGER_KIND);
    expect(v?.kind).toBe(MOD_TRIGGER_KIND);
    expect([v?.onAction, v?.genericResolve, v?.endRule]).toEqual([undefined, undefined, undefined]);
  });
});
