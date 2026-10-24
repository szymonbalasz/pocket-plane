// DM dialogs shared by the Strongholds tab and the Stronghold window: Rename (FR-HOLD-22, -24),
// Delete… with FR-HOLD-19's summary (Stores items load lazily while it is open; the coin is the
// snapshot's `stores-coin`), and the facility Remove… confirm (FR-HOLD-17). A reject stays inline
// in the open dialog (a full party inventory keeps the delete confirm open with the message).
import { PARTY_ITEM_TYPE, type PartyItemRecord } from "@shared/party-board/schemas";
import { coinsOf, STORES_COIN_TYPE, type StoresCoinRecord } from "@shared/party-loot/schemas";
import { REMINDER_TYPE } from "@shared/reminders/schemas";
import { HOLD_INTENTS, HOLD_NAME_MAX } from "@shared/strongholds/schemas";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "../../components/ui/overlays";
import { Input } from "../../components/ui/primitives";
import { useLazyRecords, useRecords } from "../../sync/store";
import { deleteBody, type LinkedReminder, strongholdReminderCount } from "./logic";
import { useHoldIntent, useLive } from "./send";

export function RenameDialog({
  hold,
  open,
  onOpenChange,
}: {
  hold: { id: string; name: string };
  open: boolean;
  onOpenChange(o: boolean): void;
}) {
  const live = useLive();
  const intent = useHoldIntent();
  const [name, setName] = useState(hold.name);
  useEffect(() => {
    if (open) setName(hold.name);
  }, [open, hold.name]);
  const clean = name.trim();
  const save = async () => {
    const r = await intent.send(HOLD_INTENTS.update, { strongholdId: hold.id, name: clean });
    if (r) onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-testid="hold-rename-dialog">
        <DialogTitle>Rename stronghold</DialogTitle>
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Input
            data-testid="hold-rename-name"
            aria-label="Name"
            value={name}
            maxLength={HOLD_NAME_MAX}
            onChange={(e) => setName(e.target.value)}
          />
          {intent.error && (
            <p role="alert" className="text-xs text-destructive" data-testid="hold-rename-error">
              {intent.error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              data-testid="hold-rename-save"
              disabled={!live || intent.busy || clean === "" || clean === hold.name}
            >
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A destructive confirm whose action may be rejected (message shown inline, dialog kept). */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  summary,
  action,
  testId,
  onConfirm,
  busy,
  error,
}: {
  open: boolean;
  onOpenChange(o: boolean): void;
  title: string;
  summary: ReactNode;
  action: string;
  testId: string;
  onConfirm(): void;
  busy: boolean;
  error: string | null;
}) {
  const live = useLive();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent role="alertdialog" className="max-w-sm" data-testid={`${testId}-dialog`}>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription data-testid={`${testId}-summary`}>{summary}</DialogDescription>
        {error && (
          <p role="alert" className="text-xs text-destructive" data-testid={`${testId}-error`}>
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            data-testid={`${testId}-confirm`}
            disabled={!live || busy}
            onClick={onConfirm}
          >
            {action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteBody({ hold }: { hold: { id: string; name: string } }) {
  const items = useLazyRecords<PartyItemRecord>(PARTY_ITEM_TYPE);
  const reminders = useLazyRecords<LinkedReminder>(REMINDER_TYPE);
  const coins = useRecords<StoresCoinRecord>(STORES_COIN_TYPE).find(
    (c) => c.strongholdId === hold.id,
  );
  if (items.state !== "ready" || reminders.state !== "ready") return <>Checking its Stores…</>;
  const stores = items.rows.filter((i) => i.strongholdId === hold.id).length;
  return (
    <>
      {deleteBody(
        strongholdReminderCount(hold.id, reminders.rows),
        stores,
        coins ? coinsOf(coins) : undefined,
      )}
    </>
  );
}

/** FR-HOLD-19: Delete… (DM). `onDeleted` runs after the server accepted it. */
export function DeleteDialog({
  hold,
  open,
  onOpenChange,
  onDeleted,
}: {
  hold: { id: string; name: string };
  open: boolean;
  onOpenChange(o: boolean): void;
  onDeleted?(): void;
}) {
  const intent = useHoldIntent();
  const { setError } = intent;
  useEffect(() => {
    if (open) setError(null);
  }, [open, setError]);
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete ${hold.name}?`}
      summary={open ? <DeleteBody hold={hold} /> : null}
      action="Delete"
      testId="hold-delete"
      busy={intent.busy}
      error={intent.error}
      onConfirm={async () => {
        const r = await intent.send(HOLD_INTENTS.delete, { strongholdId: hold.id });
        if (r) {
          onOpenChange(false);
          onDeleted?.();
        }
      }}
    />
  );
}
