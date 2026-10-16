// MOD's `popupParts` line `effect-modifiers.triggers` (FR-MOD-39, -40; MOD §7 "Popup"): the
// card's offered rule-trigger parts as chips under their target rows. Tick, value edit, own
// multiplier, target Select (Hit rows); amber hints "Check: …" / "No target passes" / a
// conflict's message with a Force tick. Reads the card's settle facts and the DM store (effects,
// campaign presets), never `rule-trigger` rows (seams S1); sends nothing itself: its share joins
// each row's `cbt.applyCard` entry (`targets[].triggers`).
import { EFFECT_TYPE, type EffectView } from "@shared/combat-extras/schemas";
import type { DamageMultiplier } from "@shared/combat-tracker/schemas";
import { EFFECT_PRESET_TYPE, type EffectPresetRecord } from "@shared/effect-modifiers/schemas";
import type { SettleStore } from "@shared/effect-modifiers/settle";
import { Checkbox, ToggleGroup, ToggleGroupItem } from "@ui/components/ui/controls";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ui/components/ui/overlays";
import { Input } from "@ui/components/ui/primitives";
import { useRecords } from "@ui/sync/store";
import { useEffect, useMemo, useState } from "react";
// Types only: `popup-parts.ts` imports this line (no runtime cycle).
import type { PopupPart, PopupPartProps, PopupRowView } from "../combat-tracker/popup-parts";
import { defenseMultiplier } from "./popup-defense";
import {
  type ChipFacts,
  type ChipState,
  type ChipsValue,
  type ChipView,
  chipsExtra,
  chipsInput,
  chipViews,
  markUsed,
  touch,
} from "./popup-triggers-model";

const MULTS: readonly { m: DamageMultiplier; short: string; label: string }[] = [
  { m: "normal", short: "1×", label: "Normal" },
  { m: "half", short: "½", label: "Half" },
  { m: "none", short: "0", label: "None" },
  { m: "double", short: "2×", label: "Double" },
];

/** The DM store's facts the chips read: active effects (marks, defenses) and campaign presets. */
function useChipFacts(): ChipFacts {
  const effects = useRecords<EffectView>(EFFECT_TYPE);
  const presets = useRecords<EffectPresetRecord>(EFFECT_PRESET_TYPE);
  return useMemo(() => {
    const active = effects.filter((e) => (e.endedAt ?? null) === null);
    const store: SettleStore = {
      effects: active.map((e) => ({
        targetCombatantId: e.targetCombatantId,
        targetCharacterId: e.targetCharacterId,
        sourceCombatantId: e.sourceCombatantId ?? null,
        presetKey: e.presetKey ?? null,
        endedAt: e.endedAt ?? null,
      })),
      campaignPresets: presets.filter((p) => p.characterId === null),
    };
    return {
      store,
      defenseOf: (row: PopupRowView, type: string) => defenseMultiplier(active, row, type),
    };
  }, [effects, presets]);
}

