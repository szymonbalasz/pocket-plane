// A miniature when edited (FR-OVW-32–34): square, so its corner handles keep the shape too. Name,
// Image… and Owner are off on a linked miniature: those are the character's (FR-OVW-33). Unlike an
// image's, Image… changes no size, so a lock doesn't stop it.
import { MINIATURE_SIDE } from "@shared/overview-scenes/schemas";
import { ImageIcon, PencilIcon } from "lucide-react";
import { useOverviewEditor } from "../overview-editor";
import type { ItemKindDef } from "./item-kind";
import { OwnerSub, ShapeSub } from "./MiniatureMenu";

const linked = (item: { characterId: string | null }) => item.characterId !== null;

export const miniatureKind: ItemKindDef = {
  resize: MINIATURE_SIDE,
  menu: [
    {
      id: "name",
      label: "Name…",
      icon: PencilIcon,
      disabled: linked,
      run: (item) => useOverviewEditor.setState({ naming: item.id }),
    },
    {
      id: "image",
      label: "Image…",
      icon: ImageIcon,
      disabled: linked,
      run: (item) => useOverviewEditor.setState({ picking: { kind: "image", itemId: item.id } }),
    },
    { id: "shape", Sub: ShapeSub },
    { id: "owner", Sub: OwnerSub },
  ],
};
