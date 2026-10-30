// Pure client helpers for the game log and the roll control (FR-DICE-05, 07, 21, 24, 27, 30).
// Input convenience only: the server re-checks everything (FR-DICE-01, 06).

import type { CombatantRecord, EncounterRecord } from "@shared/combat-tracker/schemas";
import {
  type DiceTerm,
  diceTerms,
  keptFlags,
  prepareExpression,
  toNotation,
} from "@shared/dice-roll-log/grammar";
import type { LineSegment } from "@shared/dice-roll-log/kind-types";
import type {
  GameLogEntryView,
  ManualEntry,
  RollCategory,
  RollMode,
} from "@shared/dice-roll-log/schemas";
import type { EntityRecord } from "@shared/entities/schemas";
import type { SceneView, TokenView } from "@shared/scenes-map/schemas";
import { z } from "zod";

/** FR-DICE-05: Shift = advantage, Ctrl = disadvantage, both = normal; none → the toggle. */
export function modeFromKeys(
  keys: { shiftKey?: boolean; ctrlKey?: boolean } | null | undefined,
  toggle: RollMode,
): RollMode {
  const shift = keys?.shiftKey === true;
  const ctrl = keys?.ctrlKey === true;
  if (shift && ctrl) return "normal";
  if (shift) return "advantage";
  if (ctrl) return "disadvantage";
  return toggle;
}

/** FR-DICE-07: physical-dice mode key, per client and campaign. */
export function physicalKey(campaignId: string, role: "dm" | "player", playerId: string | null) {
  return `pp.dice.v1.${campaignId}.${role === "dm" ? "dm" : (playerId ?? "unknown")}`;
}

/** FR-DICE-30: roll-bar Options open / closed key, beside the FR-DICE-07 entry. */
export function optionsKey(campaignId: string, role: "dm" | "player", playerId: string | null) {
  return `pp.dice.options.v1.${campaignId}.${role === "dm" ? "dm" : (playerId ?? "unknown")}`;
}

/**
 * FR-DICE-13 / FR-DICE-30: the DM's public toggle. Preset from the category's setting; an
 * override counts only for the category it was set on, so changing category re-presets it.
 */
export function publicState(
  preset: boolean,
  category: RollCategory,
  override: { category: RollCategory; value: boolean } | null,
): { value: boolean; overridden: boolean } {
  const active = override && override.category === category ? override : null;
  return { value: active ? active.value : preset, overridden: active !== null };
}

/**
 * FR-DICE-30: the Options chevron's dot — a hidden option is set: category ≠ other, an actor
 * or a label, or (DM) the public toggle differs from the category preset.
 */
export function optionsDirty(o: {
  category: RollCategory;
  actor: string;
  label: string;
  isDm: boolean;
  publicValue: boolean;
  publicPreset: boolean;
}): boolean {
  return (
    o.category !== "other" ||
    o.actor !== "" ||
    o.label.trim() !== "" ||
    (o.isDm && o.publicValue !== o.publicPreset)
  );
}

/** FR-DICE-21: entries oldest first by `n`. */
/** A held line's placeholder for every number (FR-DICE-40, OQ-DICE-30 A). */
export const HELD_TEXT = "…";

/** A line segment as drawn; `blank` = a die chip drawn without its number (held). */
export type ShownSegment = LineSegment & { blank?: true };

const MODE_MARK = /^ \((adv|dis)(: .*)?\)$/;
const NATURAL_MARK = /^ — natural (20!|1)$/;

/**
 * FR-DICE-40: a held `roll` line, render only (`formatLine` and the stored entry unchanged). Each
 * die chip blank (its text "…" for copy and screen readers; dropped / offered kept), the total
 * and each `numeric` segment (a rolled part's sum, R2) "…", the "(adv)" / "(dis)" marker "(…)". The natural 20 / 1 marker is left out until the
 * landing: a "…" only on naturals would tell one before the dice land.
 */
export function heldSegments(segments: readonly LineSegment[]): ShownSegment[] {
  const out: ShownSegment[] = [];
  for (const s of segments) {
    if (s.die) out.push({ ...s, text: HELD_TEXT, blank: true });
    else if (s.style === "total" || s.numeric) out.push({ ...s, text: HELD_TEXT });
    else if (MODE_MARK.test(s.text)) out.push({ ...s, text: ` (${HELD_TEXT})` });
    else if (!NATURAL_MARK.test(s.text)) out.push(s);
  }
  return out;
}

