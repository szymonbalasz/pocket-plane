// Trigger editor (FR-MOD-50, MOD §7 "Trigger editor"; Dialog ~480 px), both clients: sections
// When (event, requires), Only if (filter rows: kind Select + its fields, "soft" where §8.4 allows
// it), How often (frequency; feature rows with uses), Then (effect: formula with inline parse
// errors and the owner's value now, damage type, mode, reminder text), Shown to players; sentence
// preview; Save sends `mod.putTrigger` (FR-MOD-45). Also opened for monster definitions (FR-MOD-28).
import { FORMULA_MAX_CHARS, formulaValue, parseFormula } from "@shared/effect-modifiers/formula";
import { builtinPresets } from "@shared/effect-modifiers/presets";
import { hasUses } from "@shared/effect-modifiers/rules";
import {
  MODIFIER_ABILITIES,
  MODIFIER_DAMAGE_TYPES,
  ROLL_KINDS,
  type RollKind,
} from "@shared/effect-modifiers/schemas";
import { TRIGGER_INTENTS } from "@shared/effect-modifiers/trigger-intents";
import { TRIGGER_NAME_MAX } from "@shared/effect-modifiers/trigger-records";
import { builtinName, triggerSentence } from "@shared/effect-modifiers/trigger-words";
import {
  ASK_NOTE_MAX,
  REMIND_TEXT_MAX,
  TO_HIT_MODES,
  TRIGGER_EVENTS,
  TRIGGER_FILTERS_MAX,
  type TriggerEvent,
  type TriggerFilterKind,
} from "@shared/effect-modifiers/triggers";
import type { Ability } from "@shared/entities/schemas";
import type { RecordStore } from "@shared/protocol/store";
import { PlusIcon, XIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/controls";
import { Switch, ToggleGroup, ToggleGroupItem } from "../../components/ui/menus";
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
} from "../../components/ui/overlays";
import { Input, Label } from "../../components/ui/primitives";
import { useSync } from "../../sync/store";
import { presetsIn, useModIntent } from "./store";
import {
  type EffectKind,
  type EveryDraft,
  effectKinds,
  everyOptions,
  type FilterDraft,
  filterKinds,
  NO_REQUIRES,
  nameValid,
  newFilter,
  putTriggerPayload,
  ruleOfDraft,
  type ToHitMode,
  type TriggerDraft,
  type TypeDraft,
  withEvent,
} from "./trigger-editor-model";
import {
  type TriggerOwnerFacts,
  type TriggerOwnerRef,
  triggerOwnerFacts,
  wordsContext,
} from "./trigger-owner";

const EVENT_LABEL: Readonly<Record<TriggerEvent, string>> = {
  hit: "A hit (offered with the damage)",
  roll: "A roll",
  turnStart: "Its turn starts (reminder)",
};

const FILTER_LABEL: Readonly<Record<TriggerFilterKind, string>> = {
  via: "Via",
  row: "Attack or spell named",
  roll: "Roll",
  ownTurn: "On its own turn",
  crit: "Critical hit",
  mode: "To-hit mode",
  targetMarked: "Target marked",
  targetHurt: "Target hurt",
  ask: "DM checks",
};

const EVERY_LABEL: Readonly<Record<EveryDraft, string>> = {
  each: "Every time",
  turn: "Once per turn",
  round: "Once per round",
  encounter: "Once per encounter",
  feature: "Spends a feature use",
};

const EFFECT_LABEL: Readonly<Record<EffectKind, string>> = {
  damage: "Extra damage",
  part: "Add to the roll",
  mode: "Advantage / disadvantage",
  remind: "Reminder",
};

const ROLL_LABEL: Readonly<Record<RollKind, string>> = {
  attack: "Attack",
  damage: "Damage",
  save: "Save",
  check: "Check",
  initiative: "Initiative",
};

const MODE_LABEL: Readonly<Record<ToHitMode, string>> = {
  normal: "Normal",
  advantage: "Adv",
  disadvantage: "Dis",
};

const NONE = "none";
/** A player's redacted ref in a Select (FR-MOD-47): shown, never sent. */
const REDACTED = "redacted";

