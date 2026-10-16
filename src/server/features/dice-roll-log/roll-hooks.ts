// Roll hooks (FR-MOD-13, ADR-0038, protocol §26). APPEND-ONLY (AGENTS §9.9): a feature adds one
// import and one line to `rollHooks`; nothing else changes here.
//
// `dice.evaluate` runs every registered hook, in registry order, when its caller passes a
// `subject` (who rolls what), right after the base `roll` row, inside the caller's transaction.
// A hook reads committed rows through `env.tx`, rolls extra dice only through `base.rollExtra`
// (`ctx.dice`; each its own `roll` row like the base), and returns parts and mode hints. It never
// emits and writes nothing else. A throw rolls the whole command back. Hooks run on every
// subject roll: keep them to indexed reads of the creature's rows.
//
// Rule triggers (ADR-0043, R0 types; R1 wires `modes()` / `manualParts`, R4 MOD's offers): a hook
// may also export `modes()` (asked before the base d20 is rolled), return `offered` parts (rolled
// via `rollExtra`, **not** in the total; the caller puts them on the damage `roll` item and the
// card) and DM-only `notes`. Until `dice.evaluate` reads them, they are ignored.
import type { ManualPart, RollCategory } from "@shared/dice-roll-log/schemas";
import type { PartDamageType, RollSubject } from "@shared/effect-modifiers/schemas";
import type { CommandEnv } from "../../commands/commands";
import { modRollHook } from "../effect-modifiers/roll-hook";
import { modTriggerHook } from "../effect-modifiers/trigger-hook";
import type { Roll, RollSource } from "./evaluate";

export type { RollSubject };

/** One rider on a roll: its value is added to the outcome total (FR-MOD-14, -16). */
export interface RollPart {
  /** The effect's id; for a `roll` trigger's part (FR-MOD-43) the trigger's id (`triggerId`). */
  effectId: string;
  /** Set iff the part comes from a rule trigger (FR-MOD-43); `dmPayload` names it by this. */
  triggerId?: string;
  /** The effect's (trigger's) label; players see it iff `public` (else "(DM)", FR-MOD-19). */
  label: string;
  /** The effect is player-visible (not secret, not hidden, active); a trigger: its `public`. */
  public: boolean;
  /** Signed integer. */
  value: number;
  /** Bonus dice: their notation ("1d4") and their own roll row. */
  expression?: string;
  rollId?: string;
  /** Rolled by the server for a physical base roll (FR-MOD-18). */
  auto?: boolean;
  /** FR-MOD-19 (D9): per-die values in expression order, ≤ 20 dice (more → none). */
  dice?: number[];
  /** A typed part's damage type (FR-MOD-19). */
  type?: PartDamageType;
}

/** An advantage / disadvantage source (FR-MOD-17, tier 2; a `roll` trigger's `mode`, T). */
export interface RollModeHint {
  /** The effect's id, or the trigger's for a trigger hint (`triggerId` set). */
  effectId: string;
  triggerId?: string;
  mode: "advantage" | "disadvantage";
  label: string;
  public: boolean;
}

/**
 * FR-MOD-19, -37: one offered rule-trigger part of a card's damage roll: rolled (its own `roll`
 * row via `rollExtra`), **not** in the total. The caller puts it on the damage `roll` item's
 * `offered` (label iff `public`, no settle facts) and on the card's `damage.triggers` (with the
 * settle facts), and lists `rollId` in the entry's `rollIds`.
 */
export interface OfferedPart {
  triggerId: string;
  /** The trigger's name (≤ 40). */
  label: string;
  /** The trigger's `public` (FR-MOD-47). */
  public: boolean;
  value: number;
  /** The evaluated formula, crit-doubled where it applies (≤ 20 chars). */
  expression: string;
  rollId: string;
  /** null = the attack's type. */
  type: PartDamageType | null;
  auto?: boolean;
  dice?: number[];
  /** Settle facts (FR-MOD-37, -39), card only. */
  ask?: string;
  marked?: string;
  hurt?: boolean;
  untick?: boolean;
}

/** The base roll as a hook sees it. */
export interface RollHookBase {
  /** The base roll was entered by hand (physical dice). */
  manual: boolean;
  category: RollCategory;
  source: RollSource;
  /**
   * Rolls `expression` (e.g. "1d4") with `ctx.dice` as its own `roll` row: same actor, target,
   * category and source as the base, `label` as given, mode normal, never manual.
   */
  rollExtra(expression: string, label: string): Roll;
  /**
   * FR-MOD-18 (tier 2 / T): the intent's physical groups for bonus and offered trigger dice
   * (`e:<effectId>` / `t:<triggerId>`); absent = none sent.
   */
  manualParts?: readonly ManualPart[];
}

export interface RollHookResult {
  parts: RollPart[];
  modes: RollModeHint[];
  /** FR-MOD-37: offered trigger parts (card damage subjects only); ≤ 4 across hooks. */
  offered?: OfferedPart[];
  /** FR-MOD-34, -37: DM-only line notes ("Divine Fury skipped: 30 dice > 25"), ≤ 80 chars. */
  notes?: string[];
}

export interface RollHook {
  /** `<feature>.<what>`, unique. */
  id: string;
  /**
   * FR-MOD-17 (tier 2): mode hints asked **before** the base roll; `dice.evaluate` combines them
   * with the roller's mode (any advantage + any disadvantage → normal). Reads only.
   */
  modes?(env: CommandEnv, subject: RollSubject): RollModeHint[];
  adjust(env: CommandEnv, subject: RollSubject, base: RollHookBase): RollHookResult;
}

/** The registry. Append your feature's line; order = run order = part order. */
export const rollHooks: readonly RollHook[] = [
  modRollHook, // effect-modifiers: effect parts (FR-MOD-14)
  modTriggerHook, // effect-modifiers: rule-trigger parts and offers (FR-MOD-37, -43)
];