export const sortEntries = <T extends Pick<GameLogEntryView, "n">>(entries: readonly T[]): T[] =>
  [...entries].sort((a, b) => a.n - b.n);

export interface ActorOption {
  /** "" = the roller themselves ("me" / "DM"). */
  value: string;
  label: string;
  group?: "Characters" | "Tokens" | "Combatants";
  ref?: { entityId: string } | { tokenId: string } | { combatantId: string };
  /** FR-DICE-34: picked, but no longer in the list (shown disabled until the roll answers). */
  stale?: boolean;
}

/**
 * FR-DICE-34: the actor Select's state. A pick that left the list since (combatant removed,
 * encounter ended, token or character deleted) stays picked and marked stale: the roll is sent
 * as it, so the server answers `not_found` inline instead of the roll silently going out as the
 * roller; the caller drops it after that answer. No pick → the roller ("DM" / "Me").
 */
export function actorSelection(
  actors: readonly ActorOption[],
  picked: ActorOption | null,
): { options: ActorOption[]; selected: ActorOption | undefined } {
  if (!picked || picked.value === "") return { options: [...actors], selected: actors[0] };
  const current = actors.find((a) => a.value === picked.value);
  if (current) return { options: [...actors], selected: current };
  const stale = { ...picked, stale: true };
  return { options: [...actors, stale], selected: stale };
}

/** K8: the shared Select's item value of the roller (a Radix item can't have the value ""). */
export const ROLLER_ITEM = "roller";
export const actorItemValue = (value: string): string => (value === "" ? ROLLER_ITEM : value);

/** An actor option's shown label: a stale pick reads "(gone)" (FR-DICE-34). */
export const actorLabel = (a: ActorOption): string => (a.stale ? `${a.label} (gone)` : a.label);

export const ACTOR_GROUPS = ["Characters", "Tokens", "Combatants"] as const;

/**
 * K8 (K6 gap 8): the roll-as Select's sections in order: the ungrouped options (the roller,
 * "DM" / "Me"), then Characters, Tokens and Combatants, each only when it has options.
 */
export function actorGroups(
  options: readonly ActorOption[],
): { group: (typeof ACTOR_GROUPS)[number] | null; options: ActorOption[] }[] {
  const grouped = ACTOR_GROUPS.map((group) => ({
    group,
    options: options.filter((a) => a.group === group),
  })).filter((g) => g.options.length > 0);
  return [{ group: null, options: options.filter((a) => !a.group) }, ...grouped];
}

/**
 * FR-DICE-77 (BL-48, amends FR-DICE-30's default; rulings-b #18): a **player's** roll-bar actor
 * when nothing is picked in this page, in order: the stored manual pick (`""` = "Me"; only while
 * still one of the player's options) → the character the Character sheet shows (only one of their
 * own) → their only character → null ("Me", the player's name). The DM's default is unchanged.
 */
export function playerActorPick(
  actors: readonly ActorOption[],
  stored: string | null,
  sheetId: string | null,
): ActorOption | null {
  const own = actors.filter((a) => a.group === "Characters");
  if (stored !== null) {
    const hit =
      stored === "" ? actors.find((a) => a.value === "") : own.find((a) => a.value === stored);
    if (hit) return hit;
  }
  const sheet = sheetId ? own.find((a) => a.value === sheetId) : undefined;
  if (sheet) return sheet;
  return own.length === 1 ? (own[0] as ActorOption) : null;
}

type ActorToken = Pick<TokenView, "id" | "sceneId" | "name" | "seq" | "definitionId">;
type ActorCombatant = Pick<
  CombatantRecord,
  "id" | "encounterId" | "name" | "tokenId" | "active" | "removed"
>;

/**
 * FR-DICE-27: player → "me" + own characters; DM → "DM" + every character + the tokens of the
 * active scene (by placement order). A character's token is left out: the character is already
 * listed, and both roll under the same name ("Mira" twice, #149). FR-DICE-34: then the DM's
 * token-less active, non-removed combatants of the started encounter, by name ("Goblin 3").
 */
