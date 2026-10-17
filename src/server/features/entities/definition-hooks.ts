// Definition-changed hooks (FR-ENT-19, protocol §17). APPEND-ONLY (AGENTS §9.9, OQ-ENT-14):
// a feature adds one import and one line to `definitionChangedHooks`; nothing else changes here.
//
// A hook runs inside `entities.update`'s transaction with `(env, before, after)` and returns the
// instance rows it changed; every one is listed in `EntityUpdated.changes`. A throw rolls the
// whole update back. Hooks write through `env.tx` only; they never emit (listeners never mutate).
// Display names belong to instances (#126): hooks refresh only image and size copies.
import type { EntityRecord } from "@shared/entities/schemas";
import type { CommandEnv } from "../../commands/commands";
import type { RecordChange } from "../../events/types";
import { creatureSheetDefinitionHook } from "../character-sheet/definition-hook";
import { combatantDefinitionHook } from "../combat-tracker/hooks";
import { presetOwnerHook } from "../effect-modifiers/definition-hook";
import { fogSensesHook } from "../fog-of-war/lifecycle";
import { refreshTokenCopies } from "../scenes-map/definition-hook";
import { fillTokenCreatureType } from "./creature-type-fill";

export type HookEnv = Pick<CommandEnv, "tx" | "ctx" | "actor">;

export type DefinitionChangedHook = (
  env: HookEnv,
  before: EntityRecord,
  after: EntityRecord,
) => RecordChange[];

export interface HookRegistration {
  /** `<feature>.<what>`, unique. */
  name: string;
  hook: DefinitionChangedHook;
}

/** The registry. Append your feature's line; order = run order. */
export const definitionChangedHooks: readonly HookRegistration[] = [
  { name: "scenes-map.token-copies", hook: refreshTokenCopies }, // scenes-map (FR-MAP-20)
  { name: "combat-tracker.combatant-copies", hook: combatantDefinitionHook }, // combat-tracker (FR-CBT-06)
  { name: "character-sheet.sheet-copies", hook: creatureSheetDefinitionHook }, // CHARX owner copy + counter clamp (FR-CHARX-13/17)
  { name: "effect-modifiers.preset-owner", hook: presetOwnerHook }, // MOD preset owner copy (FR-MOD-07)
  { name: "fog-of-war.senses", hook: fogSensesHook }, // FOG senses edit re-derives (FR-FOG-35)
  { name: "scenes-map.creature-type-fill", hook: fillTokenCreatureType }, // token art fill (FR-ENT-27)
];

/** Per-server hook list, seeded from the registry; tests may add hooks via `register`. */
export class DefinitionHooks {
  private list: HookRegistration[] = [];

  constructor(initial: readonly HookRegistration[] = []) {
    for (const h of initial) this.register(h.name, h.hook);
  }

  register(name: string, hook: DefinitionChangedHook): void {
    if (this.list.some((h) => h.name === name)) {
      throw new Error(`Definition-changed hook "${name}" registered twice`);
    }
    this.list.push({ name, hook });
  }

  run(env: HookEnv, before: EntityRecord, after: EntityRecord): RecordChange[] {
    return this.list.flatMap((h) => h.hook(env, before, after));
  }
}

const bound = new WeakMap<object, DefinitionHooks>();

export function bindDefinitionHooks(s: object, hooks: DefinitionHooks): void {
  bound.set(s, hooks);
}

/** The hook list of a server instance (set at feature registration). */
export function definitionHooksOf(s: object): DefinitionHooks {
  const h = bound.get(s);
  if (!h) throw new Error("entities is not registered on these services");
  return h;
}
