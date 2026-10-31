// DM preset manager (FR-MOD-06, -28): "Edit presets…" from the apply dialog. Built-ins in order
// (a customised one marked "Customised", with Reset), then campaign presets (Delete); Edit
// customises a built-in (a campaign row with its key) or edits a row; New makes a campaign one.
import { MOD_INTENTS } from "@shared/effect-modifiers/intents";
import {
  choiceRowId,
  choiceValue,
  type PresetChoice,
  presetChoices,
} from "@shared/effect-modifiers/rules";
import { Button } from "@ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@ui/components/ui/overlays";
import { Badge } from "@ui/components/ui/primitives";
import { Tip } from "@ui/components/ui/tip";
import { modifiersText } from "@ui/features/effect-modifiers/describe";
import { blankPreset, PresetDialog, type PresetDraft } from "@ui/features/effect-modifiers/dialogs";
import { useModIntent, usePresets } from "@ui/features/effect-modifiers/store";
import { PencilIcon, PlusIcon, RotateCcwIcon, TrashIcon } from "lucide-react";
import { useState } from "react";

/** The form a row's Edit opens: a built-in → its customisation; a row → that row. */
export function editDraft(c: PresetChoice): PresetDraft {
  const p = c.preset;
  return {
    ...(choiceRowId(c) ? { id: choiceRowId(c) as string } : {}),
    characterId: null,
    key: c.key,
    name: p.name,
    modifiers: p.modifiers,
    durationRounds: p.durationRounds,
    concentration: p.concentration,
    note: p.note,
  };
}

function Row({ c, onEdit }: { c: PresetChoice; onEdit(): void }) {
  const { send, disabled } = useModIntent();
  const remove = () => void send(MOD_INTENTS.deletePreset, { presetId: choiceRowId(c) });
  return (
    <div
      data-testid="mod-presets-row"
      data-value={choiceValue(c)}
      data-state={c.source}
      className="flex items-center gap-2 text-sm"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1">
          <span className="min-w-0 break-words">{c.preset.name}</span>
          {c.source === "customised" && <Badge variant="secondary">Customised</Badge>}
        </div>
        <div className="text-xs break-words whitespace-pre-wrap text-muted-foreground">
          {modifiersText(c.preset.modifiers)}
          {c.preset.note ? ` · ${c.preset.note}` : ""}
        </div>
      </div>
      <Tip content={`Edit ${c.preset.name}`}>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          data-testid="mod-presets-edit"
          aria-label={`Edit ${c.preset.name}`}
          onClick={onEdit}
        >
          <PencilIcon className="size-3.5" />
        </Button>
      </Tip>
      {c.source === "customised" && (
        <Tip content={`Reset ${c.preset.name} to the built-in`} off={disabled}>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            data-testid="mod-presets-reset"
            aria-label={`Reset ${c.preset.name} to the built-in`}
            disabled={disabled}
            onClick={remove}
          >
            <RotateCcwIcon className="size-3.5" />
          </Button>
        </Tip>
      )}
      {c.source === "campaign" && (
        <Tip content={`Delete ${c.preset.name}`} off={disabled}>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            data-testid="mod-presets-delete"
            aria-label={`Delete ${c.preset.name}`}
            disabled={disabled}
            onClick={remove}
          >
            <TrashIcon className="size-3.5" />
          </Button>
        </Tip>
      )}
    </div>
  );
}

/** "Edit presets…" button + its Dialog (nested in the apply dialog). */
export function PresetManager() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ start: PresetDraft; title: string } | null>(null);
  const choices = presetChoices(usePresets());
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        className="mr-auto"
        data-testid="mod-presets-open"
        onClick={() => setOpen(true)}
      >
        Edit presets…
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="mod-presets" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Presets</DialogTitle>
            <DialogDescription>Edits change later applies only</DialogDescription>
          </DialogHeader>
          <div data-testid="mod-presets-list" className="grid max-h-96 gap-2 overflow-y-auto">
            {choices.map((c) => (
              <Row
                key={choiceValue(c)}
                c={c}
                onEdit={() =>
                  setForm({
                    start: editDraft(c),
                    title:
                      c.source === "builtin"
                        ? `Customise ${c.preset.name}`
                        : `Edit ${c.preset.name}`,
                  })
                }
              />
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="justify-self-start"
            data-testid="mod-presets-new"
            onClick={() => setForm({ start: blankPreset(null), title: "New campaign preset" })}
          >
            <PlusIcon /> New preset
          </Button>
        </DialogContent>
      </Dialog>
      <PresetDialog
        start={form?.start ?? null}
        title={form?.title ?? ""}
        onClose={() => setForm(null)}
      />
    </>
  );
}
