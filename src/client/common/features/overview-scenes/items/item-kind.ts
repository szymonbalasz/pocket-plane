// What differs per kind of item when it's edited (FR-OVW-21, -23, -26, -34). The Select tool and the
// menu read only this, so each kind's handles, menu entries and double-click stay in its own file:
// `image-kind.ts`, `label-kind.ts`, `miniature-kind.ts`.
import type { ComponentType } from "react";
import type { OverviewItemView } from "../item-layout";

export type ItemSend = (name: string, input: unknown) => Promise<unknown>;

/** A kind's own menu entry, shown when the menu acts on this one item alone. */
export interface ItemMenuAction {
  /** The test ID's end: `ovw-item-menu-<id>`. */
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  disabled?(item: OverviewItemView): boolean;
  /** A returned promise's rejection is toasted. */
  run(item: OverviewItemView, send: ItemSend): unknown;
}

export interface ItemMenuSubProps {
  item: OverviewItemView;
  send: ItemSend;
}

/** An entry that draws itself: a submenu of choices (FR-OVW-34's Shape). */
export interface ItemMenuSub {
  id: string;
  Sub: ComponentType<ItemMenuSubProps>;
}

export type ItemMenuEntry = ItemMenuAction | ItemMenuSub;

export interface ItemKindDef {
  /** Corner handles keep the shape, each side in these units; null = no handles. */
  resize: { min: number; max: number } | null;
  menu: readonly ItemMenuEntry[];
  doubleClick?(item: OverviewItemView): void;
}
