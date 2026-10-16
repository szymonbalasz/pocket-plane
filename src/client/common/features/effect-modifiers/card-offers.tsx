// A damage card's text with its offered rule-trigger parts (FR-MOD-48, MOD §7 "Card and toast"),
// both clients: the server's text, the offers muted after the damage, one `mod-card-offer` per
// part ("(+ 6 radiant Divine Fury on a hit)"). A card without offers, or whose text fell back to
// a count (too long), renders its text as is.
import { DamageCardPayload } from "@shared/combat-tracker/schemas";
import { offersSuffix, offerText } from "@shared/effect-modifiers/combat-parts";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { Fragment } from "react";

export function CardOffersText({ notification: n }: { notification: NotificationRecord }) {
  const p = DamageCardPayload.safeParse(n.payload);
  const offers = p.success ? (p.data.damage?.triggers ?? []) : [];
  const type = p.success ? p.data.damageType : null;
  const suffix = offersSuffix(offers, type);
  if (!suffix || !n.text.endsWith(suffix)) return <span>{n.text}</span>;
  return (
    <span>
      {n.text.slice(0, -suffix.length)}{" "}
      <span className="text-muted-foreground">
        (
        {offers.map((o, i) => (
          <Fragment key={o.triggerId}>
            {i > 0 && ", "}
            <span data-testid="mod-card-offer" data-record-id={o.triggerId}>
              {offerText(o, type)}
            </span>
          </Fragment>
        ))}{" "}
        on a hit)
      </span>
    </span>
  );
}
