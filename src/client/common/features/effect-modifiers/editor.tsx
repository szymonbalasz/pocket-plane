// Modifier editor (MOD §7): rows of Select (kind) + Select (roll) + ability ToggleGroup (saves,
// checks) / via Select (attacks, damage) + dice or value input; "Add modifier" up to 6; live
// sentence preview. Controlled: the parent holds the drafts. Shared by presets and effects.
import { MODIFIER_ABILITIES } from "@shared/effect-modifiers/schemas";
import type { Ability } from "@shared/entities/schemas";
import { PlusIcon, XIcon } from "lucide-react";
import { Button } from "../../components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/menus";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/overlays";
import { Input } from "../../components/ui/primitives";
import { modifiersText, modifierText } from "./describe";
import {
  type DraftVia,
  MODIFIERS_MAX,
  type ModDraft,
  modifierOf,
  newDraft,
  ROLL_KINDS,
  takesAbilities,
  takesVia,
} from "./editor-model";

const ROLL_LABEL = {
  attack: "Attack",
  damage: "Damage",
  save: "Save",
  check: "Check",
  initiative: "Initiative",
} as const;

function Row({
  d,
  onChange,
  onRemove,
  disabled,
}: {
  d: ModDraft;
  onChange(d: ModDraft): void;
  onRemove(): void;
  disabled?: boolean;
}) {
  const m = modifierOf(d);
  return (
    <div
      data-testid="mod-editor-row"
      data-state={m ? "valid" : "invalid"}
      className="grid gap-1 rounded-md border p-2"
    >
      <div className="flex flex-wrap items-center gap-1">
        <Select
          value={d.kind}
          disabled={disabled}
          onValueChange={(v) => onChange({ ...d, kind: v as ModDraft["kind"] })}
        >
          <SelectTrigger data-testid="mod-editor-kind" className="h-7 w-24" aria-label="Kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="dice" data-testid="mod-editor-kind-option" data-value="dice">
              Dice
            </SelectItem>
            <SelectItem value="flat" data-testid="mod-editor-kind-option" data-value="flat">
              Flat
            </SelectItem>
          </SelectContent>
        </Select>
        {d.kind === "dice" ? (
          <Input
            data-testid="mod-editor-dice"
            aria-label="Dice (minus to subtract)"
            className="h-7 w-20"
            placeholder="1d4"
            disabled={disabled}
            value={d.dice}
            onChange={(e) => onChange({ ...d, dice: e.target.value })}
          />
        ) : (
          <Input
            data-testid="mod-editor-value"
            aria-label="Value"
            inputMode="numeric"
            className="h-7 w-16"
            disabled={disabled}
            value={d.value}
            onChange={(e) => onChange({ ...d, value: e.target.value })}
          />
        )}
        <span className="text-xs text-muted-foreground">on</span>
        <Select
          value={d.roll}
          disabled={disabled}
          onValueChange={(v) => onChange({ ...d, roll: v as ModDraft["roll"] })}
        >
          <SelectTrigger data-testid="mod-editor-roll" className="h-7 w-28" aria-label="Roll">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROLL_KINDS.map((r) => (
              <SelectItem key={r} value={r} data-testid="mod-editor-roll-option" data-value={r}>
                {ROLL_LABEL[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {takesVia(d.roll) && (
          <Select
            value={d.via}
            disabled={disabled}
            onValueChange={(v) => onChange({ ...d, via: v as DraftVia })}
          >
            <SelectTrigger
              data-testid="mod-editor-via"
              className="h-7 w-24"
              aria-label="Weapon or spell"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any</SelectItem>
              <SelectItem value="weapon">Weapon</SelectItem>
              <SelectItem value="spell">Spell</SelectItem>
            </SelectContent>
          </Select>
        )}
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="ml-auto size-7"
          data-testid="mod-editor-remove"
          aria-label="Remove modifier"
          disabled={disabled}
          onClick={onRemove}
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>
      {takesAbilities(d.roll) && (
        <ToggleGroup
          type="multiple"
          value={d.abilities}
          disabled={disabled}
          onValueChange={(v) => onChange({ ...d, abilities: v as Ability[] })}
          className="justify-start"
          aria-label="Abilities (none = all)"
        >
          {MODIFIER_ABILITIES.map((a) => (
            <ToggleGroupItem
              key={a}
              value={a}
              data-testid="mod-editor-ability"
              data-value={a}
              className="h-6 w-auto px-1.5 text-xs uppercase"
            >
              {a}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}
      <p className="text-xs text-muted-foreground">
        {m ? modifierText(m) : "Dice like 1d4 (1–4 dice, d4–d12; minus to subtract) or −10…10"}
      </p>
    </div>
  );
}

export function ModifierEditor({
  drafts,
  onChange,
  disabled,
}: {
  drafts: ModDraft[];
  onChange(next: ModDraft[]): void;
  disabled?: boolean;
}) {
  const valid = drafts.map(modifierOf);
  const preview = valid.every((m) => m !== null)
    ? modifiersText(valid as NonNullable<(typeof valid)[number]>[])
    : "";
  return (
    <div className="grid gap-2">
      {drafts.map((d, i) => (
        <Row
          // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity besides position
          key={i}
          d={d}
          disabled={disabled}
          onChange={(nd) => onChange(drafts.map((x, j) => (j === i ? nd : x)))}
          onRemove={() => onChange(drafts.filter((_, j) => j !== i))}
        />
      ))}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7"
          data-testid="mod-editor-add"
          disabled={disabled || drafts.length >= MODIFIERS_MAX}
          onClick={() => onChange([...drafts, newDraft()])}
        >
          <PlusIcon /> Add modifier
        </Button>
        <span data-testid="mod-editor-preview" className="text-xs text-muted-foreground">
          {preview || (drafts.length === 0 ? "No modifiers" : "")}
        </span>
      </div>
    </div>
  );
}
