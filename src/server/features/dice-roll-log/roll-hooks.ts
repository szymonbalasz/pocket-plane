// Roll hooks (FR-MOD-13, ADR-0038, protocol §26). APPEND-ONLY (AGENTS §9.9): a feature adds one
// import and one line to `rollHooks`; nothing else changes here.
//
// `dice.evaluate` runs every registered hook, in registry order, when its caller passes a
// `subject` (who rolls what), right after the base `roll` row, inside the caller's transaction.
// A hook reads committed rows through `env.tx`, rolls extra dice only through `base.rollExtra`
// (`ctx.dice`; each its own `roll` row like the base), and returns parts and mode hints. It never
// emits and writes nothing else. A throw rolls the whole command back. Hooks run on every
// subject roll: keep them to indexed reads of the creature's rows.
import type { RollCategory } from "@shared/dice-roll-log/schemas";
import type { RollSubject } from "@shared/effect-modifiers/schemas";
import type { CommandEnv } from "../../commands/commands";
import { modRollHook } from "../effect-modifiers/roll-hook";
import type { Roll, RollSource } from "./evaluate";

export type { RollSubject };

/** One rider on a roll: its value is added to the outcome total (FR-MOD-14, -16). */
export interface RollPart {
  effectId: string;
  /** The effect's label; players see it iff `public` (else "(DM)", FR-MOD-19). */
  label: string;
  /** The effect is player-visible (not secret, not hidden, active). */
  public: boolean;
  /** Signed integer. */
  value: number;
  /** Bonus dice: their notation ("1d4") and their own roll row. */
  expression?: string;
  rollId?: string;
  /** Rolled by the server for a physical base roll (FR-MOD-18). */
  auto?: boolean;
}

/** An advantage / disadvantage source (FR-MOD-17, tier 2). */
export interface RollModeHint {
  effectId: string;
  mode: "advantage" | "disadvantage";
  label: string;
  public: boolean;
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
}

export interface RollHookResult {
  parts: RollPart[];
  modes: RollModeHint[];
}

export interface RollHook {
  /** `<feature>.<what>`, unique. */
  id: string;
  adjust(env: CommandEnv, subject: RollSubject, base: RollHookBase): RollHookResult;
}

/** The registry. Append your feature's line; order = run order = part order. */
export const rollHooks: readonly RollHook[] = [
  modRollHook, // effect-modifiers: effect parts (FR-MOD-14)
];