function ValueInput({
  chip,
  disabled,
  onValue,
}: {
  chip: ChipView;
  disabled: boolean;
  onValue(v: number): void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Input
      type="number"
      min={0}
      max={999}
      inputMode="numeric"
      data-testid="mod-popup-part-value"
      data-record-id={chip.part.triggerId}
      aria-label={`${chip.part.label} damage`}
      className="h-6 w-14 px-1.5 text-xs tabular-nums"
      value={draft ?? String(chip.value)}
      disabled={disabled}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value !== "" && Number.isInteger(n) && n >= 0 && n <= 999) onValue(n);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

function Chip({
  chip,
  rows,
  disabled,
  set,
}: {
  chip: ChipView;
  rows: readonly PopupRowView[];
  disabled: boolean;
  set(patch: Partial<ChipState>): void;
}) {
  const id = chip.part.triggerId;
  const hits = rows.filter((r) => r.hit);
  const shownHit = hits.find((r) => r.targetId === chip.shownOn);
  return (
    <div className="grid gap-0.5">
      <div
        data-testid="mod-popup-part"
        data-record-id={id}
        data-state={chip.on ? "on" : "off"}
        className="flex flex-wrap items-center gap-1.5 rounded-md border px-1.5 py-1 text-xs"
      >
        <Checkbox
          data-testid="mod-popup-part-tick"
          data-record-id={id}
          aria-label={`Apply ${chip.part.label}`}
          checked={chip.on}
          disabled={disabled || hits.length === 0}
          onCheckedChange={(v) =>
            set({
              on: v === true,
              targetId: chip.targetId ?? shownHit?.targetId ?? hits[0]?.targetId ?? null,
            })
          }
        />
        <span className={chip.on ? "" : "text-muted-foreground"}>{chip.text}</span>
        <ValueInput chip={chip} disabled={disabled} onValue={(value) => set({ value })} />
        <ToggleGroup
          type="single"
          data-testid="mod-popup-part-mult"
          data-record-id={id}
          data-value={chip.multiplier}
          value={chip.multiplier}
          disabled={disabled}
          onValueChange={(v) => v && set({ multiplier: v as DamageMultiplier })}
        >
          {MULTS.map((x) => (
            <ToggleGroupItem
              key={x.m}
              value={x.m}
              aria-label={x.label}
              title={x.label}
              className="h-6 px-1.5 text-xs"
              data-testid="mod-popup-part-mult-option"
              data-value={x.m}
            >
              {x.short}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {hits.length > 0 && (
          <Select
            value={chip.targetId ?? ""}
            disabled={disabled}
            onValueChange={(targetId) => set({ targetId, on: true })}
          >
            <SelectTrigger
              data-testid="mod-popup-part-target"
              data-record-id={id}
              data-value={chip.targetId ?? ""}
              aria-label={`${chip.part.label} target`}
              className="h-6 w-28 min-w-0 px-1.5 text-xs"
            >
              <SelectValue placeholder="Target" />
            </SelectTrigger>
            <SelectContent>
              {hits.map((r) => (
                <SelectItem key={r.targetId} value={r.targetId} className="text-xs">
                  {r.combatant.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      {chip.hint && (
        <div
          data-testid="mod-popup-part-hint"
          data-record-id={id}
          data-value={chip.hint.kind}
          className="flex flex-wrap items-center gap-1.5 text-xs text-warning"
        >
          {chip.hint.text}
          {chip.hint.kind === "used" && (
            // biome-ignore lint/a11y/noLabelWithoutControl: the Checkbox inside is the control.
            <label className="flex items-center gap-1">
              <Checkbox
                data-testid="mod-popup-part-force"
                data-record-id={id}
                checked={chip.force}
                disabled={disabled}
                onCheckedChange={(v) => set({ force: v === true, on: true })}
              />
              Force
            </label>
          )}
        </div>
      )}
    </div>
  );
}

/** The chips shown under one row; the first row's instance keeps the line's resolved value current. */
function TriggerChips({ card, row, rows, value, onChange, disabled }: PopupPartProps<ChipsValue>) {
  const facts = useChipFacts();
  const touched = value?.touched ?? {};
  const chips = useMemo(() => chipViews(card, rows, touched, facts), [card, rows, touched, facts]);
  const first = rows[0]?.targetId === row.targetId;
  const resolved = JSON.stringify(chips);
  // `toInput` / `previewExtra` read the resolved chips; one row writes them (idempotent).
  useEffect(() => {
    if (first && resolved !== JSON.stringify(value?.chips ?? null)) onChange({ touched, chips });
  });
  const mine = chips.filter((c) => c.shownOn === row.targetId);
  if (mine.length === 0) return null;
  const set = (chip: ChipView) => (patch: Partial<ChipState>) => {
    const next = touch(value, chip, patch);
    onChange({ touched: next, chips: chipViews(card, rows, next, facts) });
  };
  return (
    <div data-testid="mod-popup-parts" data-record-id={row.targetId} className="grid gap-1">
      {mine.map((c) => (
        <Chip key={c.part.triggerId} chip={c} rows={rows} disabled={disabled} set={set(c)} />
      ))}
    </div>
  );
}

/** MOD's `popupParts` line (FR-MOD-39, -40): offered trigger parts → `targets[].triggers`. */
export const modTriggersPart = {
  id: "effect-modifiers.triggers",
  Chips: TriggerChips,
  toInput: (value: ChipsValue | undefined, row: PopupRowView) => chipsInput(value, row),
  previewExtra: (value: ChipsValue | undefined, row: PopupRowView) => chipsExtra(value, row),
  onReject: (value: ChipsValue | undefined, issues: readonly { path?: readonly unknown[] }[]) => {
    const touched = markUsed(value, issues);
    return touched && value ? { ...value, touched } : undefined;
  },
} as unknown as PopupPart; // type-erased as `definePopupPart` does
