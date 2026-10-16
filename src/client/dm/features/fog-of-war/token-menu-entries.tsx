// fog-of-war's token menu line (FR-FOG-47, registry FR-MAP-29): **Invisible** (a checkbox line,
// `fog-token-menu-invisible`, `data-state` checked / unchecked) → `fog.setInvisible` (#210). The
// server decides (DM only; same value → no-op). Every token, any scene.
import { FOG_INTENTS, type FogSetInvisibleInput } from "@shared/fog-of-war/schemas";
import { DropdownMenuItem } from "@ui/components/ui/menus";
import { toastReject, useMapIntent } from "@ui/features/scenes-map/intents";
import { CheckIcon, GhostIcon } from "lucide-react";
import type { TokenMenuEntry, TokenMenuItemProps } from "../scenes-map/token-menu";

export const INVISIBLE_LABEL = "Invisible";

function InvisibleItem({ token }: TokenMenuItemProps) {
  const send = useMapIntent();
  const on = token.invisible === true;
  return (
    <DropdownMenuItem
      role="menuitemcheckbox"
      aria-checked={on}
      data-testid="fog-token-menu-invisible"
      data-state={on ? "checked" : "unchecked"}
      onSelect={() => {
        const input: FogSetInvisibleInput = { tokenId: token.id, invisible: !on };
        send(FOG_INTENTS.setInvisible, input).catch(toastReject);
      }}
    >
      <GhostIcon /> {INVISIBLE_LABEL}
      {on && <CheckIcon className="ml-auto" />}
    </DropdownMenuItem>
  );
}

/** After scenes-map's Hide / Reveal (40), before Duplicate (50). */
export const fogTokenMenu: readonly TokenMenuEntry[] = [
  { id: "fog.invisible", order: 45, Item: InvisibleItem },
];
