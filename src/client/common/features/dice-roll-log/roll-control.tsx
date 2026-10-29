// Shared roll control (FR-DICE-24): `useRollControl` + `RollButton`. Reads the Shift / Ctrl keys
// (FR-DICE-05) and physical-dice mode (FR-DICE-07); DM gets a public toggle preset from the
// category's setting (FR-DICE-13). The caller sends its own intent from `onRoll`. Physical mode
// is never a surprise (#149): every `RollButton` carries a marker, and the popover offers
// "Roll for me" (one server roll; the mode stays on). Dice tray (DICEX): Alt+click stages the
// control in the tray instead (FR-DICEX-06), every roll starts a pending throw (FR-DICEX-09), and
// the tray hosts the same `ManualForm` (FR-DICEX-07). Effect modifiers tier 2 (FR-MOD-27, -18):
// `options.subject` feeds the preview — the d20 slots follow the expected final mode, and the
// form asks one labelled group per bonus die / trigger die, sent as `manualParts`. Sprint 5:
// `RollButton` draws the Alt hint in its own tooltip (FR-DICEX-51) and `slotLabels` names each
// slot of the form and the tray (FR-DICE-41). Sprint 15 (#385, FR-DICE-98): a control with a
// `purpose` (attack / damage) stages on click and rolls at once on Alt+click (FR-DICEX-98); the
// tray hands its staged dice back as `RollRequest.parts`.
import {
  CATEGORY_LABEL,
  categoryPublic,
  GAME_LOG_SETTINGS_TYPE,
  type GameLogSettingsRecord,
  type ManualEntry,
  type ManualPart,
  type RollCategory,
  type RollMode,
  type RollPurpose,
  type StagedPart,
} from "@shared/dice-roll-log/schemas";
import type { PreviewGroup } from "@shared/effect-modifiers/preview";
import { HandIcon } from "lucide-react";
import {
  type ComponentProps,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "../../components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "../../components/ui/controls";
import { Tooltip } from "../../components/ui/overlays";
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
  countedEntries,
  critExtra,
  type FormSlot,
  formEntries,
  formSlots,
  type GroupInput,
  type ManualSlot,
  manualSlots,
  mergeCrit,
  modeFromKeys,
  publicState,
  reconcileInputs,
  type SlotInput,
  slotName,
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
  /**
   * FR-DICE-98 (#385, ADR-0073): the tray's staged parts (a `purpose` control rolled from the
   * tray, edited or not); absent on Alt+click (roll now) and every other control. Callers send
   * it as the intent's `parts`.
   */
  parts?: StagedPart[];
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
  /**
   * FR-DICE-41: what each slot is, parallel to `expressions` ("To hit", "Slashing", "Fire"):
   * the physical form's slot headings and the tray's `adjust` groups. Client only, never sent;
   * absent / null = the expression alone.
   */
  slotLabels?: readonly (string | null)[];
  /** The mode toggle's value; Shift / Ctrl override it for one roll. Default normal. */
  mode?: RollMode;
  /**
   * FR-MOD-27 (review R14): who rolls what, the preview's input only (the server derives its own
   * subject from the intent). One subject (for `expressions[0]`) or one per expression (null =
   * none). Absent = no preview, no `manualParts` (tier 1).
   */
  subject?: SubjectOption;
  /**
   * FR-DICE-98 (#385): what the roll is for: `attack` (one expression, its d20 decides the crit)
   * or `damage` (one expression per part). Set → click stages the tray (editable, FR-DICEX-97)
   * and Alt+click rolls at once (FR-DICEX-98). Absent = plain: click rolls, Alt stages.
   */
  purpose?: RollPurpose;
  /**
   * FR-DICE-98: each expression's damage type, parallel to `expressions` (null = untyped, and
   * for the to-hit); the tray's die groups start with them (FR-DICEX-101 a).
   */
  partTypes?: readonly (StagedPart["type"] | null)[];
  onRoll(r: RollRequest): void;
}

/** Modifier keys of the click / key event that rolls. */
export interface RollKeys {
  shiftKey?: boolean;
  ctrlKey?: boolean;
  /**
   * FR-DICEX-06: Alt (Option on macOS) stages the roll in the dice tray instead; on a `purpose`
   * control it rolls at once (FR-DICEX-98).
   */
  altKey?: boolean;
}

