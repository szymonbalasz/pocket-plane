// DM `dice.log` window: the shared game log + the public log settings gear (FR-DICE-22, 23).
import {
  CATEGORY_LABEL,
  categoryPublic,
  GAME_LOG_SETTINGS_TYPE,
  type GameLogSettingsRecord,
  ROLL_CATEGORIES,
} from "@shared/dice-roll-log/schemas";
import { Button } from "@ui/components/ui/button";
import { Checkbox, Popover, PopoverContent, PopoverTrigger } from "@ui/components/ui/controls";
import { Tip } from "@ui/components/ui/tip";
import { openSheetFor } from "@ui/features/character-sheet/selection";
import { CHAR_SHEET_KIND } from "@ui/features/character-sheet/window";
import { GameLog } from "@ui/features/dice-roll-log/GameLog";
import type { ActorCreature } from "@ui/features/dice-roll-log/logic";
import { diceLogWindowBase, LOG_USEFUL, logSize } from "@ui/features/dice-roll-log/window";
import { defineWindow } from "@ui/features/play-shell/registry";
import { useOpenWindow } from "@ui/features/play-shell/ShellContext";
import { useRecords, useSync } from "@ui/sync/store";
import { SettingsIcon } from "lucide-react";
import { toast } from "sonner";
import { useOpenStatBlock } from "../entities/statblock/store";

/** FR-DICE-23: one checkbox per category; each change sends `dice.setCategoryPublic`. */
function SettingsPopover() {
  const settings = useRecords<GameLogSettingsRecord>(GAME_LOG_SETTINGS_TYPE)[0];
  const live = useSync((s) => s.state === "live");
  const connection = useSync((s) => s.connection);
  return (
    <Popover>
      <Tip content="Public log settings">
        <PopoverTrigger asChild>
          <Button
            data-testid="dice-settings-open"
            size="icon"
            variant="ghost"
            className="size-7"
            aria-label="Public log settings"
          >
            <SettingsIcon className="size-4" />
          </Button>
        </PopoverTrigger>
      </Tip>
      <PopoverContent align="end" side="top" className="w-60">
        <p className="mb-1 text-sm font-medium">Players see my rolls of</p>
        <p className="mb-3 text-xs text-muted-foreground">
          Applies to new rolls only. Player rolls are always public.
        </p>
        <ul className="flex flex-col gap-2">
          {ROLL_CATEGORIES.map((c) => {
            const id = `dice-settings-${c}`;
            return (
              <li key={c} className="flex items-center gap-2">
                <Checkbox
                  id={id}
                  data-testid="dice-settings-category"
                  data-value={c}
                  disabled={!live || !settings}
                  checked={settings ? categoryPublic(settings, c) : false}
                  onCheckedChange={(v) => {
                    connection
                      .sendIntent("dice.setCategoryPublic", { category: c, public: v === true })
                      .catch((e: Error) => toast.error(e.message));
                  }}
                />
                <label htmlFor={id} className="text-sm">
                  {CATEGORY_LABEL[c]}
                </label>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/**
 * FR-DICE-103: a line's creature: a character's sheet, else its stat block with the token menu's
 * opener (bound to its combatant when the name is one).
 */
function useOpenCreature() {
  const openStatBlock = useOpenStatBlock();
  const openWindow = useOpenWindow();
  return (c: ActorCreature) => {
    if (c.kind === "character") {
      openSheetFor(c.id, "character");
      openWindow(CHAR_SHEET_KIND);
    } else {
      openStatBlock({
        definitionId: c.id,
        ...(c.combatantId ? { combatantId: c.combatantId } : {}),
      });
    }
  };
}

function DmLogBody() {
  return <GameLog dmTools={<SettingsPopover />} openCreature={useOpenCreature()} />;
}

export const dmDiceLogWindow = defineWindow({
  ...diceLogWindowBase,
  clients: ["dm"],
  // DM: bottom-left, clear of the tool rail (map-first, #162; protocol §24); 1150×280 wide +
  // tall, 690 / 200 below (FR-DICE-38, OQ-KIT-02 B); the sprint-4 460×240 and the pre-kit
  // 1150×240 / 690×160 take the new default (FR-SHELL-53).
  defaultSize: logSize({ w: 1150, h: 280 }),
  previousDefaults: [
    { w: 460, h: 240 },
    { w: 1150, h: 240 },
    { w: 690, h: 160 },
  ],
  usefulSize: LOG_USEFUL,
  defaultPosition: { anchor: "bottom-left", dx: 56 },
  component: DmLogBody,
});