/** The Selects' preset options: built-ins, the owner's presets, campaign presets (DM only holds). */
function presetOptions(store: RecordStore, owner: TriggerOwnerRef) {
  const all = presetsIn(store);
  return {
    requires: [
      ...builtinPresets().map((b) => ({ value: b.key, label: `${b.name} (built-in)` })),
      ...all
        .filter((p) => owner.kind === "character" && p.characterId === owner.id)
        .map((p) => ({ value: p.id, label: p.name })),
      ...all
        .filter((p) => p.characterId === null)
        .map((p) => ({ value: p.id, label: `${p.name} (campaign)` })),
    ],
    marks: [
      { value: "hunters-mark", label: builtinName("hunters-mark") },
      ...all
        .filter((p) => p.characterId === null)
        .map((p) => ({ value: p.id, label: `${p.name} (campaign)` })),
    ],
  };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="grid gap-2">
      <legend className="pb-1 text-xs font-medium uppercase text-muted-foreground">{title}</legend>
      {children}
    </fieldset>
  );
}

function SmallSelect<V extends string>({
  value,
  onChange,
  options,
  testId,
  label,
  className = "w-40",
  disabled,
}: {
  value: V;
  onChange(v: V): void;
  options: readonly { value: V; label: string }[];
  testId: string;
  label: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <Select value={value} disabled={disabled} onValueChange={(v) => onChange(v as V)}>
      <SelectTrigger data-testid={testId} aria-label={label} className={`h-8 ${className}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem
            key={o.value}
            value={o.value}
            data-testid={`${testId}-option`}
            data-value={o.value}
          >
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function FilterFields({
  f,
  on,
  marks,
  onChange,
}: {
  f: FilterDraft;
  on: TriggerEvent;
  marks: readonly { value: string; label: string }[];
  onChange(f: FilterDraft): void;
}) {
  switch (f.kind) {
    case "via":
      return (
        <SmallSelect
          value={f.via}
          onChange={(via) => onChange({ ...f, via })}
          options={[
            { value: "weapon", label: "Weapon" },
            { value: "spell", label: "Spell" },
          ]}
          testId="mod-trig-editor-filter-via"
          label="Via"
          className="w-28"
        />
      );
    case "row":
      return (
        <Input
          data-testid="mod-trig-editor-filter-names"
          aria-label="Names, comma-separated"
          placeholder="Greataxe, Handaxe"
          className="h-8 w-48"
          value={f.names}
          onChange={(e) => onChange({ ...f, names: e.target.value })}
        />
      );
    case "roll":
      return (
        <div className="flex flex-wrap items-center gap-1">
          <SmallSelect
            value={f.roll}
            onChange={(roll) => onChange({ ...f, roll })}
            options={ROLL_KINDS.map((r) => ({ value: r, label: ROLL_LABEL[r] }))}
            testId="mod-trig-editor-filter-roll"
            label="Roll"
            className="w-28"
          />
          {(f.roll === "attack" || f.roll === "damage") && (
            <SmallSelect
              value={f.rollVia}
              onChange={(rollVia) => onChange({ ...f, rollVia })}
              options={[
                { value: "any", label: "Any" },
                { value: "weapon", label: "Weapon" },
                { value: "spell", label: "Spell" },
              ]}
              testId="mod-trig-editor-filter-roll-via"
              label="Via"
              className="w-24"
            />
          )}
          {(f.roll === "save" || f.roll === "check") && (
            <ToggleGroup
              type="multiple"
              value={f.abilities}
              onValueChange={(v) => onChange({ ...f, abilities: v as Ability[] })}
              className="justify-start"
              aria-label="Abilities (none = all)"
            >
              {MODIFIER_ABILITIES.map((a) => (
                <ToggleGroupItem
                  key={a}
                  value={a}
                  data-testid="mod-trig-editor-filter-ability"
                  data-value={a}
                  className="h-6 w-auto px-1.5 text-xs uppercase"
                >
                  {a}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
        </div>
      );
    case "mode":
      return (
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            type="multiple"
            value={f.modes}
            onValueChange={(v) => onChange({ ...f, modes: v as ToHitMode[] })}
            className="justify-start"
            aria-label="To-hit modes"
          >
            {TO_HIT_MODES.map((m) => (
              <ToggleGroupItem
                key={m}
                value={m}
                data-testid="mod-trig-editor-filter-mode"
                data-value={m}
                className="h-6 w-auto px-1.5 text-xs"
              >
                {MODE_LABEL[m]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {on === "hit" && (
            <span className="flex items-center gap-1 text-xs">
              <Checkbox
                data-testid="mod-trig-editor-filter-soft"
                aria-label="Soft: only decides the tick"
                checked={f.soft}
                onCheckedChange={(v) => onChange({ ...f, soft: v === true })}
              />
              Soft
            </span>
          )}
        </div>
      );
    case "targetMarked":
      return (
        <SmallSelect
          value={f.presetName !== null ? REDACTED : f.preset}
          onChange={(v) => v !== REDACTED && onChange({ ...f, preset: v, presetName: null })}
          options={[
            ...marks,
            ...(f.presetName !== null
              ? [{ value: REDACTED, label: `${f.presetName} (DM's preset)` }]
              : []),
          ]}
          testId="mod-trig-editor-filter-preset"
          label="Mark"
          className="w-44"
        />
      );
    case "ask":
      return (
        <Input
          data-testid="mod-trig-editor-filter-note"
          aria-label="What the DM checks"
          placeholder="an ally within 5 ft of the target"
          maxLength={ASK_NOTE_MAX}
          className="h-8 w-56"
          value={f.note}
          onChange={(e) => onChange({ ...f, note: e.target.value })}
        />
      );
    default:
      return null;
  }
}

