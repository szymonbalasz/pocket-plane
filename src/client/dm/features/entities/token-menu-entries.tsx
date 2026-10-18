// entities' token menu entry (FR-ENT-28, registry FR-MAP-29): Art ▸ "Creature type" (the
// definition's current type; disabled without one) / "Initials". Each sends one
// `map.updateToken {creatureType}`; the server decides (DM only). Players get no menu.
import { type CreatureType, creatureTypeOf } from "@shared/entities/schemas";
import { MAP_INTENTS } from "@shared/scenes-map/schemas";
import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@ui/components/ui/menus";
import { useDefinitions } from "@ui/features/compendium/definitions";
import { artMenuState, creatureTypeLabel } from "@ui/features/entities/art";
import { toastReject, useMapIntent } from "@ui/features/scenes-map/intents";
import { PaletteIcon } from "lucide-react";
import { useMemo } from "react";
import type { TokenMenuEntry, TokenMenuItemProps } from "../scenes-map/token-menu";

function ArtItem({ token }: TokenMenuItemProps) {
  const send = useMapIntent();
  const ids = useMemo(() => [token.definitionId], [token.definitionId]);
  const def = useDefinitions(ids).byId.get(token.definitionId);
  const state = artMenuState(token, def ? creatureTypeOf(def) : null);
  const type = state.definitionType;
  const set = (creatureType: CreatureType | "initials") =>
    void send(MAP_INTENTS.updateToken, { tokenId: token.id, creatureType }).catch(toastReject);
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger data-testid="ent-token-menu-art">
        <PaletteIcon /> Art
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {/* Each item sends on select, so "Creature type" also re-applies a changed definition type. */}
        <DropdownMenuRadioGroup value={state.checked ?? ""}>
          <DropdownMenuRadioItem
            value="type"
            disabled={type === null}
            onSelect={() => type && set(type)}
            data-testid="ent-token-menu-art-type"
            data-value={type ?? undefined}
          >
            Creature type{type ? ` (${creatureTypeLabel(type)})` : ""}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem
            value="initials"
            onSelect={() => set("initials")}
            data-testid="ent-token-menu-art-initials"
          >
            Initials
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

export const entTokenMenu: readonly TokenMenuEntry[] = [
  { id: "ent.art", order: 26, Item: ArtItem },
];
