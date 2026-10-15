// Shared roll control (FR-DICE-24): `useRollControl` + `RollButton`. Reads the Shift / Ctrl keys
// (FR-DICE-05) and physical-dice mode (FR-DICE-07); DM gets a public toggle preset from the
// category's setting (FR-DICE-13). The caller sends its own intent from `onRoll`. Physical mode
// is never a surprise (#149): every `RollButton` carries a marker, and the popover offers
// "Roll for me" (one server roll; the mode stays on).
import {
  CATEGORY_LABEL,
  categoryPublic,
  GAME_LOG_SETTINGS_TYPE,
  type GameLogSettingsRecord,
  type ManualEntry,
  type RollCategory,
  type RollMode,
} from "@shared/dice-roll-log/schemas";
import { HandIcon } from "lucide-react";
import { type ComponentProps, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "../../components/ui/controls";
import { Input } from "../../components/ui/primitives";
import { cn } from "../../lib/utils";
import { useRecords, useSync } from "../../sync/store";
import {
  computedTotal,
  formEntries,
  formSlots,
  type GroupInput,
  type ManualSlot,
  modeFromKeys,
  publicState,
  reconcileInputs,
  type SlotInput,
  updateInputs,
} from "./logic";
import { usePhysicalDice } from "./physical";

export interface RollRequest {
  mode: RollMode;
  /**
   * Physical-dice mode only: exactly one `ManualEntry` per expression, in `expressions` order
   * (sheet attack = [to-hit, damage]; after a natural 20 with `critExpressions`, or with
   * `crit: true`, the damage entries are for the crit expressions: base + extra dice,
   * FR-DICE-31). Callers map it onto their intent: `dice.roll` sends
   * `manual[0]`; `char.roll`, `cbt.attack`, `cbt.rollInitiative` send their manual count (1 / 2).
   * Absent = server rolls (FR-DICE-02).
   */
  manual?: ManualEntry[];
  /** DM only, and only when the DM changed the switch for this roll. */
  public?: boolean;
}

export interface RollControlOptions {
  /** Expressions rolled together (sheet attack = to-hit + damage). */
  expressions: readonly string[];
  category: RollCategory;
  /**
   * What the roll is for, e.g. "Mira — Dexterity save": the physical-dice popover's heading
   * (FR-DICE-07). Absent = the category's label.
   */
  label?: string;
  /**
   * The crit (doubled-dice) form of `expressions[1…]`, used when the first is a natural 20; with
   * `crit: true`, of `expressions[0…]`. The popover keeps the base inputs and adds the extra
   * critical dice (FR-DICE-31); the entries sent fit these expressions.
   */
  critExpressions?: readonly string[];
  /**
   * The caller already knows the hit is critical (a Damage roll after a natural-20 to-hit,
   * FR-CBT-74): every slot shows its extra critical group from the start (FR-DICE-31, X-1).
   */
  crit?: boolean;
  /** The mode toggle's value; Shift / Ctrl override it for one roll. Default normal. */
  mode?: RollMode;
  onRoll(r: RollRequest): void;
}

export interface RollControl {
  /** Roll now (or open the manual popover); pass the click / key event for Shift / Ctrl. */
  roll(keys?: { shiftKey?: boolean; ctrlKey?: boolean }): void;
  isDm: boolean;
  /** DM public switch value: the override, else the category's setting. */
  publicValue: boolean;
  /** DM: the category's setting (FR-DICE-13); `publicValue` differs = an override is set. */
  publicPreset: boolean;
  setPublic(v: boolean): void;
  physical: boolean;
  /** Open manual popover state, or null. */
  manual: { mode: RollMode } | null;
  cancelManual(): void;
  submitManual(entries: ManualEntry[]): void;
  /** Close the popover and let the server roll this one (mode stays on). */
  rollForMe(): void;
  /** Local error (e.g. an expression the popover can't lay out). */
  error: string | null;
  options: RollControlOptions;
}

export function useRollControl(options: RollControlOptions): RollControl {
  const isDm = useSync((s) => s.store.you?.role === "dm");
  const settings = useRecords<GameLogSettingsRecord>(GAME_LOG_SETTINGS_TYPE)[0];
  const preset = settings ? categoryPublic(settings, options.category) : false;
  const [override, setOverride] = useState<{ category: RollCategory; value: boolean } | null>(null);
  const pub = publicState(preset, options.category, override);
  const [physical] = usePhysicalDice();
  const [manual, setManual] = useState<RollControl["manual"]>(null);
  const [error, setError] = useState<string | null>(null);

  const finish = (mode: RollMode, entries?: ManualEntry[]) => {
    const req: RollRequest = { mode };
    if (entries) req.manual = entries;
    if (isDm && pub.overridden) req.public = pub.value;
    setOverride(null);
    setManual(null);
    options.onRoll(req);
  };

  return {
    roll(keys) {
      setError(null);
      const mode = modeFromKeys(keys, options.mode ?? "normal");
      if (!physical) return finish(mode);
      const slots = formSlots(options, mode, []);
      if (typeof slots === "string") {
        setError(slots);
        return;
      }
      setManual({ mode });
    },
    isDm,
    publicValue: pub.value,
    publicPreset: preset,
    setPublic: (value) => setOverride({ category: options.category, value }),
    physical,
    manual,
    cancelManual: () => setManual(null),
    submitManual(entries) {
      if (manual) finish(manual.mode, entries);
    },
    rollForMe() {
      if (manual) finish(manual.mode);
    },
    error,
    options,
  };
}

/** One group's inputs: dice total (+ per-die inputs for 2–10 dice). */
function GroupInputs({
  slot,
  input,
  index,
  extra,
  autoFocus,
  onChange,
}: {
  slot: ManualSlot;
  input: GroupInput;
  index: number;
  extra: boolean;
  autoFocus: boolean;
  onChange(patch: Partial<GroupInput>): void;
}) {
  const prefix = extra ? "dice-manual-crit" : "dice-manual";
  const computed = computedTotal(slot, input);
  const name = extra ? `${slot.expression} (critical)` : slot.expression;
  return (
    <>
      <div className="flex items-center gap-2">
        {extra ? (
          <span
            data-testid="dice-manual-crit-label"
            data-value={index}
            className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
          >
            Extra critical dice: {slot.expression}
          </span>
        ) : (
          <code className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {slot.expression}
          </code>
        )}
        <Input
          data-testid={`${prefix}-total`}
          data-value={index}
          aria-label={`Dice total for ${name}`}
          inputMode="numeric"
          placeholder={computed === null ? "Dice total" : String(computed)}
          className="h-8 w-24"
          autoFocus={autoFocus}
          value={input.total}
          onChange={(e) => onChange({ total: e.target.value })}
        />
      </div>
      {slot.faces.length > 1 && slot.faces.length <= 10 && (
        <div className="flex flex-wrap gap-1">
          {slot.faces.map((faces, d) => (
            <Input
              // biome-ignore lint/suspicious/noArrayIndexKey: dice positions are stable
              key={d}
              data-testid={`${prefix}-die`}
              data-value={index}
              data-index={d}
              aria-label={`${extra ? "Extra die" : "Die"} ${d + 1} (d${faces})`}
              inputMode="numeric"
              placeholder={`d${faces}`}
              className="h-7 w-12 px-1.5 text-xs"
              value={input.dice[d] ?? ""}
              onChange={(e) => {
                const dice = [...input.dice];
                dice[d] = e.target.value;
                onChange({ dice });
              }}
            />
          ))}
        </div>
      )}
    </>
  );
}

/**
 * Manual popover body: one dice-total input (+ optional per-die inputs) per expression; after a
 * natural 20 (or with `crit: true`) a crit slot adds its "Extra critical dice" group and keeps
 * what was typed (FR-DICE-31). Roll never fails silently (FR-DICE-32): an incomplete slot sends
 * nothing, focuses the offending input and says why.
 */
function ManualForm({ control }: { control: RollControl }) {
  const open = control.manual;
  const live = useSync((s) => s.state === "live");
  const [inputs, setInputs] = useState<SlotInput[]>([]);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const { options } = control;
  const mode = open?.mode ?? "normal";
  const slots = useMemo(() => {
    const s = formSlots(options, mode, inputs);
    return typeof s === "string" ? [] : s;
  }, [options, mode, inputs]);
  const shown = useMemo(() => reconcileInputs(slots, inputs), [slots, inputs]);
  if (!open) return null;
  const update = (slot: number, group: "base" | "extra", patch: Partial<GroupInput>) => {
    setInputs(updateInputs(options, mode, inputs, { slot, group }, patch));
  };

  return (
    <form
      ref={formRef}
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!live) return;
        const r = formEntries(slots, shown);
        if (!r.ok) {
          setError(r.message);
          const { slot, group, die } = r.focus;
          const id = `dice-manual${group === "extra" ? "-crit" : ""}-${die === null ? "total" : "die"}`;
          const at = die === null ? "" : `[data-index="${die}"]`;
          formRef.current
            ?.querySelector<HTMLInputElement>(`[data-testid="${id}"][data-value="${slot}"]${at}`)
            ?.focus();
          return;
        }
        setError(null);
        setInputs([]);
        control.submitManual(r.entries);
      }}
    >
      <div className="flex flex-col gap-0.5">
        <p className="text-xs text-muted-foreground">Physical dice</p>
        <p data-testid="dice-manual-label" className="text-sm font-medium">
          {options.label ?? CATEGORY_LABEL[options.category]}
        </p>
      </div>
      {slots.map((slot, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: one slot per expression position
        <div key={`${i}-${slot.base.expression}`} className="flex flex-col gap-1.5">
          <GroupInputs
            slot={slot.base}
            input={shown[i]?.base ?? { total: "", dice: [] }}
            index={i}
            extra={false}
            autoFocus={i === 0}
            onChange={(p) => update(i, "base", p)}
          />
          {slot.extra && (
            <div
              data-testid="dice-manual-crit"
              data-value={i}
              className="flex flex-col gap-1.5 border-l-2 border-muted pl-2"
            >
              <GroupInputs
                slot={slot.extra}
                input={shown[i]?.extra ?? { total: "", dice: [] }}
                index={i}
                extra
                autoFocus={false}
                onChange={(p) => update(i, "extra", p)}
              />
            </div>
          )}
        </div>
      ))}
      {error && (
        <p data-testid="dice-manual-error" role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {!live && (
        <p data-testid="dice-manual-offline" className="text-xs text-muted-foreground">
          Reconnecting… your entries are kept.
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => control.cancelManual()}>
          Cancel
        </Button>
        <Button
          data-testid="dice-manual-auto"
          type="button"
          size="sm"
          variant="outline"
          className="mr-auto order-first"
          disabled={!live}
          onClick={() => {
            setError(null);
            setInputs([]);
            control.rollForMe();
          }}
        >
          Roll for me
        </Button>
        <Button data-testid="dice-manual-submit" type="submit" size="sm" disabled={!live}>
          Roll
        </Button>
      </div>
    </form>
  );
}

/** FR-DICE-07 marker: a small hand pip on every roll button while physical mode is on. */
function PhysicalMarker() {
  return (
    <span
      data-testid="dice-physical-marker"
      aria-hidden
      className="pointer-events-none absolute -top-1 -right-1 flex size-3.5 items-center justify-center rounded-full bg-warning text-background shadow"
    >
      <HandIcon className="size-2.5" />
    </span>
  );
}

/** A button that rolls through `control`; the manual popover anchors to it. */
export function RollButton({
  control,
  onClick,
  className,
  children,
  ...props
}: { control: RollControl } & ComponentProps<typeof Button>) {
  return (
    <Popover
      open={control.manual !== null}
      onOpenChange={(o) => {
        if (!o) control.cancelManual();
      }}
    >
      <PopoverAnchor asChild>
        <Button
          {...props}
          data-physical={control.physical}
          className={cn(className, control.physical && "relative")}
          onClick={(e) => {
            onClick?.(e);
            if (!e.defaultPrevented) control.roll(e);
          }}
        >
          {children}
          {control.physical && <PhysicalMarker />}
        </Button>
      </PopoverAnchor>
      <PopoverContent align="end" side="top" className="w-80">
        <ManualForm control={control} />
      </PopoverContent>
    </Popover>
  );
}
