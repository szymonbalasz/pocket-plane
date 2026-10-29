// Rests (FR-CHARX-123): the Short rest / Long rest choice, its "what it resets" line and the
// running-encounter warning, shared by the sheet's DM **Rest** popover (here) and Party Manager's
// "Rest the party…" dialog (DM client). Both send `char.rest`; the server decides what changes.
import { REST_COMBAT_WARNING, REST_TEXT, restLabel } from "@shared/character-sheet/rest";
import { CHARX_INTENTS, type CharRestResult } from "@shared/character-sheet/sheet";
import { REST_KINDS, type RestKind } from "@shared/events/character-sheet";
import { TentIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  ToggleGroup,
  ToggleGroupItem,
} from "../../components/ui/controls";
import { Tooltip } from "../../components/ui/overlays";
import { useSync } from "../../sync/store";
import { useStartedEncounter } from "../combat-tracker/store";
import { useBusy } from "./fields";
import { useSheet, useSheetIntents } from "./sheet-context";

/** FR-CHARX-123: "Nothing to reset" when the server changed nobody. */
export const NOTHING_TO_RESET = "Nothing to reset";

/** The two-segment Short rest / Long rest choice; items `<prefix>-kind` + `data-value`. */
export function RestKindToggle({
  value,
  onChange,
  prefix,
}: {
  value: RestKind;
  onChange(kind: RestKind): void;
  prefix: string;
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      aria-label="Rest"
      onValueChange={(v) => {
        if (v) onChange(v as RestKind);
      }}
    >
      {REST_KINDS.map((k) => (
        <ToggleGroupItem key={k} value={k} data-testid={`${prefix}-kind`} data-value={k}>
          {restLabel(k)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** What the rest resets (`<prefix>-text`) and, in a fight, the warning (`<prefix>-warning`). */
export function RestNotes({ kind, prefix }: { kind: RestKind; prefix: string }) {
  const fighting = useStartedEncounter() !== null;
  return (
    <>
      <p data-testid={`${prefix}-text`} className="text-xs text-muted-foreground">
        {REST_TEXT[kind]}
      </p>
      {fighting && (
        <p data-testid={`${prefix}-warning`} className="text-xs font-medium text-destructive">
          {REST_COMBAT_WARNING}
        </p>
      )}
    </>
  );
}

/** Sends `char.rest`; a rest that changed nobody says so (FR-CHARX-123). */
export function sendRest(
  send: (name: string, payload: unknown) => Promise<unknown>,
  characterIds: string[],
  kind: RestKind,
): Promise<unknown> {
  return send(CHARX_INTENTS.rest, { characterIds, kind }).then((r) => {
    if ((r as CharRestResult | undefined)?.rested.length === 0) toast(NOTHING_TO_RESET);
  });
}

/** FR-CHARX-123: the trigger's label, in its Tooltip and `aria-label`. */
export const REST_HINT = "Rest";

/**
 * FR-CHARX-123: the DM's **Rest** header action on a character's sheet, a 24-px icon button beside
 * the Public rolls menu (the narrow header keeps its two rows): a Popover with Short rest / Long
 * rest, the reset line, the encounter warning and Cancel / confirm (`charx-rest-*`).
 */
export function SheetRestButton({ className }: { className?: string }) {
  const ctx = useSheet();
  const live = useSync((s) => s.state === "live");
  const intents = useSheetIntents();
  const busy = useBusy();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<RestKind>("short");
  if (ctx.client !== "dm" || ctx.creature.kind !== "character") return null;
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setKind("short");
      }}
    >
      <Tooltip content={REST_HINT}>
        <PopoverTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            className={className}
            data-testid="charx-rest"
            aria-label={REST_HINT}
            disabled={!live || busy.busy}
          >
            <TentIcon className="size-3.5" />
          </Button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent
        align="end"
        data-testid="charx-rest-popover"
        className="flex w-64 flex-col gap-2 p-2"
      >
        <RestKindToggle value={kind} onChange={setKind} prefix="charx-rest" />
        <RestNotes kind={kind} prefix="charx-rest" />
        <div className="flex justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            data-testid="charx-rest-cancel"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            data-testid="charx-rest-confirm"
            disabled={!live || busy.busy}
            onClick={() => {
              setOpen(false);
              busy.run(() => sendRest(intents.send, [ctx.creature.id], kind));
            }}
          >
            {restLabel(kind)}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
