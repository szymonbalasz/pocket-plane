// Derive… (FR-CMP-27, DM) from a monster entry: the creature core prefilled from its definition,
// **Copy text** (traits / actions text → the NPC sheet's Features), `POST
// /api/compendium/derive-monster` (one transaction server side). Server errors inline; on save a
// Toast offers the new NPC's sheet.
import type { EntryResponse } from "@shared/compendium/rest";
import { CR_VALUES, SIZES, xpForCr } from "@shared/entities/schemas";
import { type Api, ApiError } from "@ui/api";
import { Button } from "@ui/components/ui/button";
import { Switch } from "@ui/components/ui/controls";
import {
  Dialog,
  DialogContent,
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
import { useLive } from "@ui/features/combat-tracker/store";
import { useOpenWindow } from "@ui/features/play-shell/ShellContext";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import {
  type DeriveFields,
  deriveStatBlock,
  entryOnlyBase,
  formulaAverage,
  initialDerive,
  type MonsterFacets,
} from "./derive-form";
import { deriveMonster } from "./homebrew-rest";

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1" data-testid="cmp-derive-field" data-field={id}>
      <Label htmlFor={`cmp-derive-${id}`} className="text-xs">
        {label}
      </Label>
      {children}
    </div>
  );
}

function DeriveForm({ api, data, close }: { api: Api; data: EntryResponse; close(): void }) {
  // FR-CMPX-08: no definition → the entry's size / type / CR, HP and AC left for the DM.
  const definition = data.definition ?? entryOnlyBase(data.entry.facets as MonsterFacets);
  const [f, setF] = useState<DeriveFields>(() =>
    data.definition
      ? initialDerive(data.entry.name, definition)
      : { ...initialDerive(data.entry.name, definition), ac: "", hpMax: "" },
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const live = useLive();
  const openWindow = useOpenWindow();
  const set = (k: keyof DeriveFields) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));
  const average = formulaAverage(f.hpFormula);
  const num = (k: keyof DeriveFields, label: string) => (
    <Field id={k} label={label}>
      <Input
        id={`cmp-derive-${k}`}
        className="h-8"
        inputMode="numeric"
        value={f[k] as string}
        onChange={set(k)}
      />
    </Field>
  );

  const save = async () => {
    const block = deriveStatBlock(f, definition);
    if (!block.ok) {
      setError(block.message);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { entity } = await deriveMonster(api, {
        entryId: data.entry.id,
        entity: { kind: "monster", name: f.name.trim(), statBlock: block.value },
        copyText: f.copyText,
      });
      close();
      toast.success(`Derived ${entity.name}`, {
        action: {
          label: "Open sheet",
          onClick: () => {
            openSheetFor(entity.id, "monster");
            openWindow(CHAR_SHEET_KIND);
          },
        },
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Derive creature</DialogTitle>
      </DialogHeader>
      <form
        className="grid grid-cols-2 gap-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="col-span-2">
          <Field id="name" label="Name">
            <Input
              id="cmp-derive-name"
              className="h-8"
              data-testid="cmp-derive-name"
              maxLength={80}
              value={f.name}
              autoFocus
              onChange={set("name")}
            />
          </Field>
        </div>
        <Field id="size" label="Size">
          <Select value={f.size} onValueChange={(v) => setF((x) => ({ ...x, size: v }))}>
            <SelectTrigger id="cmp-derive-size" className="h-8 min-w-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SIZES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field id="cr" label={`CR (${xpForCr(f.cr)} XP)`}>
          <Select value={f.cr} onValueChange={(v) => setF((x) => ({ ...x, cr: v }))}>
            <SelectTrigger id="cmp-derive-cr" className="h-8 min-w-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CR_VALUES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {num("ac", "AC")}
        {num("hpMax", "HP max")}
        <Field id="hpFormula" label="HP formula">
          <Input
            id="cmp-derive-hpFormula"
            className="h-8"
            placeholder="2d6"
            value={f.hpFormula}
            onChange={set("hpFormula")}
          />
          {average !== null && (
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              Average {average}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-6 px-1.5 text-xs"
                onClick={() => setF((x) => ({ ...x, hpMax: String(average) }))}
              >
                Use as HP max
              </Button>
            </span>
          )}
        </Field>
        {num("initBonus", "Initiative bonus")}
        {num("speed", "Speed (ft)")}
        <p className="col-span-2 text-xs text-muted-foreground">
          Attacks, ability scores, saves and senses are copied from {data.entry.name}.
        </p>
        <div className="col-span-2 flex items-center gap-2">
          <Switch
            id="cmp-derive-copy-text"
            data-testid="cmp-derive-copy-text"
            checked={f.copyText}
            onCheckedChange={(v) => setF((x) => ({ ...x, copyText: v }))}
          />
          <Label htmlFor="cmp-derive-copy-text">
            Copy traits and actions text to the NPC sheet
          </Label>
        </div>
        {error && (
          <p data-testid="cmp-derive-error" className="col-span-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter className="col-span-2">
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button data-testid="cmp-derive-save" type="submit" disabled={saving || !live}>
            Save
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

export function DeriveDialog({
  api,
  data,
  open,
  onClose,
}: {
  api: Api;
  data: EntryResponse;
  open: boolean;
  onClose(): void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        data-testid="cmp-derive-dialog"
        className="max-w-md"
        aria-describedby={undefined}
      >
        {open && <DeriveForm api={api} data={data} close={onClose} />}
      </DialogContent>
    </Dialog>
  );
}
