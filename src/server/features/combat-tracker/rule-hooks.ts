// Combat rule hooks (FR-CBTX-01, ADR-0035, protocol §26). APPEND-ONLY (AGENTS §9.9): a feature
// adds one import and one line to `combatRuleHooks`; nothing else changes here.
//
// Combat commands run every registered hook for a hook point inside their own transaction, after
// their own writes: `started` (`cbt.start`), `added` (`cbtx.addCombatants`), `turnChanged`
// (`cbt.nextTurn` / `cbt.prevTurn`), `ended` (`cbt.end`), each `(env, encounter, detail)` with
// the encounter as the command left it. A hook returns the rows it changed; the caller lists
// every one in its event's `changes`. Hooks write through `env.tx`, may call `notify` (its
// `NotificationCreated` follows the owner's event), and never emit otherwise. A throw rolls the
// whole command back. No listener writes state (ADR-0035). Hooks run on every Next: keep them to
// indexed reads of the started encounter's rows.
import type { EncounterRecord } from "@shared/combat-tracker/schemas";
import type { CommandEnv } from "../../commands/commands";
import type { RecordChange } from "../../events/types";

export type CombatRuleEnv = CommandEnv;

export interface TurnRef {
  round: number;
  turnCombatantId: string | null;
}

export interface CombatRuleDetails {
  /** `cbt.start`: the combatants it created. */
  started: { combatantIds: readonly string[] };
  /** `cbtx.addCombatants`: the combatants it created (FR-CBTX-27). */
  added: { combatantIds: readonly string[] };
  turnChanged: {
    direction: "next" | "prev";
    /** The turn being left. */
    from: TurnRef;
    /** The new turn (= the encounter's). */
    to: TurnRef;
    /**
     * Prev: a hook appends the name of each effect it could not restore because the slot is
     * taken (FR-CBTX-07); the command returns them as `notRestored`.
     */
    notRestored: string[];
  };
  /** `cbt.end`: every combatant of the encounter. */
  ended: { combatantIds: readonly string[] };
}

export type CombatRulePoint = keyof CombatRuleDetails;
export const COMBAT_RULE_POINTS: readonly CombatRulePoint[] = [
  "started",
  "added",
  "turnChanged",
  "ended",
];

export type CombatRuleHook<P extends CombatRulePoint> = (
  env: CombatRuleEnv,
  encounter: EncounterRecord,
  detail: CombatRuleDetails[P],
) => RecordChange[];

/** One feature's hooks; any subset of the points. */
export type CombatRuleHookSet = { [P in CombatRulePoint]?: CombatRuleHook<P> };

export interface CombatRuleHookRegistration {
  /** `<feature>.<what>`, unique. */
  name: string;
  hooks: CombatRuleHookSet;
}

/** The registry. Append your feature's line; order = run order. */
export const combatRuleHooks: readonly CombatRuleHookRegistration[] = [];

/** Per-server hook list, seeded from the registry; tests may add hooks via `register`. */
export class CombatRuleHooks {
  private list: CombatRuleHookRegistration[] = [];

  constructor(initial: readonly CombatRuleHookRegistration[] = combatRuleHooks) {
    for (const h of initial) this.register(h.name, h.hooks);
  }

  register(name: string, hooks: CombatRuleHookSet): void {
    if (this.list.some((h) => h.name === name)) {
      throw new Error(`Combat rule hook "${name}" registered twice`);
    }
    this.list.push({ name, hooks });
  }

  /** Test support: remove a hook registered by a test. */
  unregister(name: string): void {
    this.list = this.list.filter((h) => h.name !== name);
  }

  /** Runs `point` of every hook in registry order; the rows for the caller's event. */
  run<P extends CombatRulePoint>(
    point: P,
    env: CombatRuleEnv,
    encounter: EncounterRecord,
    detail: CombatRuleDetails[P],
  ): RecordChange[] {
    return this.list.flatMap((h) => {
      const hook = h.hooks[point] as CombatRuleHook<P> | undefined;
      return hook ? hook(env, encounter, detail) : [];
    });
  }
}

const bound = new WeakMap<object, CombatRuleHooks>();

export function bindCombatRuleHooks(s: object, hooks: CombatRuleHooks): void {
  bound.set(s, hooks);
}

/** The hook list of a server instance (set at feature registration). */
export function combatRuleHooksOf(s: object): CombatRuleHooks {
  const h = bound.get(s);
  if (!h) throw new Error("combat rule hooks are not bound on these services");
  return h;
}
