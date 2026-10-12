// Shared roll control (FR-DICE-24): `useRollControl` + `RollButton`. Reads the Shift / Ctrl keys
// (FR-DICE-05) and physical-dice mode (FR-DICE-07); DM gets a public toggle preset from the
// category's setting (FR-DICE-13). The caller sends its own intent from `onRoll`.
import {
  categoryPublic,
  GAME_LOG_SETTINGS_TYPE,
  type GameLogSettingsRecord,
  type ManualEntry,
  type RollCategory,
  type RollMode,
} from "@shared/dice-roll-log/schemas";
import { type ComponentProps, useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "../../components/ui/controls";
import { Input } from "../../components/ui/primitives";
import { useRecords, useSync } from "../../sync/store";
import { type ManualSlot, manualSlots, modeFromKeys, parseManual, slotsAfterFirst } from "./logic";
import { usePhysicalDice } from "./physical";

export interface RollRequest {
  mode: RollMode;
  /**
   * Physical-dice mode only: exactly one `ManualEntry` per expression, in `expressions` order
   * (sheet attack = [to-hit, damage]; after a natural 20 with `critExpressions`, the damage
   * entries are for the crit expressions). Callers map it onto their intent: `dice.roll` sends
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
  /** Shown instead of `expressions[1…]` when the first is a natural 20 (doubled damage). */
  critExpressions?: readonly string[];
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
  setPublic(v: boolean): void;
  physical: boolean;
  /** Open manual popover state, or null. */
  manual: { mode: RollMode; first: ManualSlot } | null;
  cancelManual(): void;
  submitManual(entries: ManualEntry[]): void;
  /** Local error (e.g. an expression the popover can't lay out). */
  error: string | null;
  options: RollControlOptions;
}

export function useRollControl(options: RollControlOptions): RollControl {
  const isDm = useSync((s) => s.store.you?.role === "dm");
  const settings = useRecords<GameLogSettingsRecord>(GAME_LOG_SETTINGS_TYPE)[0];
  const preset = settings ? categoryPublic(settings, options.category) : false;
  const [override, setOverride] = useState<{ category: RollCategory; value: boolean } | null>(null);
  const active = override && override.category === options.category ? override : null;
  const [physical] = usePhysicalDice();
  const [manual, setManual] = useState<RollControl["manual"]>(null);
  const [error, setError] = useState<string | null>(null);

  const finish = (mode: RollMode, entries?: ManualEntry[]) => {
    const req: RollRequest = { mode };
    if (entries) req.manual = entries;
    if (isDm && active) req.public = active.value;
    setOverride(null);
    setManual(null);
    options.onRoll(req);
  };

  return {
    roll(keys) {
      setError(null);
      const mode = modeFromKeys(keys, options.mode ?? "normal");
      if (!physical) return finish(mode);
      const slots = manualSlots(options.expressions.slice(0, 1), mode);
      if (typeof slots === "string") {
        setError(slots);
        return;
      }
      setManual({ mode, first: slots[0] as ManualSlot });
    },
    isDm,
    publicValue: active ? active.value : preset,
    setPublic: (value) => setOverride({ category: options.category, value }),
    physical,
    manual,
    cancelManual: () => setManual(null),
    submitManual(entries) {
      if (manual) finish(manual.mode, entries);
    },
    error,
    options,
  };
}

interface SlotInput {
  total: string;
  dice: string[];
}

const emptyInput = (slot: ManualSlot): SlotInput => ({
  total: "",
  dice: slot.faces.length > 1 ? slot.faces.map(() => "") : [],
});

/** Manual popover body: one dice-total input (+ optional per-die inputs) per expression. */
function ManualForm({ control }: { control: RollControl }) {
  const open = control.manual;
  const { expressions, critExpressions } = control.options;
  const [inputs, setInputs] = useState<SlotInput[]>([]);
  const [error, setError] = useState<string | null>(null);
  const first = open?.first ?? null;
  const firstEntry = useMemo(() => {
    if (!first) return null;
    const r = parseManual(first, inputs[0]?.total ?? "", inputs[0]?.dice ?? []);
    return typeof r === "string" ? null : r;
  }, [first, inputs]);
  const slots = useMemo((): ManualSlot[] => {
    if (!first) return [];
    const rest = slotsAfterFirst(expressions, critExpressions, firstEntry, first.expression);
    const more = manualSlots(rest, "normal");
    return [first, ...(typeof more === "string" ? [] : more)];
  }, [first, firstEntry, expressions, critExpressions]);
  if (!open) return null;
  const input = (i: number): SlotInput => inputs[i] ?? emptyInput(slots[i] as ManualSlot);
  const update = (i: number, patch: Partial<SlotInput>) => {
    const next = slots.map((_, j) => input(j));
    next[i] = { ...input(i), ...patch };
    setInputs(next);
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const entries: ManualEntry[] = [];
        for (const [i, slot] of slots.entries()) {
          const r = parseManual(slot, input(i).total, input(i).dice);
          if (typeof r === "string") {
            setError(slots.length > 1 ? `${slot.expression}: ${r}` : r);
            return;
          }
          entries.push(r);
        }
        setError(null);
        setInputs([]);
        control.submitManual(entries);
      }}
    >
      <p className="text-sm font-medium">Physical dice</p>
      {slots.map((slot, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: one slot per expression position
        <div key={`${i}-${slot.expression}`} className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {slot.expression}
            </code>
            <Input
              data-testid="dice-manual-total"
              data-value={i}
              aria-label={`Dice total for ${slot.expression}`}
              inputMode="numeric"
              placeholder="Dice total"
              className="h-8 w-24"
              autoFocus={i === 0}
              value={input(i).total}
              onChange={(e) => update(i, { total: e.target.value })}
            />
          </div>
          {slot.faces.length > 1 && slot.faces.length <= 10 && (
            <div className="flex flex-wrap gap-1">
              {slot.faces.map((faces, d) => (
                <Input
                  // biome-ignore lint/suspicious/noArrayIndexKey: dice positions are stable
                  key={d}
                  data-testid="dice-manual-die"
                  data-value={i}
                  data-index={d}
                  aria-label={`Die ${d + 1} (d${faces})`}
                  inputMode="numeric"
                  placeholder={`d${faces}`}
                  className="h-7 w-12 px-1.5 text-xs"
                  value={input(i).dice[d] ?? ""}
                  onChange={(e) => {
                    const dice = [...input(i).dice];
                    dice[d] = e.target.value;
                    update(i, { dice });
                  }}
                />
              ))}
            </div>
          )}
        </div>
      ))}
      {error && (
        <p data-testid="dice-manual-error" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => control.cancelManual()}>
          Cancel
        </Button>
        <Button data-testid="dice-manual-submit" type="submit" size="sm">
          Roll
        </Button>
      </div>
    </form>
  );
}

/** A button that rolls through `control`; the manual popover anchors to it. */
export function RollButton({
  control,
  onClick,
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
          onClick={(e) => {
            onClick?.(e);
            if (!e.defaultPrevented) control.roll(e);
          }}
        />
      </PopoverAnchor>
      <PopoverContent align="end" side="top" className="w-80">
        <ManualForm control={control} />
      </PopoverContent>
    </Popover>
  );
}
