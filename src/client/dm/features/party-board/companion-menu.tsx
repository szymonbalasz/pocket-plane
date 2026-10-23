// DM parts of the companion rows (FR-PARTY-43, sprint 6; in Party Manager's Party status tab since
// sprint 9, FR-PARTY-62): header **New pet…** (entities' dialog, FR-ENT-32) and the pet row menu: Rename, Turn mode ▸, Owner…, Open NPC sheet (FR-CHARX-31),
// Release… (confirm → `PUT` with `companionOf: null`, FR-ENT-33). Rename, mode and owner send the
// whole `PUT` with the loaded fields. While the pet is in a fight Owner… and Release… are disabled
// ("Dismiss it from the fight first"). A reject shows inline; a lost request → Toast.
import type { PlayerRecord } from "@shared/campaign-management/schemas";
import { ENTITY_TYPE, type TurnMode } from "@shared/entities/schemas";
import { ApiError, NETWORK_STATUS } from "@ui/api";
import { Button } from "@ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@ui/components/ui/menus";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ui/components/ui/overlays";
import { Input, Label } from "@ui/components/ui/primitives";
import { openSheetFor } from "@ui/features/character-sheet/selection";
import { CHAR_SHEET_KIND } from "@ui/features/character-sheet/window";
import type { CompanionsDmParts } from "@ui/features/party-board/Companions";
import { type CompanionRow, LOST_PET, PET_IN_FIGHT_HINT } from "@ui/features/party-board/logic";
import { useOpenWindow } from "@ui/features/play-shell/ShellContext";
import { useRecords } from "@ui/sync/store";
import { EllipsisVerticalIcon, PlusIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PetDialog } from "../entities/pet-dialog";
import {
  monsterNameKeys,
  ownerOptions,
  PET_TURN_MODES,
  parsedEntities,
  petNameError,
  TURN_MODE_LABEL,
} from "../entities/pet-logic";
import { type PetChange, petRest } from "../entities/pet-rest";