/** FR-DICEX-06: tooltip line for stageable roll buttons. */
export const STAGE_HINT = "Alt: adjust in tray";
/** FR-DICEX-98: the hint on `purpose` controls (click stages, Alt rolls). */
export const ROLL_NOW_HINT = "Alt: roll now";

/** FR-DICEX-98 (OQ-DICEX-65 A): a click stages `purpose` controls; Alt+click rolls them. */
export const stagesOnClick = (o: Pick<RollControlOptions, "purpose">): boolean =>
  o.purpose !== undefined;

/**
 * FR-DICEX-51: the Alt hint, exactly once on every stageable roll surface (§6.1 table G):
 * `RollButton` draws it in its tooltip; a hidden-anchor roll (DM Initiative menus) in its
 * trigger's tooltip or the open menu. `line`: a muted line of its own (menus).
 */
export function StageHint({ line = false, now = false }: { line?: boolean; now?: boolean }) {
  return (
    <span
      data-testid="dicex-stage-hint"
      className={line ? "block px-2 pb-1 text-xs text-muted-foreground" : undefined}
    >
      {now ? ROLL_NOW_HINT : STAGE_HINT}
    </span>
  );
}

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
      // FR-DICEX-98: a `purpose` control swaps the two: click stages, Alt rolls at once. The
      // tray's own control (already staged) always rolls.
      if (!host.tray && (keys?.altKey === true) !== stagesOnClick(options)) {
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

/**
 * FR-DICEX-51: a `RollButton`'s tooltip — the parts the roll picks up (FR-MOD-27), the caller's
 * `hint`, then the Alt hint, once. A node `hint` (CHARX FR-CHARX-113: the sheet's breakdown with
 * its own test ID) sits where a string hint would.
 */
export function rollButtonTip(
  control: Pick<RollControl, "preview"> & { options?: Pick<RollControlOptions, "purpose"> },
  hint?: ReactNode,
): ReactNode {
  // FR-DICEX-98: "Alt: roll now" on `purpose` controls.
  const now = control.options ? stagesOnClick(control.options) : false;
  if (hint !== null && typeof hint === "object") {
    const preview = control.preview.text;
    return (
      <>
        {preview && `${preview} · `}
        {hint}
        {" · "}
        <StageHint now={now} />
      </>
    );
  }
  const lead = hint ? rollTooltip(control, String(hint)) : control.preview.text;
  return (
    <>
      {lead && `${lead} · `}
      <StageHint now={now} />
    </>
  );
}

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
  label = null,
  invalid = null,
  onChange,
}: {
  slot: ManualSlot;
  input: GroupInput;
  index: number;
  extra: boolean;
  autoFocus: boolean;
  /** A bonus / trigger die group (FR-MOD-18) instead of the expression's own dice. */
  part?: PartIds;
  /** FR-DICE-41: the slot's label ("Slashing"); null = the expression alone. */
  label?: string | null;
  /** FR-DICE-32 (BL-45): the input Roll stopped at (a die index or the total); null = none. */
  invalid?: number | "total" | null;
  onChange(patch: Partial<GroupInput>): void;
}) {
  const prefix = `${part ? "mod-tray-group" : "dice-manual"}${extra ? "-crit" : ""}`;
  const value = part ? part.key : index;
  const slotAttr = part ? { "data-die-slot": part.slot } : {};
  const computed = computedTotal(slot, input);
  const name = part
    ? `${part.label} (${slot.expression}${extra ? ", critical" : ""})`
    : slotName(slot.expression, label, extra);
  return (
    <>
      <div className="flex items-center gap-2">
        {extra ? (
          <span
            data-testid={`${prefix}-label`}
            data-value={value}
            {...slotAttr}
            className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
          >
            Extra critical dice: {slot.expression}
            {!part && label && ` (${label.toLowerCase()})`}
          </span>
        ) : label && !part ? (
          <span
            data-testid="dice-manual-slot-label"
            data-die-slot={index}
            className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
          >
            {label} — <code>{slot.expression}</code>
          </span>
        ) : part ? (
          <span
            data-testid="mod-tray-group-label"
            data-value={part.key}
            className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
          >
            {part.label}: <code>{slot.expression}</code>
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
          aria-invalid={invalid === "total" || undefined}
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
              aria-label={`${part ? `${part.label} ${extra ? "extra die" : "die"}` : extra ? "Extra die" : "Die"} ${d + 1} (d${faces})`}
              inputMode="numeric"
              aria-invalid={invalid === d || undefined}
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

/** FR-MOD-18: a part group's manual slot ("1d6+2" → one d6 box). */
const partSlot = (g: PreviewGroup): ManualSlot | null => {
  const s = manualSlots([g.expression], "normal");
  return typeof s === "string" ? null : (s[0] ?? null);
};
const emptyInput = (s: ManualSlot): GroupInput => ({
  total: "",
  dice: s.faces.length > 1 ? s.faces.map(() => "") : [],
});

/**
 * FR-MOD-18 (BL-25): one part group of the form — a bonus die (`e:`) or an offered trigger die
 * (`t:`) of slot `slot`. On a crit slot whose group doubles (FR-DICE-31, FR-CBT-83), `base` keeps
 * the uncritted dice and `extra` adds the "Extra critical dice"; else `base` is the group as
 * rolled and `extra` null.
 */
export interface PartForm {
  slot: number;
  /** The group as the server rolls it (crit-doubled on a crit slot). */
  group: PreviewGroup;
  base: ManualSlot;
  extra: ManualSlot | null;
  /** Input keys: the base group's, and its extra group's. */
  key: string;
  extraKey: string;
}

/**
 * FR-MOD-18 (BL-25, OQ-MOD-34 (4)): the form's part groups in part order — each slot's bonus
 * dice (they sit under their roll), then every offered trigger die (after the weapon parts, as
 * the card lists them). `groupsAt(i, crit)` = the preview's groups of slot `i`.
 */
export function partForms(
  slots: readonly Pick<FormSlot, "crit">[],
  groupsAt: (i: number, crit: boolean) => readonly PreviewGroup[],
): PartForm[] {
  const out: PartForm[] = [];
  for (const [i, s] of slots.entries()) {
    const plain = s.crit ? groupsAt(i, false) : [];
    for (const g of groupsAt(i, s.crit)) {
      const rolled = partSlot(g);
      if (!rolled) continue;
      const before = plain.find((p) => p.key === g.key);
      const extra = before ? critExtra(before.expression, g.expression) : null;
      const base = extra && before ? partSlot(before) : null;
      const key = `${i}|${g.key}|${(base ?? rolled).expression}`;
      out.push({
        slot: i,
        group: g,
        base: base ?? rolled,
        extra: base ? extra : null,
        key,
        extraKey: `${key}|crit`,
      });
    }
  }
  return [...out.filter((p) => !p.group.onHit), ...out.filter((p) => p.group.onHit)];
}

interface PartFocus {
  slot: number;
  key: string;
  group: "base" | "extra";
  die: number | null;
}

/**
 * FR-DICE-32 (BL-45): where Roll stopped and why — a slot's group (`key` null) or a part group's
 * (`key` = its preview key); `die` null = the group's total. Shown as the inline message and a
 * marked input until the next edit.
 */
export interface ManualProblem {
  message: string;
  slot: number;
  key: string | null;
  group: "base" | "extra";
  die: number | null;
}

/**
 * FR-MOD-18: every part group → `manualParts` per slot (`slots` lists), or the first problem.
 * Every group is required, offered trigger dice too (BL-25, OQ-MOD-34 (4): entered like any
 * other die; "Roll for me" is the way to let the server roll). A crit group sends its base and
 * extra dice merged (FR-DICE-31).
 */
export function partEntries(
  forms: readonly PartForm[],
  inputs: Readonly<Record<string, GroupInput>>,
  slots: number,
): { ok: true; parts: ManualPart[][] } | { ok: false; message: string; focus: PartFocus } {
  const parts: ManualPart[][] = Array.from({ length: slots }, () => []);
  for (const f of forms) {
    const { slot, group: g } = f;
    const b = checkGroup(
      f.base,
      inputs[f.key] ?? emptyInput(f.base),
      `${g.label} (${f.base.expression})`,
    );
    if (!("entry" in b)) {
      return {
        ok: false,
        message: b.message,
        focus: { slot, key: g.key, group: "base", die: b.die },
      };
    }
    let entry = b.entry;
    if (f.extra) {
      const name = `${g.label} (${f.extra.expression}, critical)`;
      const e = checkGroup(f.extra, inputs[f.extraKey] ?? emptyInput(f.extra), name);
      if (!("entry" in e)) {
        return {
          ok: false,
          message: e.message,
          focus: { slot, key: g.key, group: "extra", die: e.die },
        };
      }
      entry = mergeCrit(f.base, b.entry, f.extra, e.entry);
    }
    parts[slot]?.push({ key: g.key, entry });
  }
  return { ok: true, parts };
}

/** FR-DICE-32: the whole form → its entries and parts, or the first problem (slots, then parts). */
export function checkManual(
  slots: readonly FormSlot[],
  shown: readonly SlotInput[],
  forms: readonly PartForm[],
  inputs: Readonly<Record<string, GroupInput>>,
):
  | { ok: true; entries: ManualEntry[]; parts: ManualPart[][] }
  | { ok: false; problem: ManualProblem } {
  const r = formEntries(slots, shown);
  if (!r.ok) return { ok: false, problem: { message: r.message, key: null, ...r.focus } };
  const p = partEntries(forms, inputs, slots.length);
  if (!p.ok) return { ok: false, problem: { message: p.message, ...p.focus } };
  return { ok: true, entries: r.entries, parts: p.parts };
}

/** The input of a group Roll stopped at (`GroupInputs.invalid`). */
const invalidAt = (
  p: ManualProblem | null,
  slot: number,
  key: string | null,
  group: "base" | "extra",
): number | "total" | null =>
  p && p.slot === slot && p.key === key && p.group === group ? (p.die ?? "total") : null;

/** The group's line: "Bane (−)", "Divine Fury (on a hit)". */
const groupLabel = (g: PreviewGroup) =>
  `${g.label || "(DM)"}${g.sign === -1 ? " (−)" : ""}${g.onHit ? " (on a hit)" : ""}`;

/**
 * FR-MOD-18: one part group's inputs; on a crit its "Extra critical dice" sub-row (BL-25). The
 * group Roll stopped at is marked (`data-state="invalid"`, red edge and input; BL-45).
 */
export function PartGroup({
  form: f,
  inputs,
  problem = null,
  onChange,
}: {
  form: PartForm;
  inputs: Readonly<Record<string, GroupInput>>;
  problem?: ManualProblem | null;
  onChange: Dispatch<SetStateAction<Record<string, GroupInput>>>;
}) {
  const ids = { key: f.group.key, slot: f.slot, label: groupLabel(f.group) };
  const set = (k: string, s: ManualSlot) => (patch: Partial<GroupInput>) =>
    onChange((all) => ({ ...all, [k]: { ...(all[k] ?? emptyInput(s)), ...patch } }));
  const base = invalidAt(problem, f.slot, f.group.key, "base");
  const extra = invalidAt(problem, f.slot, f.group.key, "extra");
  const invalid = base !== null || extra !== null;
  return (
    <div
      data-testid="mod-tray-group"
      data-value={f.group.key}
      data-die-slot={f.slot}
      data-state={invalid ? "invalid" : undefined}
      className={cn(
        "flex flex-col gap-1.5 border-l-2 border-primary/40 pl-2",
        invalid && "border-destructive",
      )}
    >
      <GroupInputs
        slot={f.base}
        input={inputs[f.key] ?? emptyInput(f.base)}
        index={f.slot}
        extra={false}
        autoFocus={false}
        part={ids}
        invalid={base}
        onChange={set(f.key, f.base)}
      />
      {f.extra && (
        <div
          data-testid="mod-tray-group-crit"
          data-value={f.group.key}
          data-die-slot={f.slot}
          className="flex flex-col gap-1.5 border-l-2 border-muted pl-2"
        >
          <GroupInputs
            slot={f.extra}
            input={inputs[f.extraKey] ?? emptyInput(f.extra)}
            index={f.slot}
            extra
            autoFocus={false}
            part={ids}
            invalid={extra}
            onChange={set(f.extraKey, f.extra)}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Manual popover body: one dice-total input (+ optional per-die inputs) per expression; after a
 * natural 20 (or with `crit: true`) a crit slot adds its "Extra critical dice" group and keeps
 * what was typed (FR-DICE-31). Roll never fails silently (FR-DICE-32): an incomplete slot sends
 * nothing, focuses and marks the offending input and says why; the next edit clears both, so a
 * message on screen is always the last Roll's (BL-45). With a subject (FR-MOD-27, -18): the d20
 * slots follow the preview's mode, each slot adds one labelled group per bonus die, and the
 * offered trigger dice follow the last slot (BL-25), each with its extra critical dice on a crit.
 */
export function ManualForm({ control }: { control: RollControl }) {
  const open = control.manual;
  const live = useSync((s) => s.state === "live");
  const [inputs, setInputs] = useState<SlotInput[]>([]);
  const [partInputs, setPartInputs] = useState<Record<string, GroupInput>>({});
  const [problem, setProblem] = useState<ManualProblem | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const { options, preview } = control;
  const mode = preview.modeFor(open?.mode ?? "normal");
  const slots = useMemo(() => {
    const s = formSlots(options, mode, inputs);
    return typeof s === "string" ? [] : s;
  }, [options, mode, inputs]);
  const shown = useMemo(() => reconcileInputs(slots, inputs), [slots, inputs]);
  const parts = useMemo(
    () => partForms(slots, (i, crit) => preview.groups(i, { crit, toHitMode: mode })),
    [slots, preview, mode],
  );
  if (!open) return null;
  const update = (slot: number, group: "base" | "extra", patch: Partial<GroupInput>) => {
    setProblem(null);
    setInputs(updateInputs(options, mode, inputs, { slot, group }, patch));
  };
  const updatePart: Dispatch<SetStateAction<Record<string, GroupInput>>> = (next) => {
    setProblem(null);
    setPartInputs(next);
  };
  const focus = (id: string, attrs: string) =>
    formRef.current?.querySelector<HTMLInputElement>(`[data-testid="${id}"]${attrs}`)?.focus();
  const reset = () => {
    setProblem(null);
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
        const r = checkManual(slots, shown, parts, partInputs);
        if (!r.ok) {
          setProblem(r.problem);
          const { slot, key, group, die } = r.problem;
          const field = `${group === "extra" ? "-crit" : ""}-${die === null ? "total" : "die"}`;
          const at = die === null ? "" : `[data-index="${die}"]`;
          if (key === null) focus(`dice-manual${field}`, `[data-value="${slot}"]${at}`);
          else
            focus(`mod-tray-group${field}`, `[data-value="${key}"][data-die-slot="${slot}"]${at}`);
          return;
        }
        reset();
        if (preview.active) control.submitManual(countedEntries(slots, r.entries), r.parts);
        else control.submitManual(r.entries);
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
            label={slot.label}
            invalid={invalidAt(problem, i, null, "base")}
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
                label={slot.label}
                invalid={invalidAt(problem, i, null, "extra")}
                onChange={(p) => update(i, "extra", p)}
              />
            </div>
          )}
          {parts
            .filter((f) => f.slot === i && !f.group.onHit)
            .map((f) => (
              <PartGroup
                key={f.key}
                form={f}
                inputs={partInputs}
                problem={problem}
                onChange={updatePart}
              />
            ))}
        </div>
      ))}
      {/* BL-25: offered trigger dice after every weapon part, as the card lists them. */}
      {parts
        .filter((f) => f.group.onHit)
        .map((f) => (
          <PartGroup
            key={f.key}
            form={f}
            inputs={partInputs}
            problem={problem}
            onChange={updatePart}
          />
        ))}
      {problem && (
        <p data-testid="dice-manual-error" role="alert" className="text-xs text-destructive">
          {problem.message}
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

/**
 * A button that rolls through `control`; the manual popover anchors to it. Its tooltip is
 * `rollButtonTip` (FR-DICEX-51): a caller with tooltip text (or a node) of its own passes it as `hint`
 * instead of wrapping the button in a Tooltip. `hint={false}`: an invisible anchor (the roll
 * starts from a menu, whose trigger or open menu shows the Alt hint), no tooltip. `formZ`: the
 * manual popover's layer when the button sits above the default (z-50), e.g. in a toast.
 */
export function RollButton({
  control,
  hint,
  formZ,
  onClick,
  className,
  children,
  ...props
}: { control: RollControl; hint?: ReactNode; formZ?: number } & ComponentProps<typeof Button>) {
  const anchor = (
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
  );
  return (
    <Popover
      open={control.manual !== null}
      onOpenChange={(o) => {
        if (!o) control.cancelManual();
      }}
    >
      {hint === false ? anchor : <Tooltip content={rollButtonTip(control, hint)}>{anchor}</Tooltip>}
      {/* BL-19: focus moving out never closes the form. A menu item that rolls through an
          invisible anchor (DM Initiative Attack ▸, Check ▸, Save ▸) closes its menu, which then
          refocuses its trigger: that dismissed the form before anything was entered. A click
          outside, Escape and Cancel still close it. */}
      <PopoverContent
        align="end"
        side="top"
        className="w-80"
        {...(formZ !== undefined ? { style: { zIndex: formZ } } : {})}
        onFocusOutside={(e) => e.preventDefault()}
      >
        <ManualForm control={control} />
      </PopoverContent>
    </Popover>
  );
}
