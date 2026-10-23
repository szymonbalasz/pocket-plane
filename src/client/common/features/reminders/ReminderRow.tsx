// One reminder row (FR-REM-18, -21, -26): the text (plain text, line breaks kept), the source
// muted under it (a link icon when the caller can open the stronghold), one roll button per roll
// (the macros' `RollButton` + `useRollControl`, sending a plain `dice.roll`), the DM's eye-off
// Badge on hidden rows, and the Edit / Delete menu where FR-REM-08 allows (Delete asks inline).
import type { ReminderRoll, ReminderView } from "@shared/reminders/schemas";
import { CastleIcon, EllipsisIcon, EyeOffIcon, PencilIcon, TrashIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/menus";
import { Badge } from "../../components/ui/primitives";
import { useSync } from "../../sync/store";
import { toastIntentError } from "../combat-tracker/store";
import { RollButton, useRollControl } from "../dice-roll-log/roll-control";
import {
  hiddenBadge,
  type RemCharacter,
  type RemViewer,
  reminderRollIntent,
  rollBlock,
} from "./logic";

function RollChip({
  roll,
  actor,
  viewer,
  entities,
}: {
  roll: ReminderRoll;
  actor: string | null;
  viewer: RemViewer;
  entities: readonly RemCharacter[];
}) {
  const live = useSync((s) => s.state === "live");
  const connection = useSync((s) => s.connection);
  const who = actor ? entities.find((c) => c.id === actor) : undefined;
  const block = rollBlock(actor, viewer, entities, live);
  const control = useRollControl({
    expressions: [roll.expression],
    category: roll.category,
    label: who ? `${who.name} — ${roll.label}` : roll.label,
    onRoll: (r) => {
      connection
        .sendIntent("dice.roll", reminderRollIntent(roll, actor, r))
        .catch(toastIntentError);
    },
  });
  return (
    <RollButton
      control={control}
      hint={block ?? `${roll.label}: ${roll.expression}`}
      data-testid="rem-row-roll"
      data-record-id={roll.id}
      data-actor={actor ?? ""}
      size="sm"
      variant="outline"
      className="h-7 max-w-full gap-1 px-2"
      disabled={block !== null}
      data-reason={block ?? undefined}
    >
      <span className="truncate">{roll.label}</span>
      <span className="shrink-0 font-mono text-xs text-muted-foreground">{roll.expression}</span>
    </RollButton>
  );
}

export function ReminderRow({
  r,
  viewer,
  entities,
  actor,
  canEdit,
  onEdit,
  onOpenLink,
}: {
  r: ReminderView;
  viewer: RemViewer;
  entities: readonly RemCharacter[];
  /** The roll-as character (FR-REM-21), null = "Me" / "DM". */
  actor: string | null;
  canEdit: boolean;
  onEdit: (r: ReminderView) => void;
  /** Opens the Stronghold window on the link (FR-HOLD-23); absent → no link icon. */
  onOpenLink?: (strongholdId: string) => void;
}) {
  const live = useSync((s) => s.state === "live");
  const connection = useSync((s) => s.connection);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const hidden = viewer.role === "dm" ? hiddenBadge(r) : null;
  const remove = async () => {
    setBusy(true);
    try {
      await connection.sendIntent("rem.delete", { id: r.id });
    } catch (err) {
      toastIntentError(err);
      setBusy(false);
      setConfirm(false);
    }
  };
  return (
    <li
      data-testid="rem-row"
      data-record-id={r.id}
      data-dm-only={hidden !== null}
      className="flex min-w-0 flex-col gap-1 rounded-md border px-2 py-1.5"
    >
      <div className="flex min-w-0 items-start gap-1.5">
        <p
          data-testid="rem-row-text"
          className="min-w-0 flex-1 text-sm break-words whitespace-pre-wrap"
        >
          {r.text}
        </p>
        {hidden && (
          <Badge variant="outline" className="shrink-0 gap-1 text-[10px] text-muted-foreground">
            <EyeOffIcon className="size-3" aria-hidden />
            {hidden}
          </Badge>
        )}
        {canEdit &&
          (confirm ? (
            <span className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                data-testid="rem-row-delete-confirm"
                size="sm"
                variant="destructive"
                className="h-7"
                disabled={!live || busy}
                onClick={() => void remove()}
              >
                Delete?
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7"
                onClick={() => setConfirm(false)}
              >
                Cancel
              </Button>
            </span>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  data-testid="rem-row-menu"
                  aria-label="Reminder actions"
                  size="icon"
                  variant="ghost"
                  className="size-7 shrink-0"
                  disabled={!live}
                >
                  <EllipsisIcon className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem data-testid="rem-row-edit" onSelect={() => onEdit(r)}>
                  <PencilIcon /> Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-testid="rem-row-delete"
                  variant="destructive"
                  onSelect={() => setConfirm(true)}
                >
                  <TrashIcon /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ))}
      </div>
      {r.source !== "" && (
        <p
          data-testid="rem-row-source"
          className="flex min-w-0 items-center gap-1 text-xs break-words text-muted-foreground"
        >
          {r.strongholdId && onOpenLink && (
            <button
              type="button"
              data-testid="rem-row-link"
              aria-label="Open the stronghold"
              className="shrink-0 rounded-sm hover:text-foreground"
              onClick={() => r.strongholdId && onOpenLink(r.strongholdId)}
            >
              <CastleIcon className="size-3.5" />
            </button>
          )}
          <span className="min-w-0">{r.source}</span>
        </p>
      )}
      {r.rolls.length > 0 && (
        <div className="flex min-w-0 flex-wrap gap-1">
          {r.rolls.map((roll) => (
            <RollChip key={roll.id} roll={roll} actor={actor} viewer={viewer} entities={entities} />
          ))}
        </div>
      )}
    </li>
  );
}
