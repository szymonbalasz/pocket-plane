// K11 (kit-parity, DM #361): the DM's public switches for Main's rolls (FR-CHAR-22, FR-CHAR-24)
// fold into one small header menu, beside Lock / Edit, instead of rows above the blocks: the
// kit's sheet has no switch rows. Same switches, test IDs and per-roll overrides (shared through
// `SheetOverridesProvider`); none for players or on NPC sheets (FR-CHARX-22). The Initiative
// switch only while the Initiative button shows (FR-CHAR-24). BL-139 (K11 follow-up): the
// attacks' Attack / Damage switches too (were in the Attacks box header, Actions tab and wide
// Main), so every DM public switch of the sheet is in this one menu.
import type { RollCategory } from "@shared/dice-roll-log/schemas";
import { EyeIcon } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/controls";
import { Tooltip } from "../../components/ui/overlays";
import { useSync } from "../../sync/store";
import { rollRoutes } from "./roll-routes";
import { PublicSwitch, useSheetOverrides } from "./rolls";
import { rollActionView, routeFor } from "./routing";
import { useSheet } from "./sheet-context";

/** The menu's switches, in sheet order: category, label, test ID. */
const SWITCHES: readonly (readonly [RollCategory, string, string])[] = [
  ["initiative", "Initiative", "char-sheet-public-init"],
  ["ability-check", "Checks", "char-sheet-public-check"],
  ["saving-throw", "Saves", "char-sheet-public-save"],
  ["skill-check", "Skills", "charx-public-skill"],
  ["attack", "Attack", "charx-public-attack"],
  ["damage", "Damage", "charx-public-damage"],
];

export const PUBLIC_MENU_HINT = "Public rolls: show the next roll to the players";

/** The switches (the menu's body). */
export function PublicRolls() {
  const ctx = useSheet();
  const store = useSync((s) => s.store);
  const overrides = useSheetOverrides();
  const claim = routeFor(rollRoutes, store, ctx.creature.id, "initiative");
  const init = !(ctx.editing && ctx.canEdit) && rollActionView(claim, "initiative") === "button";
  return (
    <div data-testid="charx-public-rolls" className="flex flex-col gap-2">
      {SWITCHES.filter(([c]) => c !== "initiative" || init).map(([category, label, testId]) => (
        <PublicSwitch
          key={category}
          category={category}
          label={label}
          testId={testId}
          overrides={overrides}
        />
      ))}
    </div>
  );
}

/** The small header button (DM, characters) that opens the switches. */
export function PublicRollsMenu({ className }: { className?: string }) {
  const ctx = useSheet();
  const overrides = useSheetOverrides();
  if (ctx.client !== "dm" || ctx.npc || ctx.readOnly) return null;
  const set = SWITCHES.some(([c]) => overrides.get(c) !== undefined);
  return (
    <Popover>
      <Tooltip content={PUBLIC_MENU_HINT}>
        <PopoverTrigger asChild>
          <Button
            size="sm"
            variant={set ? "secondary" : "outline"}
            className={className}
            data-testid="charx-public-menu"
            data-on={set ? "true" : "false"}
            aria-label="Public rolls"
          >
            <EyeIcon className="size-3.5" />
          </Button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent align="end" className="w-auto min-w-36 p-3">
        <PublicRolls />
      </PopoverContent>
    </Popover>
  );
}