function NewPet({ disabled }: { disabled: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size="sm"
        className="h-6 px-2 text-xs"
        data-testid="party-companion-new"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <PlusIcon className="size-3.5" />
        New pet…
      </Button>
      <PetDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

/** One pet `PUT` in flight: reject → `error` (inline), lost → Toast (FR-PARTY-43). */
function usePetPut(row: CompanionRow) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async (change: PetChange): Promise<boolean> => {
    if (!row.record || busy) return false;
    setBusy(true);
    setError(null);
    try {
      await petRest.update(row.record, change);
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === NETWORK_STATUS) toast.error(LOST_PET);
      else setError(err instanceof ApiError ? err.message : "Something went wrong");
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, send };
}

type Open = "rename" | "owner" | "release" | null;

/** FR-PARTY-43: why Owner… and Release… are disabled (the pet is in a fight), else null. */
export const petMenuLock = (row: Pick<CompanionRow, "inCombat">) =>
  row.inCombat ? PET_IN_FIGHT_HINT : null;

function RowMenu({ row, disabled }: { row: CompanionRow; disabled: boolean }) {
  const openWindow = useOpenWindow();
  const put = usePetPut(row);
  const [open, setOpen] = useState<Open>(null);
  const show = (o: Open) => {
    put.setError(null);
    setOpen(o);
  };
  const close = () => setOpen(null);
  if (!row.record) return null;
  const pet = row.record;
  const fight = petMenuLock(row);
  return (
    <>
      {open === null && put.error && (
        <span role="alert" className="max-w-24 truncate text-xs text-destructive">
          {put.error}
        </span>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="size-5 shrink-0"
            aria-label={`Actions for ${row.name}`}
            data-testid="party-companion-menu"
            data-record-id={row.id}
            data-locked={fight !== null}
          >
            <EllipsisVerticalIcon className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            data-testid="party-companion-rename"
            disabled={disabled}
            onSelect={() => show("rename")}
          >
            Rename…
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={disabled}>Turn mode</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={pet.turnMode ?? "after-owner"}
                onValueChange={(v) => {
                  if (v !== pet.turnMode) void put.send({ turnMode: v as TurnMode });
                }}
              >
                {PET_TURN_MODES.map((m) => (
                  <DropdownMenuRadioItem
                    key={m}
                    value={m}
                    data-testid="party-companion-mode"
                    data-value={m}
                    disabled={disabled || put.busy}
                  >
                    {TURN_MODE_LABEL[m]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem
            data-testid="party-companion-owner"
            disabled={disabled || fight !== null}
            title={fight ?? undefined}
            onSelect={() => show("owner")}
          >
            Owner…
            {fight && <span className="ml-2 text-xs text-muted-foreground">{fight}</span>}
          </DropdownMenuItem>
          <DropdownMenuItem
            data-testid="party-companion-npc-sheet"
            onSelect={() => {
              openSheetFor(row.id, "monster");
              openWindow(CHAR_SHEET_KIND);
            }}
          >
            Open NPC sheet
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            data-testid="party-companion-release"
            disabled={disabled || fight !== null}
            title={fight ?? undefined}
            onSelect={() => show("release")}
          >
            Release…
            {fight && <span className="ml-2 text-xs text-muted-foreground">{fight}</span>}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={open !== null} onOpenChange={(o) => !o && close()}>
        <DialogContent data-testid="party-companion-dialog" className="max-w-sm">
          {open === "rename" && <RenameForm row={row} put={put} done={close} />}
          {open === "owner" && <OwnerForm row={row} put={put} done={close} />}
          {open === "release" && <ReleaseForm row={row} put={put} done={close} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

type Put = ReturnType<typeof usePetPut>;

function InlineError({ put }: { put: Put }) {
  return put.error ? (
    <p data-testid="party-companion-error" role="alert" className="text-sm text-destructive">
      {put.error}
    </p>
  ) : null;
}

function RenameForm({ row, put, done }: { row: CompanionRow; put: Put; done(): void }) {
  const raw = useRecords<unknown>(ENTITY_TYPE);
  const taken = useMemo(() => {
    const keys = monsterNameKeys(parsedEntities(raw));
    keys.delete(row.name.normalize("NFC").toLowerCase());
    return keys;
  }, [raw, row.name]);
  const [name, setName] = useState(row.name);
  const nameError = petNameError(name, taken);
  return (
    <form
      className="grid gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (nameError === null && (await put.send({ name: name.trim() }))) done();
      }}
    >
      <DialogHeader>
        <DialogTitle>Rename {row.name}</DialogTitle>
        <DialogDescription className="sr-only">The pet's new name</DialogDescription>
      </DialogHeader>
      <div className="grid gap-1">
        <Label htmlFor="party-companion-name-input">Name</Label>
        <Input
          id="party-companion-name-input"
          data-testid="party-companion-name-input"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
        {nameError && <p className="text-xs text-destructive">{nameError}</p>}
      </div>
      <InlineError put={put} />
      <DialogFooter>
        <Button
          type="submit"
          data-testid="party-companion-save"
          disabled={nameError !== null || name.trim() === row.name || put.busy}
        >
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

function OwnerForm({ row, put, done }: { row: CompanionRow; put: Put; done(): void }) {
  const raw = useRecords<unknown>(ENTITY_TYPE);
  const players = useRecords<PlayerRecord>("player");
  const owners = useMemo(() => ownerOptions(parsedEntities(raw), players), [raw, players]);
  const [ownerId, setOwnerId] = useState(row.ownerCharacterId);
  return (
    <form
      className="grid gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await put.send({ companionOf: ownerId })) done();
      }}
    >
      <DialogHeader>
        <DialogTitle>Owner of {row.name}</DialogTitle>
        <DialogDescription>Its tokens follow the new owner's player.</DialogDescription>
      </DialogHeader>
      <Select value={ownerId} onValueChange={setOwnerId}>
        <SelectTrigger data-testid="party-companion-owner-select" aria-label="Pet of">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {owners.map((o) => (
            <SelectItem
              key={o.id}
              value={o.id}
              disabled={o.full && o.id !== row.ownerCharacterId}
              data-testid="party-companion-owner-option"
              data-record-id={o.id}
            >
              {o.name}
              <span className="text-muted-foreground"> · {o.playerName}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <InlineError put={put} />
      <DialogFooter>
        <Button
          type="submit"
          data-testid="party-companion-owner-save"
          disabled={ownerId === row.ownerCharacterId || put.busy}
        >
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

function ReleaseForm({ row, put, done }: { row: CompanionRow; put: Put; done(): void }) {
  const raw = useRecords<unknown>(ENTITY_TYPE);
  const owner =
    (raw.find((e) => (e as { id?: string }).id === row.ownerCharacterId) as { name?: string })
      ?.name ?? "Its owner";
  return (
    <div className="grid gap-3">
      <DialogHeader>
        <DialogTitle>Release {row.name}?</DialogTitle>
        <DialogDescription>
          {row.name} becomes a plain creature. {owner} loses its card.
        </DialogDescription>
      </DialogHeader>
      <InlineError put={put} />
      <DialogFooter>
        <Button variant="ghost" onClick={done}>
          Keep
        </Button>
        <Button
          variant="destructive"
          data-testid="party-companion-release-confirm"
          disabled={put.busy}
          onClick={async () => {
            if (await put.send({ companionOf: null })) done();
          }}
        >
          Release
        </Button>
      </DialogFooter>
    </div>
  );
}

/** Passed to the shared `PartyBoard` by the DM's `party.board` window. */
export const dmCompanionParts: CompanionsDmParts = { header: NewPet, menu: RowMenu };
