// Preset form and effect-modifiers dialogs (FR-MOD-06/07/08, MOD §7), both clients: the sheet's
// Presets block (owner, DM) and the DM's preset manager / token menu use them. Edits live in
// dialog state; Save sends one intent (`mod.putPreset` / `mod.setModifiers`).
import { effectName } from "@shared/combat-extras/rules";
import type { EffectView } from "@shared/combat-extras/schemas";
import { MOD_INTENTS } from "@shared/effect-modifiers/intents";
import type { BuiltinPresetKey, Modifier } from "@shared/effect-modifiers/schemas";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/controls";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/overlays";
import { Input, Label } from "../../components/ui/primitives";
import { ModifierEditor } from "./editor";
import { draftOf, type ModDraft, modifiersOf } from "./editor-model";
import { useModIntent } from "./store";

/** What the form starts from: an existing row (edit), a built-in / preset ("Start from") or blank. */
export interface PresetDraft {
  id?: string;
  characterId: string | null;
  key?: BuiltinPresetKey | null;
  name: string;
  modifiers: Modifier[];
  durationRounds: number | null;
  concentration: boolean;
  note: string;
}

export const blankPreset = (characterId: string | null): PresetDraft => ({
  characterId,
  name: "",
  modifiers: [],
  durationRounds: null,
  concentration: false,
  note: "",
});

function parseRounds(s: string): number | null | undefined {
  if (s.trim() === "") return null;
  const n = Number(s);
  return Number.isInteger(n) && n >= 1 && n <= 100 ? n : undefined;
}

function PresetForm({ start, onDone }: { start: PresetDraft; onDone(): void }) {
  const { send, disabled } = useModIntent();
  const [name, setName] = useState(start.name);
  const [drafts, setDrafts] = useState<ModDraft[]>(start.modifiers.map(draftOf));
  const [duration, setDuration] = useState(
    start.durationRounds === null ? "" : String(start.durationRounds),
  );
  const [conc, setConc] = useState(start.concentration);
  const [note, setNote] = useState(start.note);
  const mods = modifiersOf(drafts, 1);
  const rounds = parseRounds(duration);
  const valid =
    mods !== null &&
    rounds !== undefined &&
    name.trim().length >= 1 &&
    name.trim().length <= 40 &&
    note.trim().length <= 200;
  const save = async () => {
    if (!valid) return;
    const r = await send(MOD_INTENTS.putPreset, {
      preset: {
        ...(start.id ? { id: start.id } : {}),
        characterId: start.characterId,
        ...(start.key ? { key: start.key } : {}),
        name: name.trim(),
        modifiers: mods,
        durationRounds: rounds,
        concentration: conc,
        note: note.trim(),
      },
    });
    if (r !== undefined) onDone();
  };
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="mod-preset-name">Name</Label>
        <Input
          id="mod-preset-name"
          data-testid="mod-preset-name"
          maxLength={40}
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <ModifierEditor drafts={drafts} onChange={setDrafts} disabled={disabled} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="mod-preset-duration">Duration (rounds)</Label>
          <Input
            id="mod-preset-duration"
            data-testid="mod-preset-duration"
            inputMode="numeric"
            className="h-8 w-28"
            placeholder="Until removed"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 pb-2 text-sm">
          <Checkbox
            id="mod-preset-conc"
            data-testid="mod-preset-concentration"
            checked={conc}
            onCheckedChange={(v) => setConc(v === true)}
          />
          <Label htmlFor="mod-preset-conc">Concentration</Label>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="mod-preset-note">Note</Label>
        <Input
          id="mod-preset-note"
          data-testid="mod-preset-note"
          maxLength={200}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" data-testid="mod-editor-save" disabled={disabled || !valid}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

/** New / edit / customise a preset. `start` null = closed. */
export function PresetDialog({
  start,
  title,
  onClose,
}: {
  start: PresetDraft | null;
  title: string;
  onClose(): void;
}) {
  return (
    <Dialog open={start !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="mod-preset-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {start?.characterId ? "A toggle on this character" : "Campaign preset"}
          </DialogDescription>
        </DialogHeader>
        {start && <PresetForm key={start.id ?? start.name} start={start} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function EffectModifiersForm({ effect, onDone }: { effect: EffectView; onDone(): void }) {
  const { send, disabled } = useModIntent();
  const [drafts, setDrafts] = useState<ModDraft[]>((effect.modifiers ?? []).map(draftOf));
  const mods = modifiersOf(drafts, 0);
  return (
    <>
      <ModifierEditor drafts={drafts} onChange={setDrafts} disabled={disabled} />
      <DialogFooter>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button
          data-testid="mod-editor-save"
          disabled={disabled || mods === null}
          onClick={async () => {
            if (mods === null) return;
            const r = await send(MOD_INTENTS.setModifiers, {
              effectId: effect.id,
              modifiers: mods,
            });
            if (r !== undefined) onDone();
          }}
        >
          Save
        </Button>
      </DialogFooter>
    </>
  );
}

/** FR-MOD-08 (DM): an active custom effect's modifiers; a copy, the preset is not changed. */
export function EffectModifiersDialog({
  effect,
  onClose,
}: {
  effect: EffectView | null;
  onClose(): void;
}) {
  return (
    <Dialog open={effect !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="mod-effect-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Modifiers: {effect ? effectName(effect) : ""}</DialogTitle>
          <DialogDescription>This effect only; its preset is not changed</DialogDescription>
        </DialogHeader>
        {effect && <EffectModifiersForm key={effect.id} effect={effect} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  );
}
