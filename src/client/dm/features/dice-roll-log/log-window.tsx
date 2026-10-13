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
import { GameLog } from "@ui/features/dice-roll-log/GameLog";
import { diceLogWindowBase } from "@ui/features/dice-roll-log/window";
import { defineWindow } from "@ui/features/play-shell/registry";
import { useRecords, useSync } from "@ui/sync/store";
import { SettingsIcon } from "lucide-react";
import { toast } from "sonner";

/** FR-DICE-23: one checkbox per category; each change sends `dice.setCategoryPublic`. */
function SettingsPopover() {
  const settings = useRecords<GameLogSettingsRecord>(GAME_LOG_SETTINGS_TYPE)[0];
  const live = useSync((s) => s.state === "live");
  const connection = useSync((s) => s.connection);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          data-testid="dice-settings-open"
          size="icon"
          variant="ghost"
          className="size-8"
          aria-label="Public log settings"
        >
          <SettingsIcon className="size-4" />
        </Button>
      </PopoverTrigger>
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

function DmLogBody() {
  return <GameLog dmTools={<SettingsPopover />} />;
}

export const dmDiceLogWindow = defineWindow({
  ...diceLogWindowBase,
  clients: ["dm"],
  // DM bottom strip (protocol §24): right of `map.scenes`, left of the right column at 1280.
  defaultSize: { w: 460, h: 240 },
  defaultPosition: { anchor: "bottom-left", dx: 368 },
  component: DmLogBody,
});
