// Token-changed hooks (FR-MAP-30, ADR-0028, protocol §25). APPEND-ONLY (AGENTS §9.9): a feature
// adds one import and one line to `tokenChangedHooks`; nothing else changes here.
//
// A hook runs inside `map.updateToken`, `map.setTokenHidden`, `map.deleteToken`, scene delete
// (once per token) and `map.moveToken` (FR-MAP-38, ADR-0031) with `(env, before, after | null)`;
// `after` is null on delete. It returns the rows it changed; every one is listed in the token
// event's `changes`. A throw (e.g. a `conflict` for a token bound to a running encounter) rolls
// the whole command back. Hooks write through `env.tx` only and never emit. Placement and
// duplicate run no hooks.
// On a move (`before.col/row ≠ after.col/row`) the actor may be a **player** on an optimistic
// intent: a hook must not assume a DM actor and must never reject a move (indicators never
// block, #145); a throw there answers `internal` and the move rolls back.
import type { TokenRecord } from "@shared/scenes-map/schemas";
import type { CommandEnv } from "../../commands/commands";
import type { RecordChange } from "../../events/types";
import { combatantTokenHook } from "../combat-tracker/hooks";

export type TokenHookEnv = Pick<CommandEnv, "tx" | "ctx" | "actor">;

export type TokenChangedHook = (
  env: TokenHookEnv,
  before: TokenRecord,
  after: TokenRecord | null,
) => RecordChange[];

export interface TokenHookRegistration {
  /** `<feature>.<what>`, unique. */
  name: string;
  hook: TokenChangedHook;
}

/** The registry. Append your feature's line; order = run order. */
export const tokenChangedHooks: readonly TokenHookRegistration[] = [
  { name: "combat-tracker.combatant-copies", hook: combatantTokenHook }, // combat-tracker (FR-CBT-09)
];

/** Per-server hook list, seeded from the registry; tests may add hooks via `register`. */
export class TokenHooks {
  private list: TokenHookRegistration[] = [];

  constructor(initial: readonly TokenHookRegistration[] = []) {
    for (const h of initial) this.register(h.name, h.hook);
  }

  register(name: string, hook: TokenChangedHook): void {
    if (this.list.some((h) => h.name === name)) {
      throw new Error(`Token-changed hook "${name}" registered twice`);
    }
    this.list.push({ name, hook });
  }

  /** Test support: remove a hook registered by a test. */
  unregister(name: string): void {
    this.list = this.list.filter((h) => h.name !== name);
  }

  run(env: TokenHookEnv, before: TokenRecord, after: TokenRecord | null): RecordChange[] {
    return this.list.flatMap((h) => h.hook(env, before, after));
  }
}

const bound = new WeakMap<object, TokenHooks>();

export function bindTokenHooks(s: object, hooks: TokenHooks): void {
  bound.set(s, hooks);
}

/** The hook list of a server instance (set at feature registration). */
export function tokenHooksOf(s: object): TokenHooks {
  const h = bound.get(s);
  if (!h) throw new Error("scenes-map is not registered on these services");
  return h;
}
