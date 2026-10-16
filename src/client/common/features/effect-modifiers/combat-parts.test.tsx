// R7 client (FR-MOD-48): the damage card's offered parts (`mod-card-offer`), as both clients'
// card views render them (registrations: `@dm` / `@player` `features/effect-modifiers/`).
import { describe, expect, test } from "bun:test";
import { DAMAGE_CARD_KIND, type DamageCardPayload } from "@shared/combat-tracker/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { renderToStaticMarkup } from "react-dom/server";
import { CardOffersText } from "./card-offers";

const offerPayload: DamageCardPayload = {
  encounterId: "enc",
  attackerId: "brakka",
  attackerName: "Brakka",
  attackName: "Greataxe",
  damageType: "slashing",
  mode: "normal",
  crit: false,
  toHit: { rollId: "r1", dice: [[15, true]], constant: 7, total: 22, manual: true, natural: 15 },
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
      {
        triggerId: "sa",
        label: "Sneak Attack",
        value: 9,
        expression: "3d6",
        rollId: "r4",
        type: null,
      },
    ],
  },
};
const TEXT =
  "Brakka: 22 to hit, 14 slashing (+ 6 radiant Divine Fury, + 9 slashing Sneak Attack on a hit)";
const card = (p: Partial<NotificationRecord> = {}) =>
  ({
    id: "n1",
    kind: DAMAGE_CARD_KIND,
    state: "pending",
    text: TEXT,
    payload: offerPayload,
    resolution: null,
    ...p,
  }) as unknown as NotificationRecord;

describe("FR-MOD-48 card offers in the card views", () => {
  test("FR-MOD-48 offers muted after the damage, one mod-card-offer per part; no offers → the text as is", () => {
    const html = renderToStaticMarkup(<CardOffersText notification={card()} />);
    expect(html).toContain('data-testid="mod-card-offer" data-record-id="df"');
    expect(html).toContain('data-record-id="sa">+ 9 slashing Sneak Attack</span>');
    expect(html.replace(/<[^>]+>/g, "")).toBe(TEXT);
    const plain = { ...offerPayload, damage: { ...offerPayload.damage, triggers: undefined } };
    const none = renderToStaticMarkup(
      <CardOffersText
        notification={card({ text: "Brakka: 22 to hit, 14 slashing", payload: plain })}
      />,
    );
    expect(none).toBe("<span>Brakka: 22 to hit, 14 slashing</span>");
    // A count fallback (text over 280 chars) renders as sent.
    const count = "Brakka: 22 to hit, 14 slashing (+ 2 trigger parts on a hit)";
    expect(renderToStaticMarkup(<CardOffersText notification={card({ text: count })} />)).toBe(
      `<span>${count}</span>`,
    );
  });
});