export function actorOptions(
  you: { role: "dm" | "player"; playerId: string | null } | null,
  entities: readonly Pick<EntityRecord, "id" | "kind" | "name" | "ownerPlayerId">[],
  scenes: readonly Pick<SceneView, "id" | "active">[] = [],
  tokens: readonly ActorToken[] = [],
  encounters: readonly Pick<EncounterRecord, "id" | "status">[] = [],
  combatants: readonly ActorCombatant[] = [],
): ActorOption[] {
  if (!you) return [];
  const chars = entities
    .filter((e) => e.kind === "character")
    .filter((e) => you.role === "dm" || e.ownerPlayerId === you.playerId)
    .sort((a, b) => a.name.localeCompare(b.name));
  const out: ActorOption[] = [
    { value: "", label: you.role === "dm" ? "DM" : "Me" },
    ...chars.map((c) => ({
      value: c.id,
      label: c.name,
      group: "Characters" as const,
      ref: { entityId: c.id },
    })),
  ];
  if (you.role !== "dm") return out;
  const active = scenes.find((s) => s.active)?.id;
  const listed = new Set(chars.map((c) => c.id));
  const onScene = tokens
    .filter((t) => t.sceneId === active && !(t.definitionId && listed.has(t.definitionId)))
    .sort((a, b) => a.seq - b.seq);
  const started = encounters.find((e) => e.status === "started")?.id;
  const tokenless = combatants
    .filter((c) => c.encounterId === started && c.active && !c.removed && c.tokenId === null)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return [
    ...out,
    ...onScene.map((t) => ({
      value: t.id,
      label: t.name,
      group: "Tokens" as const,
      ref: { tokenId: t.id },
    })),
    ...tokenless.map((c) => ({
      value: c.id,
      label: c.name,
      group: "Combatants" as const,
      ref: { combatantId: c.id },
    })),
  ];
}

export interface ManualSlot {
  /** Expression as rolled (after the adv/dis rewrite when it applies). */
  expression: string;
  /** Faces per die, in notation order (per-die inputs). */
  faces: number[];
}

/** One manual slot per expression; adv/dis applies to expressions with a 1d20 term. */
export function manualSlots(expressions: readonly string[], mode: RollMode): ManualSlot[] | string {
  const out: ManualSlot[] = [];
  for (const raw of expressions) {
    let r = prepareExpression(raw, mode);
    if (!r.ok && mode !== "normal") {
      const plain = prepareExpression(raw, "normal");
      // Mode only applies where there is a d20 (damage rolls stay as written).
      if (plain.ok && out.length > 0) r = plain;
    }
    if (!r.ok) return r.message;
    out.push({
      expression: toNotation(r.value),
      faces: diceTerms(r.value).flatMap((t) => Array<number>(t.count).fill(t.faces)),
    });
  }
  return out;
}

/**
 * FR-DICE-31: the "Extra critical dice" group of a crit slot — the base expression's dice terms
 * once more, no constants — when `crit` is `base` with every dice count doubled. Anything else
 * (keep, subtracted dice, a different crit rule) → null, and the slot falls back to showing the
 * crit expression itself (the FR-DICE-24 swap).
 */
export function critExtra(base: string, crit: string): ManualSlot | null {
  const b = prepareExpression(base, "normal");
  const c = prepareExpression(crit, "normal");
  if (!b.ok || !c.ok || b.value.length !== c.value.length) return null;
  const extra: DiceTerm[] = [];
  for (const [i, bt] of b.value.entries()) {
    const ct = c.value[i];
    if (!ct || ct.kind !== bt.kind || ct.sign !== bt.sign) return null;
    if (bt.kind === "const") {
      if (ct.kind !== "const" || ct.value !== bt.value) return null;
      continue;
    }
    if (ct.kind !== "dice" || bt.sign !== 1 || bt.keep || ct.keep) return null;
    if (ct.faces !== bt.faces || ct.count !== bt.count * 2) return null;
    extra.push(bt);
  }
  if (extra.length === 0) return null;
  return {
    expression: toNotation(extra),
    faces: extra.flatMap((t) => Array<number>(t.count).fill(t.faces)),
  };
}

/** One slot of the physical-dice popover (FR-DICE-24, 31). */
export interface FormSlot {
  /** The expression's own inputs (kept as typed when a crit adds the extra group). */
  base: ManualSlot;
  /** "Extra critical dice: 4d6"; null = no crit on this slot. */
  extra: ManualSlot | null;
  /**
   * The slot is rolled as a crit (FR-DICE-31: a natural 20 typed first, or `crit: true`), also
   * when it fell back to the crit expression itself. MOD's bonus dice double on it (FR-MOD-18).
   */
  crit: boolean;
  /** FR-DICE-41: the caller's slot label ("Slashing"), or null. */
  label: string | null;
}

