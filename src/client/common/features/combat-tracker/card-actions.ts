// FR-CBT-130 (sprint 7): card actions, one row of controls on a pending damage card: in the DM's
// attack popup (under the card summary, above the targets) and on the player's damage-card view
// (toast and History row, below the dice). APPEND-ONLY registry (AGENTS §9.9): a feature adds one
// import and one line to `cardActions`; nothing else changes here. Empty registry (or none
// available) → both views unchanged. An entry with `feature` shows only while that campaign
// feature is on (`isFeatureOn`, ADR-0058).
import type { NotificationRecord } from "@shared/notifications/schemas";
import type { You } from "@shared/protocol/frames";
import type { RecordStore } from "@shared/protocol/store";
import type { ComponentType } from "react";
import { isFeatureOn } from "../campaign-management/use-feature";
import { gemCombatAction } from "../gems/combat-action";

export type CardClient = "dm" | "player";

export interface CardAction {
  /** `<prefix>.<name>` (e.g. `gem.combat`). */
  id: string;
  order: number;
  /** Which clients draw it (absent = both). */
  clients?: readonly CardClient[];
  /** A campaign feature key (`@shared/campaign-management/features`): hidden while it is off. */
  feature?: string;
  available(store: RecordStore, card: NotificationRecord, you: You): boolean;
  Component: ComponentType<{ card: NotificationRecord; client: CardClient }>;
}

export const cardActions: readonly CardAction[] = [
  gemCombatAction, // gem.combat (gems, FR-GEM-34; feature `gems`)
];

/** FR-CBT-130: the actions a card shows for this viewer in this client, in `order`. */
export function cardActionsFor(
  list: readonly CardAction[],
  store: RecordStore,
  card: NotificationRecord,
  client: CardClient,
): CardAction[] {
  const you = store.you;
  if (!you) return [];
  return list
    .filter(
      (a) =>
        (!a.clients || a.clients.includes(client)) &&
        (a.feature === undefined || isFeatureOn(store, a.feature)) &&
        a.available(store, card, you),
    )
    .sort((a, b) => a.order - b.order);
}
