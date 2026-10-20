// Make pet / New pet (FR-ENT-32 UI, ENT §7 S6): one Dialog for the Creatures row action **Make
// pet…** (prefilled with the row's creature) and the Party Companions **New pet…** (FR-PARTY-43).
// Creature lookup (combat's autocomplete over the shared matcher, FR-CBT-63: "owl" → Owlbear;
// customs and pets from the store, imported monsters from the compendium search), "Pet of" PC
// Select (owner player beside each; a PC at 3 pets disabled, FR-ENT-35), name (prefilled with the
// server's free-name rule; "Name taken" inline before sending, FR-ENT-08), turn mode, Create →
// `POST /api/pets`. Server rejects show inline (`ent-pet-error`); the dialog stays open.
import type { PlayerRecord } from "@shared/campaign-management/schemas";
import { ENTITY_TYPE, type TurnMode } from "@shared/entities/schemas";
import { ApiError, NETWORK_STATUS } from "@ui/api";
import { Button } from "@ui/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@ui/components/ui/controls";
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
import { Badge, Input, Label } from "@ui/components/ui/primitives";
import type { LookupRow } from "@ui/features/combat-tracker/lookup";
import { CreatureLookup } from "@ui/features/combat-tracker/parts";
import { useCreatureLookup } from "@ui/features/compendium/lookup";
import { lazyApi } from "@ui/features/compendium/search";
import { useRecords } from "@ui/sync/store";
import { useMemo, useState } from "react";
import { creatureRows } from "./list";
import {
  monsterNameKeys,
  ownerOptions,
  PET_TURN_MODES,
  parsedEntities,
  petBody,
  petNameError,
  suggestedPetName,
  TURN_MODE_LABEL,
} from "./pet-logic";
import { petRest } from "./pet-rest";

/** The DM REST client, imported lazily (the session reads localStorage at import). */
const api = lazyApi(() => import("../campaign-management/session").then((m) => m.api));

/** FR-PARTY-43: a lost request (no answer) may still have created the pet. */
export const PET_LOST = "Connection lost — check the pet before trying again";

export interface PetBase {
  id: string;
  name: string;
  badge: string;
}

function PetForm({ base: initialBase, onDone }: { base: PetBase | null; onDone(): void }) {
  const raw = useRecords<unknown>(ENTITY_TYPE);
  const players = useRecords<PlayerRecord>("player");
  const entities = useMemo(() => parsedEntities(raw), [raw]);
  const owners = useMemo(() => ownerOptions(entities, players), [entities, players]);
  const taken = useMemo(() => monsterNameKeys(entities), [entities]);
  // Store rows (customs and pets) for the lookup; imported monsters come from the server.
  const storeRows: LookupRow[] = useMemo(
    () =>
      creatureRows(raw, [], players, "monster").map((r) => ({
        id: r.id,
        name: r.name,
        cr: r.cr,
        xp: r.xp,
        badge: r.badge,
      })),
    [raw, players],
  );
  const [q, setQ] = useState("");
  const options = useCreatureLookup(api, storeRows, q);

  const [base, setBase] = useState<PetBase | null>(initialBase);
  const [ownerId, setOwnerId] = useState<string | null>(
    owners.length === 1 && !owners[0]?.full ? (owners[0]?.id ?? null) : null,
  );
  const [mode, setMode] = useState<TurnMode>("after-owner");
  // The name follows the creature and owner until the DM types one.
  const [typed, setTyped] = useState<string | null>(null);
  const owner = owners.find((o) => o.id === ownerId) ?? null;
  const name = typed ?? (base ? suggestedPetName(base.name, owner?.name ?? null, taken) : "");
  // The prefilled name is checked once an owner gives it its free form (FR-ENT-32's rule).
  const nameError = typed === null && owner === null ? null : petNameError(name, taken);
  const body = petBody({ baseId: base?.id ?? null, ownerId, name, mode }, taken);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!body || saving) return;
    setSaving(true);
    setError(null);
    try {
      await petRest.create(body);
      onDone();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.status === NETWORK_STATUS
            ? PET_LOST
            : err.message
          : "Something went wrong",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="grid gap-1">
        <Label htmlFor="ent-pet-lookup">Creature</Label>
        {base && (
          <div
            data-testid="ent-pet-base"
            data-record-id={base.id}
            className="flex items-center gap-2 text-sm"
          >
            <span className="truncate font-medium">{base.name}</span>
            <Badge variant="outline">{base.badge}</Badge>
          </div>
        )}
        <CreatureLookup
          rows={options}
          testId="ent-pet-lookup"
          placeholder={base ? "Change creature…" : "Find a creature…"}
          onQueryChange={setQ}
          onPick={(id) => {
            const o = options.find((x) => x.id === id);
            if (o) setBase({ id: o.id, name: o.name, badge: o.badge });
          }}
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="ent-pet-owner">Pet of</Label>
        <Select value={ownerId ?? ""} onValueChange={(v) => setOwnerId(v)}>
          <SelectTrigger id="ent-pet-owner" data-testid="ent-pet-owner" className="min-w-0">
            <SelectValue placeholder="Choose a character" />
          </SelectTrigger>
          <SelectContent>
            {owners.map((o) => (
              <SelectItem
                key={o.id}
                value={o.id}
                disabled={o.full}
                data-testid="ent-pet-owner-option"
                data-record-id={o.id}
              >
                {o.name}
                <span className="text-muted-foreground">
                  {" "}
                  · {o.playerName}
                  {o.full ? ` · has ${o.pets} pets` : ""}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="ent-pet-name">Name</Label>
        <Input
          id="ent-pet-name"
          data-testid="ent-pet-name"
          value={name}
          aria-invalid={nameError !== null}
          onChange={(e) => setTyped(e.target.value)}
        />
        {nameError !== null && (
          <p data-testid="ent-pet-name-error" className="text-xs text-destructive">
            {nameError}
          </p>
        )}
      </div>
      <div className="grid gap-1">
        <Label>Turn</Label>
        <ToggleGroup
          type="single"
          aria-label="Turn mode"
          value={mode}
          onValueChange={(v) => v && setMode(v as TurnMode)}
          className="flex-wrap"
        >
          {PET_TURN_MODES.map((m) => (
            <ToggleGroupItem key={m} value={m} data-testid="ent-pet-mode" data-value={m}>
              {TURN_MODE_LABEL[m]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      {error !== null && (
        <p data-testid="ent-pet-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="submit" data-testid="ent-pet-submit" disabled={!body || saving}>
          Create
        </Button>
      </DialogFooter>
    </form>
  );
}

/** The Make pet / New pet Dialog; `base` prefills the creature (Make pet… on a row). */
export function PetDialog({
  open,
  onOpenChange,
  base = null,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  base?: PetBase | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="ent-pet-dialog" className="max-w-md">
        <DialogHeader>
          <DialogTitle>{base ? "Make pet" : "New pet"}</DialogTitle>
          <DialogDescription>
            The pet is its owner's own copy: its HP is kept between fights.
          </DialogDescription>
        </DialogHeader>
        {open && <PetForm base={base} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}