export interface FormOptions {
  expressions: readonly string[];
  /** Without `crit`: pairs with `expressions[1…]`; with `crit`: with `expressions[0…]`. */
  critExpressions?: readonly string[] | undefined;
  /** The caller knows the hit is critical: every slot shows its extra group from the start. */
  crit?: boolean | undefined;
  /** FR-DICE-41: one label per expression ("To hit", "Slashing"); null / absent = none. */
  slotLabels?: readonly (string | null)[] | undefined;
}

/**
 * FR-DICE-41: a slot as the form names it — "2d6 fire", "2d6 fire (critical)"; without a label
 * the expression alone, as before.
 */
export const slotName = (expression: string, label: string | null, critical = false): string =>
  `${expression}${label ? ` ${label.toLowerCase()}` : ""}${critical ? " (critical)" : ""}`;

/**
 * FR-DICE-41: the slot labels of an attack's roll specs: to-hit → "To hit", each damage part →
 * its type capitalised ("Slashing"), a part without one → "Damage". Undefined unless a damage
 * part is among them (a check or save is one unlabelled slot, as before).
 */
export function slotLabelsOf(
  specs: readonly { category: RollCategory; part?: { type: string | null } | undefined }[],
): (string | null)[] | undefined {
  if (!specs.some((s) => s.category === "damage")) return undefined;
  return specs.map((s) => {
    if (s.category === "attack") return "To hit";
    if (s.category !== "damage") return null;
    const t = s.part?.type;
    return t ? `${t.charAt(0).toUpperCase()}${t.slice(1)}` : "Damage";
  });
}

export interface GroupInput {
  total: string;
  dice: string[];
}

export interface SlotInput {
  /** The base expression these inputs were typed for (a swap fallback resets them). */
  for: string;
  base: GroupInput;
  extra: GroupInput;
}

const emptyGroup = (slot: ManualSlot | null): GroupInput => ({
  total: "",
  dice: slot && slot.faces.length > 1 ? slot.faces.map(() => "") : [],
});

/**
 * FR-DICE-24 / FR-DICE-31: the popover's slots for the current inputs. A natural 20 typed in the
 * first slot (or `crit: true`) gives each crit slot its extra critical group. Returns an error
 * message when an expression can't be laid out.
 */
export function formSlots(
  o: FormOptions,
  mode: RollMode,
  inputs: readonly SlotInput[],
): FormSlot[] | string {
  const base = manualSlots(o.expressions, mode);
  if (typeof base === "string") return base;
  const crits = o.critExpressions ?? [];
  let natural20 = false;
  const first = base[0];
  const firstInput = inputs[0];
  if (!o.crit && first && firstInput && firstInput.for === first.expression) {
    const r = checkGroup(first, firstInput.base, first.expression);
    natural20 = "entry" in r && manualNatural(first.expression, r.entry) === 20;
  }
  const out: FormSlot[] = [];
  for (const [i, slot] of base.entries()) {
    const label = o.slotLabels?.[i] ?? null;
    const crit = o.crit ? crits[i] : natural20 && i > 0 ? crits[i - 1] : undefined;
    if (!crit) {
      out.push({ base: slot, extra: null, crit: o.crit === true || (natural20 && i > 0), label });
      continue;
    }
    const extra = critExtra(slot.expression, crit);
    if (extra) {
      out.push({ base: slot, extra, crit: true, label });
      continue;
    }
    const swapped = manualSlots([crit], "normal");
    if (typeof swapped === "string") return swapped;
    out.push({ base: swapped[0] as ManualSlot, extra: null, crit: true, label });
  }
  return out;
}

/** Inputs aligned to `slots`: a slot whose base changed starts empty; a gone extra group is dropped. */
export function reconcileInputs(
  slots: readonly FormSlot[],
  inputs: readonly SlotInput[],
): SlotInput[] {
  return slots.map((s, i) => {
    const prev = inputs[i];
    const base = prev && prev.for === s.base.expression ? prev.base : emptyGroup(s.base);
    const extra = s.extra && prev && prev.for === s.base.expression ? prev.extra : null;
    return {
      for: s.base.expression,
      base,
      extra:
        extra && extra.dice.length === emptyGroup(s.extra).dice.length
          ? extra
          : emptyGroup(s.extra),
    };
  });
}

/**
 * One input changed: the new inputs, with the slots re-derived from them (FR-DICE-31: the first
 * entry moving onto / off 20 adds / drops the extra groups; base inputs stay).
 */
