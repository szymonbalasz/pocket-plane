// Shared roll control (FR-DICE-24): `useRollControl` + `RollButton`. Reads the Shift / Ctrl keys
// (FR-DICE-05) and physical-dice mode (FR-DICE-07); DM gets a public toggle preset from the
// category's setting (FR-DICE-13). The caller sends its own intent from `onRoll`. Physical mode
// is never a surprise (#149): every `RollButton` carries a marker, and the popover offers
// "Roll for me" (one server roll; the mode stays on). Dice tray (DICEX): Alt+click stages the
// control in the tray instead (FR-DICEX-06), every roll starts a pending throw (FR-DICEX-09), and
// the tray hosts the same `ManualForm` (FR-DICEX-07). Effect modifiers tier 2 (FR-MOD-27, -18):
// `options.subject` feeds the preview — the d20 slots follow the expected final mode, and the
// form asks one labelled group per bonus die / trigger die, sent as `manualParts`.
import {
  CATEGORY_LABEL,
  categoryPublic,
  GAME_LOG_SETTINGS_TYPE,
  type GameLogSettingsRecord,
  type ManualEntry,
  type ManualPart,
  type RollCategory,
  type RollMode,
} from "@shared/dice-roll-log/schemas";
import type { PreviewGroup } from "@shared/effect-modifiers/preview";
import { HandIcon } from "lucide-react";
import { type ComponentProps, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "../../components/ui/controls";
import { Input } from "../../components/ui/primitives";
import { cn } from "../../lib/utils";
import { useRecords, useSync } from "../../sync/store";
import { diceExtras, stageTray } from "../dice-extras/store";
import {
  type ControlPreview,
  type SubjectOption,
  useRollPreview,
} from "../effect-modifiers/roll-preview";
import {
  checkGroup,
  computedTotal,
  formEntries,
  formSlots,
  type GroupInput,
  type ManualSlot,
  manualSlots,
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
  /**
   * FR-MOD-27 (tier 2): the mode the preview expects the d20 roll to roll with (the roller's
   * `mode` combined with the creature's effects); only with `options.subject`. The server's
   * final mode decides; callers send `mode`.
   */
  previewMode?: RollMode;
  /**
   * FR-MOD-18 (tier 2): physical groups per expression, parallel to `manual` (one list per
   * entry, possibly empty): bonus dice (`e:` keys, `bonusDieGroups`) and trigger dice (`t:`).
   * Only with `manual` and `options.subject`. Single-roll intents send `manualParts[0]`.
   */
  manualParts?: ManualPart[][];
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
  /**
   * FR-MOD-27 (review R14): who rolls what, the preview's input only (the server derives its own
   * subject from the intent). One subject (for `expressions[0]`) or one per expression (null =
   * none). Absent = no preview, no `manualParts` (tier 1).
   */
  subject?: SubjectOption;
  onRoll(r: RollRequest): void;
}

/** Modifier keys of the click / key event that rolls. */
export interface RollKeys {
  shiftKey?: boolean;
  ctrlKey?: boolean;
  /** FR-DICEX-06: Alt (Option on macOS) stages the roll in the dice tray instead. */
  altKey?: boolean;
}

/** FR-DICEX-06: tooltip line for stageable roll buttons. */
export const STAGE_HINT = "Alt: adjust in tray";

export interface RollControl {
  /**
   * Roll now (or open the manual popover); pass the click / key event for Shift / Ctrl. Alt →
   * staged in the dice tray (`adjust`), options verbatim (FR-DICEX-06, -08 a).
   */
  roll(keys?: RollKeys): void;
  isDm: boolean;
  /** DM public switch value: the override, else the category's setting. */
  publicValue: boolean;
  /** DM: the category's setting (FR-DICE-13); `publicValue` differs = an override is set. */
  publicPreset: boolean;
  setPublic(v: boolean): void;
  physical: boolean;
  /** Open manual popover state (the roller's mode), or null. */
  manual: { mode: RollMode } | null;
  cancelManual(): void;
  /** `parts`: FR-MOD-18 groups per entry (with a subject). */
  submitManual(entries: ManualEntry[], parts?: ManualPart[][]): void;
  /** Close the popover and let the server roll this one (mode stays on). */
  rollForMe(): void;
  /** Local error (e.g. an expression the popover can't lay out). */
  error: string | null;
  options: RollControlOptions;
  /** FR-MOD-27: the effect-modifier preview of `options.subject` (inactive without one). */
  preview: ControlPreview;
}

/**
 * The request a roll hands `onRoll` (without the DM's `public`): with a subject, the preview's
 * mode (FR-MOD-27) and, for a physical roll, one `manualParts` list per entry (FR-MOD-18; empty
 * when the roll has no group, so the server checks that none is expected).
 */
export function rollRequestOf(
  mode: RollMode,
  preview: Pick<ControlPreview, "active" | "modeFor">,
  entries?: ManualEntry[],
  parts?: ManualPart[][],
): RollRequest {
  const req: RollRequest = { mode };
  if (preview.active) req.previewMode = preview.modeFor(mode);
  if (entries) req.manual = entries;
  if (entries && preview.active) req.manualParts = entries.map((_, i) => parts?.[i] ?? []);
  return req;
}

/**
 * `host.tray`: the dice tray's control (FR-DICEX-05) — it shows the groups at once, so the
 * preview loads `rule-trigger` (FR-MOD-47) as a manual popover does when it opens.
 */
export function useRollControl(
  options: RollControlOptions,
  host: { tray?: boolean } = {},
): RollControl {
  const isDm = useSync((s) => s.store.you?.role === "dm");
  const settings = useRecords<GameLogSettingsRecord>(GAME_LOG_SETTINGS_TYPE)[0];
  const preset = settings ? categoryPublic(settings, options.category) : false;
  const [override, setOverride] = useState<{ category: RollCategory; value: boolean } | null>(null);
  const pub = publicState(preset, options.category, override);
  const [physical] = usePhysicalDice();
  const [manual, setManual] = useState<RollControl["manual"]>(null);
  const [error, setError] = useState<string | null>(null);
  const preview = useRollPreview(
    options.subject,
    options.expressions.length,
    manual !== null || host.tray === true,
  );

  const finish = (mode: RollMode, entries?: ManualEntry[], parts?: ManualPart[][]) => {
    const req = rollRequestOf(mode, preview, entries, parts);
    if (isDm && pub.overridden) req.public = pub.value;
    setOverride(null);
    setManual(null);
    diceExtras.sent(false); // FR-DICEX-09: pending throw until the own entry arrives
    options.onRoll(req);
  };

  return {
    roll(keys) {
      setError(null);
      const mode = modeFromKeys(keys, options.mode ?? "normal");
      if (keys?.altKey) {
        stageTray({
          kind: "control",
          options,
          mode,
          ...(preview.active ? { previewMode: preview.modeFor("normal") } : {}),
        });
        return;
      }
      if (!physical) return finish(mode);
      const slots = formSlots(options, preview.modeFor(mode), []);
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
    submitManual(entries, parts) {
      if (manual) finish(manual.mode, entries, parts);
    },
    rollForMe() {
      if (manual) finish(manual.mode);
    },
    error,
    options,
    preview,
  };
}

/**
 * FR-MOD-18: a single-roll intent's `manualParts` field from the request (the list of entry
 * `i`), or nothing. Two-roll intents (`char.roll`, `cbt.attack`) send `r.manualParts` as is.
 */
export const manualPartsOf = (r: RollRequest, i = 0): { manualParts?: ManualPart[] } => {
  const parts = r.manualParts?.[i];
  return parts ? { manualParts: parts } : {};
};

/** A roll button's Tooltip: the caller's hint, then the parts the roll picks up (FR-MOD-27). */
export const rollTooltip = (control: Pick<RollControl, "preview">, hint: string): string =>
  control.preview.text ? `${control.preview.text} · ${hint}` : hint;

/** FR-MOD-18: a part group's test ids (`mod-tray-group-*`, `data-value` = its key). */
interface PartIds {
  key: string;
  slot: number;
  label: string;
}

/** One group's inputs: dice total (+ per-die inputs for 2–10 dice). */
function GroupInputs({
  slot,
  input,
  index,
  extra,
  autoFocus,
  part,
  onChange,
}: {
  slot: ManualSlot;
  input: GroupInput;
  index: number;
  extra: boolean;
  autoFocus: boolean;
  /** A bonus / trigger die group (FR-MOD-18) instead of the expression's own dice. */
  part?: PartIds;
  onChange(patch: Partial<GroupInput>): void;
}) {
  const prefix = part ? "mod-tray-group" : extra ? "dice-manual-crit" : "dice-manual";
  const value = part ? part.key : index;
  const slotAttr = part ? { "data-slot": part.slot } : {};
  const computed = computedTotal(slot, input);
  const name = part
    ? `${part.label} (${slot.expression})`
    : extra
      ? `${slot.expression} (critical)`
      : slot.expression;
  return (
    <>
      <div className="flex items-center gap-2">
        {part ? (
          <span
            data-testid="mod-tray-group-label"
            data-value={part.key}
            className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
          >
            {part.label}: <code>{slot.expression}</code>
          </span>
        ) : extra ? (
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
          data-value={value}
          {...slotAttr}
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
              data-value={value}
              {...slotAttr}
              data-index={d}
              aria-label={`${part ? `${part.label} die` : extra ? "Extra die" : "Die"} ${d + 1} (d${faces})`}
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

/** FR-MOD-18: a part group's manual slot ("1d6+2" → one d6 box) and its input key. */
const partSlot = (g: PreviewGroup): ManualSlot | null => {
  const s = manualSlots([g.expression], "normal");
  return typeof s === "string" ? null : (s[0] ?? null);
};
const partKey = (slot: number, g: PreviewGroup) => `${slot}|${g.key}|${g.expression}`;
const emptyInput = (s: ManualSlot): GroupInput => ({
  total: "",
  dice: s.faces.length > 1 ? s.faces.map(() => "") : [],
});
const isEmpty = (g: GroupInput) => g.total.trim() === "" && g.dice.every((d) => d.trim() === "");

interface PartFocus {
  slot: number;
  key: string;
  die: number | null;
}

/**
 * FR-MOD-18: every slot's part groups → `manualParts` per slot, or the first problem. `e:`
 * groups are required (the server matches them exactly); an empty `t:` group is left out (the
 * server rolls an offered trigger without a group).
 */
export function partEntries(
  groups: readonly (readonly PreviewGroup[])[],
  inputs: Readonly<Record<string, GroupInput>>,
): { ok: true; parts: ManualPart[][] } | { ok: false; message: string; focus: PartFocus } {
  const parts: ManualPart[][] = [];
  for (const [i, gs] of groups.entries()) {
    const out: ManualPart[] = [];
    for (const g of gs) {
      const slot = partSlot(g);
      if (!slot) continue;
      const input = inputs[partKey(i, g)] ?? emptyInput(slot);
      if (g.key.startsWith("t:") && isEmpty(input)) continue;
      const r = checkGroup(slot, input, `${g.label} (${g.expression})`);
      if (!("entry" in r)) {
        return { ok: false, message: r.message, focus: { slot: i, key: g.key, die: r.die } };
      }
      out.push({ key: g.key, entry: r.entry });
    }
    parts.push(out);
  }
  return { ok: true, parts };
}

/** The group's line: "Bane (−)", "Divine Fury (on a hit) · optional". */
const groupLabel = (g: PreviewGroup) =>
  `${g.label || "(DM)"}${g.sign === -1 ? " (−)" : ""}${g.onHit ? " (on a hit)" : ""}${g.key.startsWith("t:") ? " · optional" : ""}`;

/**
 * Manual popover body: one dice-total input (+ optional per-die inputs) per expression; after a
 * natural 20 (or with `crit: true`) a crit slot adds its "Extra critical dice" group and keeps
 * what was typed (FR-DICE-31). Roll never fails silently (FR-DICE-32): an incomplete slot sends
 * nothing, focuses the offending input and says why. With a subject (FR-MOD-27, -18): the d20
 * slots follow the preview's mode, and each slot adds one labelled group per bonus / trigger die.
 */
export function ManualForm({ control }: { control: RollControl }) {
  const open = control.manual;
  const live = useSync((s) => s.state === "live");
  const [inputs, setInputs] = useState<SlotInput[]>([]);
  const [partInputs, setPartInputs] = useState<Record<string, GroupInput>>({});
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const { options, preview } = control;
  const mode = preview.modeFor(open?.mode ?? "normal");
  const slots = useMemo(() => {
    const s = formSlots(options, mode, inputs);
    return typeof s === "string" ? [] : s;
  }, [options, mode, inputs]);
  const shown = useMemo(() => reconcileInputs(slots, inputs), [slots, inputs]);
  const groups = useMemo(
    () => slots.map((s, i) => preview.groups(i, { crit: s.crit, toHitMode: mode })),
    [slots, preview, mode],
  );
  if (!open) return null;
  const update = (slot: number, group: "base" | "extra", patch: Partial<GroupInput>) => {
    setInputs(updateInputs(options, mode, inputs, { slot, group }, patch));
  };
  const focus = (id: string, attrs: string) =>
    formRef.current?.querySelector<HTMLInputElement>(`[data-testid="${id}"]${attrs}`)?.focus();
  const reset = () => {
    setError(null);
    setInputs([]);
    setPartInputs({});
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
          focus(id, `[data-value="${slot}"]${die === null ? "" : `[data-index="${die}"]`}`);
          return;
        }
        const p = partEntries(groups, partInputs);
        if (!p.ok) {
          setError(p.message);
          const { slot, key, die } = p.focus;
          const id = `mod-tray-group-${die === null ? "total" : "die"}`;
          const at = die === null ? "" : `[data-index="${die}"]`;
          focus(id, `[data-value="${key}"][data-slot="${slot}"]${at}`);
          return;
        }
        reset();
        control.submitManual(r.entries, preview.active ? p.parts : undefined);
      }}
    >
      <div className="flex flex-col gap-0.5">
        <p className="text-xs text-muted-foreground">Physical dice</p>
        <p data-testid="dice-manual-label" className="text-sm font-medium">
          {options.label ?? CATEGORY_LABEL[options.category]}
        </p>
        {preview.text && (
          <p data-testid="mod-roll-parts" className="text-xs text-muted-foreground">
            {preview.text}
          </p>
        )}
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
          {(groups[i] ?? []).map((g) => {
            const gs = partSlot(g);
            if (!gs) return null;
            const k = partKey(i, g);
            return (
              <div
                key={k}
                data-testid="mod-tray-group"
                data-value={g.key}
                data-slot={i}
                className="flex flex-col gap-1.5 border-l-2 border-primary/40 pl-2"
              >
                <GroupInputs
                  slot={gs}
                  input={partInputs[k] ?? emptyInput(gs)}
                  index={i}
                  extra={false}
                  autoFocus={false}
                  part={{ key: g.key, slot: i, label: groupLabel(g) }}
                  onChange={(patch) =>
                    setPartInputs((s) => ({ ...s, [k]: { ...(s[k] ?? emptyInput(gs)), ...patch } }))
                  }
                />
              </div>
            );
          })}
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
            reset();
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