/** FR-MOD-34: inline parse / evaluation errors and the owner's value now ("Brakka now: 1d6+2"). */
function FormulaField({
  label,
  value,
  onChange,
  facts,
  optional,
}: {
  label: string;
  value: string;
  onChange(v: string): void;
  facts: TriggerOwnerFacts;
  optional?: boolean;
}) {
  const src = value.trim();
  const parsed = src === "" ? null : parseFormula(src);
  const evaluated = parsed?.ok && facts.values ? formulaValue(src, facts.values) : null;
  const error =
    src === ""
      ? optional
        ? null
        : "A formula is required"
      : parsed && !parsed.ok
        ? parsed.error.message
        : evaluated && !evaluated.ok
          ? evaluated.error.message
          : null;
  return (
    <div className="grid gap-1">
      <Label htmlFor="mod-trig-formula">{label}</Label>
      <Input
        id="mod-trig-formula"
        data-testid="mod-trig-editor-formula"
        className="h-8 font-mono"
        maxLength={FORMULA_MAX_CHARS}
        placeholder="1d6 + floor(level(barbarian) / 2)"
        aria-invalid={error !== null}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {error !== null ? (
        <p data-testid="mod-trig-editor-formula-error" className="text-xs text-destructive">
          {error}
        </p>
      ) : evaluated?.ok ? (
        <p
          data-testid="mod-trig-editor-formula-value"
          data-value={evaluated.value.expression ?? "0"}
          className="text-xs text-muted-foreground"
        >
          {facts.name} now: {evaluated.value.expression ?? "nothing (0)"}
        </p>
      ) : null}
    </div>
  );
}

export interface TriggerEditorStart {
  owner: TriggerOwnerRef;
  draft: TriggerDraft;
  /** Set = edit (replace) this trigger. */
  id?: string;
  title: string;
}