export function updateInputs(
  o: FormOptions,
  mode: RollMode,
  inputs: readonly SlotInput[],
  at: { slot: number; group: "base" | "extra" },
  patch: Partial<GroupInput>,
): SlotInput[] {
  const slots = formSlots(o, mode, inputs);
  if (typeof slots === "string") return [...inputs];
  const next = reconcileInputs(slots, inputs);
  const cur = next[at.slot];
  if (!cur) return next;
  next[at.slot] = { ...cur, [at.group]: { ...cur[at.group], ...patch } };
  const after = formSlots(o, mode, next);
  return typeof after === "string" ? next : reconcileInputs(after, next);
}

/** Where the popover puts focus for an error: a slot's group total (`die` null) or one die. */
export interface FormFocus {
  slot: number;
  group: "base" | "extra";
  die: number | null;
}

export type FormResult =
  | { ok: true; entries: ManualEntry[] }
  | { ok: false; message: string; focus: FormFocus };

/** Min–max of the kept dice of an expression (constants excluded), as FR-DICE-06 checks. */
export function diceRange(expression: string): { min: number; max: number } | null {
  const r = prepareExpression(expression, "normal");
  if (!r.ok) return null;
  let min = 0;
  let max = 0;
  for (const t of diceTerms(r.value)) {
    const k = t.keep ? t.keep.n : t.count;
    if (t.sign === 1) {
      min += k;
      max += k * t.faces;
    } else {
      min -= k * t.faces;
      max -= k;
    }
  }
  return { min, max };
}

/** Sum of the kept dice of `values` (notation order). */
function keptSum(expression: string, values: readonly number[]): number {
  const r = prepareExpression(expression, "normal");
  if (!r.ok) return 0;
  let at = 0;
  let total = 0;
  for (const t of diceTerms(r.value)) {
    const vs = values.slice(at, at + t.count);
    const flags = keptFlags(t, vs);
    vs.forEach((v, i) => {
      if (flags[i]) total += t.sign * v;
    });
    at += t.count;
  }
  return total;
}

type GroupCheck = { entry: ManualEntry } | { message: string; die: number | null };

/**
 * FR-DICE-32: one input group → its `ManualEntry`, or what is missing / wrong and where. A group
 * is complete with its total filled and in range, or with every die filled (total computed).
 * `name` goes into "Enter the total for …".
 */
export function checkGroup(slot: ManualSlot, input: GroupInput, name: string): GroupCheck {
  const int = (s: string) => (/^-?\d{1,5}$/.test(s.trim()) ? Number(s.trim()) : null);
  const boxes = slot.faces.length > 1 ? slot.faces.length : 0;
  const texts = input.dice.slice(0, boxes);
  const filled = texts.filter((s) => s.trim() !== "").length;
  let dice: number[] | undefined;
  if (filled > 0) {
    if (filled !== boxes) {
      const empty = texts.findIndex((s) => s.trim() === "");
      return { message: `Enter all ${boxes} dice or none`, die: empty < 0 ? filled : empty };
    }
    dice = [];
    for (const [i, s] of texts.entries()) {
      const v = int(s);
      const faces = slot.faces[i] ?? 0;
      if (v === null || v < 1 || v > faces)
        return { message: `Die ${i + 1} must be 1–${faces}`, die: i };
      dice.push(v);
    }
  }
  const text = input.total.trim();
  if (text === "") {
    if (!dice) return { message: `Enter the total for ${name}`, die: null };
    return { entry: { diceTotal: keptSum(slot.expression, dice), dice } };
  }
  const total = int(text);
  if (total === null) return { message: "Dice total must be a whole number", die: null };
  const range = diceRange(slot.expression);
  if (range && (total < range.min || total > range.max)) {
    return { message: `Total must be ${range.min}–${range.max}`, die: null };
  }
  if (dice) {
    const sum = keptSum(slot.expression, dice);
    if (sum !== total) return { message: `The dice add up to ${sum}, not ${total}`, die: null };
    return { entry: { diceTotal: total, dice } };
  }
  return { entry: { diceTotal: total } };
}

/** A group's dice values when known: entered, or a single die = its total. */
function groupDice(slot: ManualSlot, entry: ManualEntry): number[] | null {
  if (entry.dice) return entry.dice;
  return slot.faces.length === 1 ? [entry.diceTotal] : null;
}

