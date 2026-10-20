// **Add to party** (FR-CMP-40–42, CMP §7), DM only, on item entry views: Popover with a qty Input
// (default 1) + **Add** → party-board's `party.addItem`. FR-CMP-57: on ack the Popover reads
// "Added: ‹name› ×‹qty›" (the row's name after a merge) for 1.5 s, then closes; reject → inline,
// qty kept; lost intent → Toast. Disabled while not live.
import type { CompendiumEntry } from "@shared/compendium/schemas";
import { AddItemResult, PARTY_ITEM_TYPE, type PartyItemRecord } from "@shared/party-board/schemas";
import { Button } from "@ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@ui/components/ui/controls";
import { Input, Label } from "@ui/components/ui/primitives";
import { useLive } from "@ui/features/combat-tracker/store";
import { ITEM_INTENTS, LOST_ITEM_ADD } from "@ui/features/party-board/inventory-logic";
import { intentFailure } from "@ui/features/party-board/logic";
import { submitEnabled } from "@ui/features/party-loot/logic";
import { SyncContext, useSync } from "@ui/sync/store";
import { PackagePlusIcon } from "lucide-react";
import { type FormEvent, useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  type AddToPartyState,
  addToPartyHint,
  addToPartyPayload,
  CLOSED,
  DONE_MS,
  type SendOutcome,
  settle,
} from "./add-to-party";

type Entry = Pick<CompendiumEntry, "kind" | "name" | "source" | "shared">;

/** The Popover body (rendered on its own in tests). */
export function AddToPartyPanel({
  entry,
  qty,
  error,
  done,
  live,
  busy,
  onQty,
  onSubmit,
}: {
  entry: Entry;
  qty: string;
  error: string | null;
  /** FR-CMP-57: the confirmation after an ack (the form gives way to it). */
  done?: string;
  live: boolean;
  busy: boolean;
  onQty(v: string): void;
  onSubmit(): void;
}) {
  const parsed = addToPartyPayload(entry.name, qty);
  const enabled = submitEnabled({ valid: parsed.ok, live, busy });
  const hint = addToPartyHint(entry);
  // A rejected send wins; an invalid qty explains itself once the field isn't empty.
  const message = error ?? (!parsed.ok && qty !== "" ? parsed.message : null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (enabled) onSubmit();
  };
  if (done) {
    return (
      <p data-testid="cmp-add-to-party-done" role="status" className="text-sm">
        {done}
      </p>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex items-end gap-2">
        <div className="space-y-1">
          <Label className="text-xs" htmlFor="cmp-add-to-party-qty">
            Quantity
          </Label>
          <Input
            id="cmp-add-to-party-qty"
            data-testid="cmp-add-to-party-qty"
            inputMode="numeric"
            className="h-8 w-20 px-2 text-xs tabular-nums"
            value={qty}
            onChange={(e) => onQty(e.target.value)}
          />
        </div>
        <Button
          type="submit"
          size="sm"
          className="ml-auto h-8"
          data-testid="cmp-add-to-party-submit"
          disabled={!enabled}
        >
          Add
        </Button>
      </div>
      {hint && (
        <p data-testid="cmp-add-to-party-hint" className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {message && (
        <p data-testid="cmp-add-to-party-error" role="alert" className="text-xs text-destructive">
          {message}
        </p>
      )}
    </form>
  );
}

export function AddToParty({ entry }: { entry: Entry }) {
  const live = useLive();
  const connection = useSync((s) => s.connection);
  const sync = useContext(SyncContext);
  const [state, setState] = useState<AddToPartyState>(CLOSED);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const add = async () => {
    const parsed = addToPartyPayload(entry.name, state.qty);
    if (!parsed.ok || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    let outcome: SendOutcome;
    try {
      const result = AddItemResult.safeParse(
        await connection.sendIntent(ITEM_INTENTS.addItem, parsed.value),
      );
      const name = result.success ? await rowName(result.data.itemId) : null;
      outcome = { kind: "ack", name: name ?? parsed.value.name, qty: parsed.value.qty };
    } catch (err) {
      outcome = intentFailure(err, LOST_ITEM_ADD);
      if (outcome.kind === "toast") toast.error(outcome.message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
    setState((s) => settle(s, outcome));
  };

  // FR-CMP-57: the merged row's name ("Potion of healing"): from the store, else one-id load of the
  // lazy type (ADR-0045); unavailable → the name sent.
  const rowName = async (itemId: string): Promise<string | null> => {
    const read = () =>
      (sync?.getState().store.records[PARTY_ITEM_TYPE]?.[itemId] as PartyItemRecord | undefined)
        ?.name ?? null;
    const now = read();
    if (now !== null) return now;
    await connection.load(PARTY_ITEM_TYPE, [itemId])?.catch(() => {});
    return read();
  };

  const done = state.done;
  useEffect(() => {
    if (!done) return;
    const h = setTimeout(() => setState((s) => (s.done === done ? CLOSED : s)), DONE_MS);
    return () => clearTimeout(h);
  }, [done]);

  return (
    <Popover
      open={state.open}
      onOpenChange={(open) => setState(open ? { ...CLOSED, open } : CLOSED)}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          data-testid="cmp-add-to-party"
          disabled={!live}
        >
          <PackagePlusIcon className="size-3.5" /> Add to party
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3" data-testid="cmp-add-to-party-panel">
        <AddToPartyPanel
          entry={entry}
          qty={state.qty}
          error={state.error}
          done={state.done}
          live={live}
          busy={busy}
          onQty={(qty) => setState((s) => ({ ...s, qty, error: null }))}
          onSubmit={() => void add()}
        />
      </PopoverContent>
    </Popover>
  );
}
