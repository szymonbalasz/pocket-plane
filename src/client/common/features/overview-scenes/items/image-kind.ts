// An image when edited (FR-OVW-23): corner handles, and Image… swaps the picture (not while locked:
// the new shape is a size change, and a locked item refuses one).
import { IMAGE_SIDE } from "@shared/overview-scenes/schemas";
import { ImageIcon } from "lucide-react";
import { useOverviewEditor } from "../overview-editor";
import type { ItemKindDef } from "./item-kind";

export const imageKind: ItemKindDef = {
  resize: IMAGE_SIDE,
  menu: [
    {
      id: "image",
      label: "Image…",
      icon: ImageIcon,
      disabled: (item) => item.locked === true,
      run: (item) => useOverviewEditor.setState({ picking: { kind: "image", itemId: item.id } }),
    },
  ],
};
