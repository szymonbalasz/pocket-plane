// FR-CBT-130 (sprint 7): the card-action slot (`card-actions.ts` registry) as one row
// (`cbt-card-actions` + `data-record-id` = the card id); nothing rendered when no action is
// available, so a card without actions looks as before. FR-CBT-131: maxed dice as chips with a
// small "max" Badge (`cbt-card-die-max`, Tooltip "Set to max").
import {
  type CardPartRef,
  type DamageCardPayload,
  DamageCardPayload as DamageCardSchema,
} from "@shared/combat-tracker/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { Fragment, useContext, useMemo } from "react";
import { Tooltip } from "../../components/ui/overlays";
import { Badge } from "../../components/ui/primitives";
import { SyncContext, useSync } from "../../sync/store";
import { type CardAction, type CardClient, cardActions, cardActionsFor } from "./card-actions";

/** FR-CBT-131: the Tooltip of a "max" Badge. */
export const MAX_TIP = "Set to max";

interface SlotProps {
  card: NotificationRecord;
  client: CardClient;
  actions?: readonly CardAction[];
}

/**
 * FR-CBT-130: the card's available actions in one row. A view rendered outside a synced client
 * (a static preview of the card) has no slot.
 */
export function CardActions(props: SlotProps) {
  return useContext(SyncContext) ? <CardActionsRow {...props} /> : null;
}

function CardActionsRow({ card, client, actions = cardActions }: SlotProps) {
  const store = useSync((s) => s.store);
  const shown = useMemo(
    () => cardActionsFor(actions, store, card, client),
    [actions, store, card, client],
  );
  if (shown.length === 0) return null;
  return (
    <div
      data-testid="cbt-card-actions"
      data-record-id={card.id}
      className="flex flex-wrap items-center gap-1.5"
    >
      {shown.map((a) => (
        <a.Component key={a.id} card={card} client={client} />
      ))}
    </div>
  );
}

/** FR-CBT-131: the small "max" Badge after a maxed die. */
export function MaxBadge({ part, index }: { part: CardPartRef; index: number }) {
  return (
    <Tooltip content={MAX_TIP}>
      <Badge
        variant="outline"
        data-testid="cbt-card-die-max"
        data-part={part}
        data-index={index}
        className="ml-0.5 h-4 px-1 text-[10px] leading-none"
      >
        max
      </Badge>
    </Tooltip>
  );
}

/** One part's dice `[3 6 max]` with a "max" Badge after each maxed die. */
export function PartDice({
  part,
  dice,
  maxed,
}: {
  part: CardPartRef;
  dice: readonly (readonly [number | null, boolean])[];
  maxed?: readonly number[];
}) {
  return (
    <span className="font-mono text-xs text-muted-foreground">
      [
      {dice.map(([v, kept], i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: dice positions are stable
        <Fragment key={i}>
          <span className={kept ? "" : "line-through opacity-60"}>
            {i > 0 ? " " : ""}
            {v ?? "?"}
          </span>
          {maxed?.includes(i) && <MaxBadge part={part} index={i} />}
        </Fragment>
      ))}
      ]
    </span>
  );
}

/**
 * FR-CBT-131 (player card view): the damage's maxed parts, "slashing [6 5 max]"; nothing for a
 * card without maxed dice (gems off: the server strips `maxed`, OQ-GEM-21 B).
 */
export function MaxedDamage({ p }: { p: DamageCardPayload }) {
  const d = p.damage;
  if (!d) return null;
  const parts = [
    { part: "base" as CardPartRef, type: p.damageType, roll: d },
    ...(d.extra ?? []).map((x, i) => ({ part: i as CardPartRef, type: x.type as string, roll: x })),
  ].filter((x) => x.roll.maxed);
  if (parts.length === 0) return null;
  return (
    <span data-testid="cbt-card-maxed" className="flex flex-wrap items-center gap-2 text-xs">
      {parts.map((x) => (
        <span key={String(x.part)} className="inline-flex items-center gap-1">
          {x.type && <span className="text-muted-foreground">{x.type}</span>}
          <PartDice part={x.part} dice={x.roll.dice} maxed={x.roll.maxed} />
        </span>
      ))}
    </span>
  );
}

/** The card payload, if readable (views draw nothing extra otherwise). */
export const cardPayload = (n: NotificationRecord): DamageCardPayload | null => {
  const p = DamageCardSchema.safeParse(n.payload);
  return p.success ? p.data : null;
};
