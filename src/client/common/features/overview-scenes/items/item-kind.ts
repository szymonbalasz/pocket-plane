// What differs per kind of item when it's edited (FR-OVW-21, -23, -26, -34). The Select tool and the
// menu read only this, so each kind's handles, menu entries and double-click stay in its own file:
// `image-kind.ts`, `label-kind.ts`, `miniature-kind.ts`.
import type { ComponentType } from "react";
import type { OverviewItemView } from "../item-layout";

export type ItemSend = (name: string, input: unknown) => Promise<unknown>;

/** A kind's own menu entry, shown when the menu acts on this one item alone. */
export interface ItemMenuEntry {
  /** The test ID's end: `ovw-item-menu-<id>`. */
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  disabled?(item: OverviewItemView): boolean;
  /** A returned promise's rejection is toasted. */
  run(item: OverviewItemView, send: ItemSend): unknown;
}

export interface ItemKindDef {
  /** Corner handles keep the shape, each side in these units; null = no handles. */
  resize: { min: number; max: number } | null;
  menu: readonly ItemMenuEntry[];
  doubleClick?(item: OverviewItemView): void;
  /** Beside the Select tool while items of this kind are selected (FR-OVW-28, -36). */
  stylePanel?: ComponentType<{ items: readonly OverviewItemView[] }>;
}