/** The editor's form (exported for static-render tests; the Dialog wraps it). */
export function TriggerForm({ start, onDone }: { start: TriggerEditorStart; onDone(): void }) {
  const store = useSync((s) => s.store);
  const { send, disabled } = useModIntent();
  const [d, setD] = useState<TriggerDraft>(start.draft);
  const { owner } = start;
  const facts = triggerOwnerFacts(store, owner);
  const options = presetOptions(store, owner);
  const features = (facts.features ?? []).filter(hasUses);
  const set = (patch: Partial<TriggerDraft>) => setD((x) => ({ ...x, ...patch }));
  const setFilter = (i: number, f: FilterDraft) =>
    setD((x) => ({ ...x, when: x.when.map((g, j) => (j === i ? f : g)) }));
  const built = ruleOfDraft(d);
  const valid = built.ok && nameValid(d.name);
  const cx = wordsContext(store, facts.features);
  const kinds = filterKinds(d.on);
  const save = async () => {
    if (!built.ok || !valid) return;
    const ref = owner.kind === "character" ? { characterId: owner.id } : { definitionId: owner.id };
    const r = await send(
      TRIGGER_INTENTS.putTrigger,
      putTriggerPayload(d, built.rule, ref, start.id),
    );
    if (r !== undefined) onDone();
  };
  return (
    <form
      data-testid="mod-trig-editor"
      className="flex min-h-0 flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="-mx-1 grid min-h-0 gap-4 overflow-y-auto px-1">
        <div className="grid gap-1.5">
          <Label htmlFor="mod-trig-name">Name</Label>
          <Input
            id="mod-trig-name"
            data-testid="mod-trig-editor-name"
            maxLength={TRIGGER_NAME_MAX}
            autoFocus
            value={d.name}
            onChange={(e) => set({ name: e.target.value })}
          />
        </div>
        <Section title="When">
          <div className="flex flex-wrap items-center gap-2">
            <SmallSelect
              value={d.on}
              onChange={(on) => setD((x) => withEvent(x, on, owner.kind))}
              options={TRIGGER_EVENTS.map((e) => ({ value: e, label: EVENT_LABEL[e] }))}
              testId="mod-trig-editor-event"
              label="Event"
              className="w-60"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">While on</span>
            <SmallSelect
              value={d.requiresName !== null ? REDACTED : d.requires || NONE}
              onChange={(v) =>
                v !== REDACTED &&
                set({ requires: v === NONE ? NO_REQUIRES : v, requiresName: null })
              }
              options={[
                { value: NONE, label: "Always (no effect needed)" },
                ...options.requires,
                ...(d.requiresName !== null
                  ? [{ value: REDACTED, label: `${d.requiresName} (DM's preset)` }]
                  : []),
              ]}
              testId="mod-trig-editor-requires"
              label="Requires an active effect"
              className="w-56"
            />
          </div>
        </Section>
        <Section title="Only if">
          {d.when.length === 0 && <p className="text-xs text-muted-foreground">No conditions</p>}
          {d.when.map((f, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: filter rows have no identity; order is the key.
              key={i}
              data-testid="mod-trig-editor-filter"
              data-value={f.kind}
              className="flex flex-wrap items-center gap-1 rounded-md border p-1.5"
            >
              <SmallSelect
                value={f.kind}
                onChange={(k) => setFilter(i, { ...newFilter(k) })}
                options={kinds.map((k) => ({ value: k, label: FILTER_LABEL[k] }))}
                testId="mod-trig-editor-filter-kind"
                label="Condition"
                className="w-44"
              />
              <FilterFields
                f={f}
                on={d.on}
                marks={options.marks}
                onChange={(g) => setFilter(i, g)}
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="ml-auto size-7"
                data-testid="mod-trig-editor-filter-remove"
                aria-label="Remove condition"
                onClick={() => set({ when: d.when.filter((_, j) => j !== i) })}
              >
                <XIcon className="size-3.5" />
              </Button>
            </div>
          ))}
          {d.when.length < TRIGGER_FILTERS_MAX && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 w-fit"
              data-testid="mod-trig-editor-filter-add"
              onClick={() =>
                set({ when: [...d.when, newFilter(kinds.includes("via") ? "via" : "ownTurn")] })
              }
            >
              <PlusIcon /> Condition
            </Button>
          )}
        </Section>
        <Section title="How often">
          <div className="flex flex-wrap items-center gap-2">
            <SmallSelect
              value={d.every}
              onChange={(every) => set({ every })}
              options={everyOptions(d.on, owner.kind).map((e) => ({
                value: e,
                label: EVERY_LABEL[e],
              }))}
              testId="mod-trig-editor-every"
              label="Frequency"
              className="w-48"
            />
            {d.every === "feature" && (
              <SmallSelect
                value={d.feature || NONE}
                onChange={(v) => set({ feature: v === NONE ? "" : v })}
                options={[
                  { value: NONE, label: "Pick a feature" },
                  ...features.map((f) => ({ value: f.id, label: `${f.name} (${f.usesMax})` })),
                  ...(d.feature && !features.some((f) => f.id === d.feature)
                    ? [{ value: d.feature, label: "Uses link broken" }]
                    : []),
                ]}
                testId="mod-trig-editor-feature"
                label="Feature with uses"
                className="w-48"
              />
            )}
          </div>
        </Section>
        <Section title="Then">
          {effectKinds(d.on).length > 1 && (
            <SmallSelect
              value={d.effect}
              onChange={(effect) => set({ effect })}
              options={effectKinds(d.on).map((k) => ({ value: k, label: EFFECT_LABEL[k] }))}
              testId="mod-trig-editor-do"
              label="Effect"
              className="w-56"
            />
          )}
          {d.effect === "remind" && (
            <div className="grid gap-1">
              <Label htmlFor="mod-trig-text">Reminder ({"{value}"} = the value)</Label>
              <Input
                id="mod-trig-text"
                data-testid="mod-trig-editor-text"
                maxLength={REMIND_TEXT_MAX}
                placeholder="regain {value} HP unless it took acid or fire damage"
                value={d.text}
                onChange={(e) => set({ text: e.target.value })}
              />
            </div>
          )}
          {d.effect !== "mode" && (
            <FormulaField
              label={d.effect === "remind" ? "Value (optional formula)" : "Formula"}
              value={d.formula}
              onChange={(formula) => set({ formula })}
              facts={facts}
              optional={d.effect === "remind"}
            />
          )}
          {d.effect === "damage" && (
            <SmallSelect<TypeDraft>
              value={d.type}
              onChange={(type) => set({ type })}
              options={[
                { value: "attack", label: "The attack's type" },
                ...MODIFIER_DAMAGE_TYPES.map((t) => ({ value: t, label: t })),
              ]}
              testId="mod-trig-editor-type"
              label="Damage type"
              className="w-44"
            />
          )}
          {d.effect === "mode" && (
            <SmallSelect
              value={d.mode}
              onChange={(mode) => set({ mode })}
              options={[
                { value: "advantage", label: "Advantage" },
                { value: "disadvantage", label: "Disadvantage" },
              ]}
              testId="mod-trig-editor-mode"
              label="Mode"
            />
          )}
        </Section>
        <div className="flex items-center gap-2 text-sm">
          <Switch
            id="mod-trig-public"
            data-testid="mod-trig-editor-public"
            checked={d.public}
            onCheckedChange={(v) => set({ public: v })}
          />
          <Label htmlFor="mod-trig-public">Shown to players (name in public lines)</Label>
        </div>
        {built.ok ? (
          <p data-testid="mod-trig-editor-preview" className="text-sm text-muted-foreground">
            {triggerSentence(built.rule, cx)}
          </p>
        ) : (
          <p data-testid="mod-trig-editor-invalid" className="text-xs text-destructive">
            {built.message}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" data-testid="mod-trig-editor-save" disabled={disabled || !valid}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

/** New / edit / start-from trigger. `start` null = closed. */
export function TriggerEditorDialog({
  start,
  onClose,
}: {
  start: TriggerEditorStart | null;
  onClose(): void;
}) {
  const store = useSync((s) => s.store);
  const name = start ? triggerOwnerFacts(store, start.owner).name : "";
  return (
    <Dialog open={start !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        data-testid="mod-trig-editor-dialog"
        className="flex max-h-[85vh] flex-col sm:max-w-[480px]"
      >
        <DialogHeader>
          <DialogTitle>{start?.title ?? ""}</DialogTitle>
          <DialogDescription>
            {start?.owner.kind === "definition"
              ? `Monster trigger: ${name}`
              : `Rule trigger on ${name}`}
          </DialogDescription>
        </DialogHeader>
        {start && (
          <TriggerForm key={`${start.id ?? "new"}:${start.title}`} start={start} onDone={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}
