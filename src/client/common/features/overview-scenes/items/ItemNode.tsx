// One item on the canvas: a Group at its `x, y` (Konva `name` = `ovw-item`, `id` = the item's; attrs
// `kind`, `hidden`, `locked` for the DM) around its kind's drawing, one file per kind. Memoised:
// a pan or zoom re-renders only hidden items (their mark keeps a screen size).
import type { ItemKind } from "@shared/overview-scenes/schemas";
import { type ComponentType, memo } from "react";
import { Group } from "react-konva";
import { useOverviewCanvas } from "../overview-canvas-context";
import { ImageItem } from "./ImageItem";
import type { ItemViewProps } from "./item-view";
import { LabelItem } from "./LabelItem";
import { MiniatureItem } from "./MiniatureItem";

const VIEWS: Readonly<Record<ItemKind, ComponentType<ItemViewProps>>> = {
  image: ImageItem,
  label: LabelItem,
  miniature: MiniatureItem,
};

export const ItemNode = memo(function ItemNode(props: ItemViewProps) {
  const { client } = useOverviewCanvas();
  const { item } = props;
  const View = VIEWS[item.kind];
  return (
    <Group
      name="ovw-item"
      id={item.id}
      kind={item.kind}
      hidden={item.hidden}
      locked={client === "dm" ? item.locked : undefined}
      x={item.x}
      y={item.y}
    >
      <View {...props} />
    </Group>
  );
});
