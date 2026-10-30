// One item on the canvas: a Group at its `x, y` (Konva `name` = `ovw-item`, `id` = the item's; attrs
// `kind`, `hidden`, `locked` for the DM) around its kind's drawing, one file per kind. Memoised:
// a pan or zoom re-renders only hidden items (their mark keeps a screen size). `preview`: where a
// gesture draws it until the server's answer (FR-OVW-18, -23). A later record re-arms a failed image
// (FR-ASSET-16), a preview doesn't: a drag isn't a reason to fetch it again.
import type { ItemKind } from "@shared/overview-scenes/schemas";
import { type ComponentType, memo, useEffect } from "react";
import { Group } from "react-konva";
import { retryAssetImage } from "../../assets-pipeline/useAssetImage";
import { useOverviewCanvas } from "../overview-canvas-context";
import type { ItemPreview } from "../overview-editor";
import { ImageItem } from "./ImageItem";
import type { ItemViewProps } from "./item-view";
import { LabelItem } from "./LabelItem";
import { MiniatureItem } from "./MiniatureItem";

const VIEWS: Readonly<Record<ItemKind, ComponentType<ItemViewProps>>> = {
  image: ImageItem,
  label: LabelItem,
  miniature: MiniatureItem,
};

export const ItemNode = memo(function ItemNode({
  preview,
  ...props
}: ItemViewProps & { preview?: ItemPreview | undefined }) {
  const { client } = useOverviewCanvas();
  const { item } = props;
  useEffect(() => {
    if (item.assetId) retryAssetImage(item.assetId, "display");
  }, [item]);
  const View = VIEWS[item.kind];
  const shown = preview ? { ...item, ...preview } : item;
  return (
    <Group
      name="ovw-item"
      id={item.id}
      kind={item.kind}
      hidden={item.hidden}
      locked={client === "dm" ? item.locked : undefined}
      x={shown.x}
      y={shown.y}
    >
      <View {...props} item={shown} />
    </Group>
  );
});
