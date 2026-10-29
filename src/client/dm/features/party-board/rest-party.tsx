// Party Manager's **Rest the party…** (FR-PARTY-79, DM): Party status header button → dialog with
// Short rest / Long rest (CHARX's shared choice, reset line and encounter warning), a checklist of
// the campaign's characters (all ticked) and the confirm: one `char.rest` for the ticked ones.
import { restLabel } from "@shared/character-sheet/rest";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import type { RestKind } from "@shared/events/character-sheet";
import { Button } from "@ui/components/ui/button";
import { Checkbox } from "@ui/components/ui/controls";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ui/components/ui/overlays";
import { Label } from "@ui/components/ui/primitives";
import { RestKindToggle, RestNotes, sendRest } from "@ui/features/character-sheet/rest";
import { toastIntentError } from "@ui/features/character-sheet/sheet-context";
import { useRecords, useSync } from "@ui/sync/store";
import { TentIcon } from "lucide-react";
import { useMemo, useState } from "react";

export const REST_PARTY_LABEL = "Rest the party…";

interface PartyMember {
  id: string;
  name: string;
}

/** FR-PARTY-79: the campaign's characters by name (the DM's store holds every one). */
export function partyMembers(entities: readonly unknown[]): PartyMember[] {
  const out: PartyMember[] = [];
  for (const e of entities) {
    const r = e as { id?: unknown; kind?: unknown; name?: unknown };
    if (r.kind === "character" && typeof r.id === "string" && typeof r.name === "string") {
      out.push({ id: r.id, name: r.name });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1));
}

function RestPartyDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange(o: boolean): void;
}) {
  const entities = useRecords<unknown>(ENTITY_TYPE);
  const members = useMemo(() => partyMembers(entities), [entities]);
  const live = useSync((s) => s.state === "live");
  const connection = useSync((s) => s.connection);
  const [kind, setKind] = useState<RestKind>("short");
  // Unticked ids: a character added while the dialog is open starts ticked.
  const [off, setOff] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const ticked = members.filter((m) => !off.has(m.id)).map((m) => m.id);
  const toggle = (id: string, on: boolean) =>
    setOff((prev) => {
      const next = new Set(prev);
      if (on) next.delete(id);
      else next.add(id);
      return next;
    });
  const confirm = () => {
    setBusy(true);
    sendRest((n, p) => connection.sendIntent(n, p), ticked, kind)
      .then(() => onOpenChange(false))
      .catch(toastIntentError)
      .finally(() => setBusy(false));
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="party-rest-dialog" className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Rest the party</DialogTitle>
          <DialogDescription className="sr-only">
            Pick the rest and the characters who take it
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <RestKindToggle value={kind} onChange={setKind} prefix="party-rest" />
          <RestNotes kind={kind} prefix="party-rest" />
          <ul aria-label="Characters" className="flex flex-col gap-1.5">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-2">
                <Checkbox
                  id={`party-rest-${m.id}`}
                  data-testid="party-rest-character"
                  data-record-id={m.id}
                  checked={!off.has(m.id)}
                  onCheckedChange={(v) => toggle(m.id, v === true)}
                />
                <Label htmlFor={`party-rest-${m.id}`} className="font-normal">
                  {m.name}
                </Label>
              </li>
            ))}
          </ul>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            data-testid="party-rest-cancel"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            data-testid="party-rest-confirm"
            disabled={!live || busy || ticked.length === 0}
            onClick={confirm}
          >
            {restLabel(kind)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The Party status header button (kit small button, as New pet…); the dialog opens fresh. */
export function RestPartyButton({ disabled }: { disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [round, setRound] = useState(0);
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-6 shrink-0 gap-1.5 px-[9px] text-[13px]"
        data-testid="party-rest-open"
        disabled={disabled}
        onClick={() => {
          setRound((n) => n + 1);
          setOpen(true);
        }}
      >
        <TentIcon className="size-3.5" />
        {REST_PARTY_LABEL}
      </Button>
      <RestPartyDialog key={round} open={open} onOpenChange={setOpen} />
    </>
  );
}