/**
 * FR-DICE-31: a crit slot's `ManualEntry` for the crit expression = base dice total + extra
 * total; `dice` = per dice term, its base dice then its extra dice (the crit expression's
 * order), only when every die of both groups is known.
 */
export function mergeCrit(
  base: ManualSlot,
  baseEntry: ManualEntry,
  extra: ManualSlot,
  extraEntry: ManualEntry,
): ManualEntry {
  const diceTotal = baseEntry.diceTotal + extraEntry.diceTotal;
  const bd = groupDice(base, baseEntry);
  const ed = groupDice(extra, extraEntry);
  const terms = prepareExpression(extra.expression, "normal");
  if (!bd || !ed || !terms.ok) return { diceTotal };
  const dice: number[] = [];
  let at = 0;
  for (const t of diceTerms(terms.value)) {
    dice.push(...bd.slice(at, at + t.count), ...ed.slice(at, at + t.count));
    at += t.count;
  }
  return { diceTotal, dice };
}

/**
 * FR-DICE-32: every slot complete → one `ManualEntry` per slot (crit slots merged, FR-DICE-31);
 * else the first problem and where to put focus. Nothing is sent on a failure.
 */
export function formEntries(slots: readonly FormSlot[], inputs: readonly SlotInput[]): FormResult {
  const entries: ManualEntry[] = [];
  for (const [i, s] of slots.entries()) {
    const input = inputs[i];
    const baseInput = input && input.for === s.base.expression ? input.base : emptyGroup(s.base);
    const b = checkGroup(s.base, baseInput, slotName(s.base.expression, s.label));
    if (!("entry" in b))
      return { ok: false, message: b.message, focus: { slot: i, group: "base", die: b.die } };
    if (!s.extra) {
      entries.push(b.entry);
      continue;
    }
    const extraInput = input && input.for === s.base.expression ? input.extra : emptyGroup(s.extra);
    const e = checkGroup(s.extra, extraInput, slotName(s.extra.expression, s.label, true));
    if (!("entry" in e))
      return { ok: false, message: e.message, focus: { slot: i, group: "extra", die: e.die } };
    entries.push(mergeCrit(s.base, b.entry, s.extra, e.entry));
  }
  return { ok: true, entries };
}

/**
 * FR-MOD-17 (tier 2): a lone d20 slot (no crit group) sends its value as `dice` too, so the
 * server can tell one d20 from a `2d20kh1` total when an effect changed the mode after the
 * preview (`conflict` "Effects changed — roll again").
 */
export function countedEntries(
  slots: readonly FormSlot[],
  entries: readonly ManualEntry[],
): ManualEntry[] {
  return entries.map((e, i) => {
    const s = slots[i];
    const lone = s && !s.extra && s.base.faces.length === 1 && s.base.faces[0] === 20;
    return lone && !e.dice ? { ...e, dice: [e.diceTotal] } : e;
  });
}

/** FR-DICE-32: the total shown for a group whose total is empty but whose dice are all filled. */
export function computedTotal(slot: ManualSlot, input: GroupInput): number | null {
  if (input.total.trim() !== "" || slot.faces.length < 2) return null;
  const r = checkGroup(slot, input, slot.expression);
  return "entry" in r ? r.entry.diceTotal : null;
}

/** The natural d20 of a manual entry, when it can be known; else null. */
export function manualNatural(expression: string, entry: ManualEntry): number | null {
  const r = prepareExpression(expression, "normal");
  if (!r.ok) return null;
  const dts = diceTerms(r.value);
  if (entry.dice) {
    let at = 0;
    const kept: number[] = [];
    for (const t of dts) {
      const values = entry.dice.slice(at, at + t.count);
      const flags = keptFlags(t, values);
      values.forEach((v, i) => {
        if (flags[i] && t.faces === 20 && t.sign === 1) kept.push(v);
      });
      at += t.count;
    }
    return kept.length === 1 ? (kept[0] ?? null) : null;
  }
  const only = dts.length === 1 ? (dts[0] as DiceTerm) : null;
  const keptCount = only ? (only.keep ? only.keep.n : only.count) : 0;
  return only && only.faces === 20 && only.sign === 1 && keptCount === 1 ? entry.diceTotal : null;
}

export type FlagBackend = Pick<Storage, "getItem" | "setItem">;

