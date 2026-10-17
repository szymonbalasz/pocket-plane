// Effect-changed hooks `effectHooks` (FR-CBTX-51, ADR-0049 D2, seams S6, protocol §26).
// APPEND-ONLY (AGENTS §9.9): a feature adds one import and one line to `effectHooks`; nothing
// else changes here.
//
// `effectsChanged(env, {creatures, encounter})` runs once per command (once per target event of
// a multi-target apply) after the command's effect rows are written and after its own rule-hook
// lines, inside its transaction, **in or out of combat**, whenever an effect row was inserted,
// updated, ended or restored. CBTX's effect helpers (`effects.ts`) are the one choke point: they
// collect the creatures, and `runEffectHooks` runs the registry at every effect path's end
// (CBTX's effect commands and concentration save, `hpRules.apply` / `revert`, the combat rule
// hook points, MOD's `mod.apply` / `mod.toggle` / `mod.setModifiers`). A hook returns the rows
// it wrote (listed in the causing event's `changes`), writes through `env.tx` only, never emits
// and never writes effect rows. A throw rolls the command back. No line → no-op.
import type { TargetRef } from "@shared/combat-extras/intents";
import type { EncounterRecord } from "@shared/combat-tracker/schemas";
import type { CommandEnv } from "../../commands/commands";
import type { RecordChange } from "../../events/types";

export type EffectHookEnv = Pick<CommandEnv, "tx" | "ctx" | "actor">;

export interface EffectsChanged {
  /**
   * Every creature whose effects changed in this command, once each, first-touch order: a
   * monster as `{combatantId}`, a character (PC) as `{characterId}`.
   */
  creatures: readonly TargetRef[];
  /** The campaign's started encounter (a combat command: the encounter as it left it), else null. */
  encounter: EncounterRecord | null;
}

export interface EffectHook {
  /** `<feature>.<what>`, unique. */
  id: string;
  effectsChanged(env: EffectHookEnv, changed: EffectsChanged): RecordChange[];
}

/** The registry. Append your feature's line; order = run order. */
export const effectHooks: readonly EffectHook[] = [];

/** Live hook list, seeded from the registry; tests may add hooks via `register`. */
export class EffectHooks {
  private list: EffectHook[] = [];

  constructor(initial: readonly EffectHook[] = []) {
    for (const h of initial) this.register(h);
  }

  register(hook: EffectHook): void {
    if (this.list.some((h) => h.id === hook.id)) {
      throw new Error(`Effect hook "${hook.id}" registered twice`);
    }
    this.list.push(hook);
  }

  /** Test support: remove a hook registered by a test. */
  unregister(id: string): void {
    this.list = this.list.filter((h) => h.id !== id);
  }

  get empty(): boolean {
    return this.list.length === 0;
  }

  /** Every hook in order; the rows for the caller's event. */
  run(env: EffectHookEnv, changed: EffectsChanged): RecordChange[] {
    return this.list.flatMap((h) => h.effectsChanged(env, changed));
  }
}

export const effectsChangedHooks = new EffectHooks(effectHooks);
