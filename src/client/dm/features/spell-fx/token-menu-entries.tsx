// spell-fx's DM token menu entry (FR-VFX-23, registry FR-MAP-29): Show / Hide affected cells, one
// item per aura with a radius on the token; nothing when it anchors none (or effects are Off).
import { DropdownMenuSeparator } from "@ui/components/ui/menus";
import { CellsMenuItems, useCellAuras } from "@ui/features/spell-fx/CellsMenu";
import type { TokenMenuEntry, TokenMenuItemProps } from "../scenes-map/token-menu";

export const vfxTokenMenu: readonly TokenMenuEntry[] = [
  {
    id: "vfx.cells",
    order: 95,
    Item: function CellsItem({ token }: TokenMenuItemProps) {
      const auras = useCellAuras(token.id);
      if (auras.length === 0) return null;
      return (
        <>
          <DropdownMenuSeparator />
          <CellsMenuItems tokenId={token.id} />
        </>
      );
    },
  },
];