export interface FlagStore {
  /** Stored `"1"` → true; no entry, or storage unreadable and nothing in memory → false. */
  read(key: string): boolean;
  /** Writes `"1"` / `"0"`; storage unavailable → kept in memory for this tab. Never throws. */
  write(key: string, on: boolean): void;
  /** FR-DICE-77: the player's manual actor pick in the same entry (`""` = "Me"); null = none. */
  readActor(key: string): string | null;
  /** FR-DICE-77: stores (or, null, clears) the pick beside the open flag. Never throws. */
  writeActor(key: string, actor: string | null): void;
}

/**
 * FR-DICE-30 / -77: one Options entry. Without an actor pick it stays `"1"` / `"0"` (as before
 * FR-DICE-77); with one, `{"open":…,"actor":…}`.
 */
const RollBarEntry = z.strictObject({ open: z.boolean(), actor: z.string().max(64).nullable() });
type RollBarState = z.infer<typeof RollBarEntry>;

function parseEntry(raw: string | null | undefined): RollBarState {
  if (raw === "1") return { open: true, actor: null };
  if (!raw || raw === "0") return { open: false, actor: null };
  try {
    const p = RollBarEntry.safeParse(JSON.parse(raw));
    if (p.success) return p.data;
  } catch {
    // Not JSON: a broken entry reads as the default.
  }
  return { open: false, actor: null };
}

const serializeEntry = (s: RollBarState) =>
  s.actor === null ? (s.open ? "1" : "0") : JSON.stringify(s);

/** FR-DICE-30: per-browser on / off flag (Options open), with an in-memory fallback. */
export function createFlagStore(getBackend: () => FlagBackend | undefined): FlagStore {
  const memory = new Map<string, RollBarState>();
  const state = (key: string): RollBarState => {
    const kept = memory.get(key);
    if (kept !== undefined) return kept;
    try {
      return parseEntry(getBackend()?.getItem(key));
    } catch {
      return { open: false, actor: null };
    }
  };
  const write = (key: string, patch: Partial<RollBarState>) => {
    const next = { ...state(key), ...patch };
    try {
      const backend = getBackend();
      if (!backend) throw new Error("no storage");
      backend.setItem(key, serializeEntry(next));
      memory.delete(key);
    } catch {
      memory.set(key, next);
    }
  };
  return {
    read: (key) => state(key).open,
    write: (key, on) => write(key, { open: on }),
    readActor: (key) => state(key).actor,
    writeActor: (key, actor) => write(key, { actor }),
  };
}

export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export interface StickToBottom {
  readonly atBottom: boolean;
  /** A scroll event. Ignored while the viewport height changed and its resize is pending. */
  scrolled(m: ScrollMetrics): boolean;
  /** The viewport resized (footer / strip grew or shrank): the scrollTop to set, or null. */
  resized(m: ScrollMetrics): number | null;
  /** Pinned by the app (new entries while at the bottom, "N new" clicked). */
  pin(): void;
}

/**
 * FR-DICE-21: the list sticks to the bottom unless the user scrolled up. A viewport resize
 * (FR-DICE-30 Options row, Physical strip) keeps a pinned list pinned; a scroll event fired
 * before the resize is seen (scroll anchoring, clamping) can't unpin it.
 */
export function createStickToBottom(slack = 8): StickToBottom {
  let atBottom = true;
  let height: number | null = null;
  return {
    get atBottom() {
      return atBottom;
    },
    scrolled(m) {
      if (height === null || m.clientHeight === height) {
        atBottom = m.scrollHeight - m.scrollTop - m.clientHeight < slack;
      }
      return atBottom;
    },
    resized(m) {
      height = m.clientHeight;
      return atBottom ? m.scrollHeight : null;
    },
    pin() {
      atBottom = true;
    },
  };
}

/** The part of `ResizeObserver` `keepPinned` uses (a fake in tests). */
export type ResizeObserverLike = new (
  cb: () => void,
) => { observe(target: never): void; disconnect(): void };

/**
 * FR-DICE-21: a pinned list stays pinned whenever its viewport or its content changes height,
 * whatever the cause (roll bar rows, a theme's taller rows, late fonts); a list scrolled up
 * keeps its position. Returns the disconnect.
 */
export function keepPinned<T extends ScrollMetrics>(
  view: T,
  content: unknown,
  stick: StickToBottom,
  Observer: ResizeObserverLike,
): () => void {
  const ro = new Observer(() => {
    const top = stick.resized(view);
    if (top !== null) view.scrollTop = top;
  });
  ro.observe(view as never);
  ro.observe(content as never);
  return () => ro.disconnect();
}

