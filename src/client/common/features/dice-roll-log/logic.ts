// Pure client helpers for the game log and the roll control (FR-DICE-05, 07, 21, 24, 27, 30).
// Input convenience only: the server re-checks everything (FR-DICE-01, 06).

import {
  type DiceTerm,
  diceTerms,
  keptFlags,
  prepareExpression,
  toNotation,
} from "@shared/dice-roll-log/grammar";
import type {
  GameLogEntryView,
  ManualEntry,
  RollCategory,
  RollMode,
} from "@shared/dice-roll-log/schemas";
import type { EntityRecord } from "@shared/entities/schemas";
import type { SceneView, TokenView } from "@shared/scenes-map/schemas";

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
export const sortEntries = <T extends Pick<GameLogEntryView, "n">>(entries: readonly T[]): T[] =>
  [...entries].sort((a, b) => a.n - b.n);

export interface ActorOption {
  /** "" = the roller themselves ("me" / "DM"). */
  value: string;
  label: string;
  group?: "Characters" | "Tokens";
  ref?: { entityId: string } | { tokenId: string };
}

type ActorToken = Pick<TokenView, "id" | "sceneId" | "name" | "seq" | "definitionId">;

/**
 * FR-DICE-27: player → "me" + own characters; DM → "DM" + every character + the tokens of the
 * active scene (by placement order). A character's token is left out: the character is already
 * listed, and both roll under the same name ("Mira" twice, #149).
 */
export function actorOptions(
  you: { role: "dm" | "player"; playerId: string | null } | null,
  entities: readonly Pick<EntityRecord, "id" | "kind" | "name" | "ownerPlayerId">[],
  scenes: readonly Pick<SceneView, "id" | "active">[] = [],
  tokens: readonly ActorToken[] = [],
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
  return [
    ...out,
    ...onScene.map((t) => ({
      value: t.id,
      label: t.name,
      group: "Tokens" as const,
      ref: { tokenId: t.id },
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
 * FR-DICE-24 crit swap: the slots after the first, given the first entry. A natural 20 on the
 * first (its single kept d20) and `critExpressions` set → the rest use those.
 */
export function slotsAfterFirst(
  expressions: readonly string[],
  critExpressions: readonly string[] | undefined,
  first: ManualEntry | null,
  firstExpression: string,
): readonly string[] {
  const rest = expressions.slice(1);
  if (!critExpressions || !first) return rest;
  return manualNatural(firstExpression, first) === 20
    ? rest.map((e, i) => critExpressions[i] ?? e)
    : rest;
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

/**
 * Form strings → ManualEntry. Dice optional: all filled or all empty. An empty total with every
 * die filled → total computed (sum of kept dice). Returns an error message or the entry.
 */
export function parseManual(
  slot: ManualSlot,
  totalText: string,
  dieTexts: readonly string[],
): ManualEntry | string {
  const int = (s: string) => (/^-?\d{1,5}$/.test(s.trim()) ? Number(s.trim()) : null);
  const filled = dieTexts.filter((s) => s.trim() !== "");
  let dice: number[] | undefined;
  if (filled.length > 0) {
    if (filled.length !== slot.faces.length) return `Enter all ${slot.faces.length} dice or none`;
    dice = [];
    for (const [i, s] of dieTexts.entries()) {
      const v = int(s);
      const faces = slot.faces[i] ?? 0;
      if (v === null || v < 1 || v > faces) return `Die ${i + 1} must be 1–${faces}`;
      dice.push(v);
    }
  }
  let total = totalText.trim() === "" ? null : int(totalText);
  if (totalText.trim() !== "" && total === null) return "Dice total must be a whole number";
  if (total === null) {
    if (!dice) return "Enter the dice total";
    const r = prepareExpression(slot.expression, "normal");
    if (!r.ok) return r.message;
    let at = 0;
    total = 0;
    for (const t of diceTerms(r.value)) {
      const values = dice.slice(at, at + t.count);
      const flags = keptFlags(t, values);
      values.forEach((v, i) => {
        if (flags[i]) total = (total ?? 0) + t.sign * v;
      });
      at += t.count;
    }
  }
  return dice ? { diceTotal: total, dice } : { diceTotal: total };
}

export type FlagBackend = Pick<Storage, "getItem" | "setItem">;

export interface FlagStore {
  /** Stored `"1"` → true; no entry, or storage unreadable and nothing in memory → false. */
  read(key: string): boolean;
  /** Writes `"1"` / `"0"`; storage unavailable → kept in memory for this tab. Never throws. */
  write(key: string, on: boolean): void;
}

/** FR-DICE-30: per-browser on / off flag (Options open), with an in-memory fallback. */
export function createFlagStore(getBackend: () => FlagBackend | undefined): FlagStore {
  const memory = new Map<string, boolean>();
  return {
    read(key) {
      const kept = memory.get(key);
      if (kept !== undefined) return kept;
      try {
        return getBackend()?.getItem(key) === "1";
      } catch {
        return false;
      }
    },
    write(key, on) {
      try {
        const backend = getBackend();
        if (!backend) throw new Error("no storage");
        backend.setItem(key, on ? "1" : "0");
        memory.delete(key);
      } catch {
        memory.set(key, on);
      }
    },
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