/** The part of `MutationObserver` `repinOn` uses (a fake in tests). */
export type MutationObserverLike = new (
  cb: () => void,
) => { observe(target: never, options: { attributes: true }): void; disconnect(): void };

/** The part of `document.fonts` `repinOn` uses. */
export interface FontsLike {
  addEventListener(type: "loadingdone", cb: () => void): void;
  removeEventListener(type: "loadingdone", cb: () => void): void;
}

/**
 * FR-KIT-47: a list pinned at the bottom re-pins after an attribute change on `root` (`<html>`:
 * a theme switch, ADR-0069) and after web fonts load, before a scroll event the new row heights
 * cause can unpin it. A list scrolled up keeps its position. Returns the disconnect.
 */
export function repinOn<T extends ScrollMetrics>(
  view: T,
  stick: StickToBottom,
  root: unknown,
  Observer: MutationObserverLike,
  fonts?: FontsLike | null,
): () => void {
  const repin = () => {
    if (!stick.atBottom) return;
    view.scrollTop = view.scrollHeight;
    stick.pin();
  };
  const mo = new Observer(repin);
  mo.observe(root as never, { attributes: true });
  fonts?.addEventListener("loadingdone", repin);
  return () => {
    mo.disconnect();
    fonts?.removeEventListener("loadingdone", repin);
  };
}

/** FR-KIT-43: "HH:MM" in local time; "" for a time that doesn't parse. */
export function rowTime(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
}

/**
 * FR-KIT-46 (OQ-KIT-06 A): the copied text of a selection over the log, one line per row it
 * touches (`line(row)` = the row's full line); null = no row touched (the browser copies).
 */
export function copiedRows<R>(
  rows: Iterable<R>,
  touched: (row: R) => boolean,
  line: (row: R) => string,
): string | null {
  const lines: string[] = [];
  for (const r of rows) if (touched(r)) lines.push(line(r));
  return lines.length > 0 ? lines.join("\n") : null;
}

/** FR-DICE-103: the creature a log line is by. */
export interface ActorCreature {
  id: string;
  kind: "character" | "monster";
}

/**
 * FR-DICE-103: the one creature an actor name stands for (the DM client): the definitions named so
 * and those behind tokens and combatants named so ("Goblin 2"), the same case-insensitive match as
 * `actorPortraits`. None, or more than one → null.
 */
export function actorCreature(
  name: string,
  records: {
    entities: readonly Pick<EntityRecord, "id" | "kind" | "name">[];
    combatants: readonly { name: string; entityId: string }[];
    tokens: readonly { name: string; definitionId?: string }[];
  },
): ActorCreature | null {
  const key = name.toLowerCase();
  const ids = new Set<string>();
  for (const e of records.entities) if (e.name.toLowerCase() === key) ids.add(e.id);
  for (const c of records.combatants) if (c.name.toLowerCase() === key) ids.add(c.entityId);
  for (const t of records.tokens) {
    if (t.definitionId && t.name.toLowerCase() === key) ids.add(t.definitionId);
  }
  if (ids.size !== 1) return null;
  const [id] = ids;
  const e = records.entities.find((x) => x.id === id);
  return e && (e.kind === "character" || e.kind === "monster") ? { id: e.id, kind: e.kind } : null;
}

type Named = { name: string; imageAssetId?: string | null };

/**
 * A log row's portrait by `actorName` (case-insensitive), from records this client already holds,
 * so a player learns no image they couldn't see (ADR-0023, -0024): the player character of that
 * name (names unique per campaign, FR-ENT-08; players get every character's portrait), else a
 * combatant, else a token of that name (each only when visible to this viewer), else a monster
 * definition (the DM's client). Nothing matching (the DM, a hidden creature, a renamed one) keeps
 * the initial.
 */
export function actorPortraits(records: {
  entities: readonly Pick<EntityRecord, "kind" | "name" | "portraitAssetId">[];
  combatants: readonly Named[];
  tokens: readonly Named[];
}): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  const put = (name: string, id: string | null | undefined) => {
    if (id) out.set(name.toLowerCase(), id);
  };
  // Lowest precedence first; later sets win.
  for (const e of records.entities) if (e.kind === "monster") put(e.name, e.portraitAssetId);
  for (const t of records.tokens) put(t.name, t.imageAssetId);
  for (const c of records.combatants) put(c.name, c.imageAssetId);
  for (const e of records.entities) if (e.kind === "character") put(e.name, e.portraitAssetId);
  return out;
}
