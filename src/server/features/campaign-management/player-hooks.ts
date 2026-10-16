// Player lifecycle hooks (ADR-0042, FR-FOG-24 / OQ-FOG-39, protocol §26). APPEND-ONLY
// (AGENTS §9.9): a feature adds one import and one line to `playerHooks`; nothing else changes
// here.
//
// Members (all optional; run in list order inside the command's transaction; each returns the
// rows it wrote, listed in the event's `changes`; a throw rolls the command back):
// - `added(env, player)`: `player.add` (the REST player add, CAMP §9), after the player insert
//   → `PlayerAdded`.
// Hooks write through `env.tx` only and never emit. No line registered → no behaviour change.
// Player removal is out of scope (CAMP §2): no `deleted` member.
import type { PlayerRecord } from "@shared/campaign-management/schemas";
import type { CommandEnv } from "../../commands/commands";
import type { RecordChange } from "../../events/types";
import { fogPlayerHook } from "../fog-of-war/lifecycle";

export type PlayerHookEnv = Pick<CommandEnv, "tx" | "ctx" | "actor">;

export interface PlayerHook {
  /** `<feature>.<what>`, unique. */
  name: string;
  added?(env: PlayerHookEnv, player: PlayerRecord): RecordChange[];
}

/** The registry. Append your feature's line; order = run order. */
export const playerHooks: readonly PlayerHook[] = [
  fogPlayerHook, // fog-of-war (OQ-FOG-39: the new player's `seenBy` membership, FR-FOG-35)
];

/** Live hook list, seeded from the registry; tests may add hooks via `register`. */
export class PlayerHooks {
  private list: PlayerHook[] = [];

  constructor(initial: readonly PlayerHook[] = []) {
    for (const h of initial) this.register(h);
  }

  register(hook: PlayerHook): void {
    if (this.list.some((h) => h.name === hook.name)) {
      throw new Error(`Player hook "${hook.name}" registered twice`);
    }
    this.list.push(hook);
  }

  /** Test support: remove a hook registered by a test. */
  unregister(name: string): void {
    this.list = this.list.filter((h) => h.name !== name);
  }

  added(env: PlayerHookEnv, player: PlayerRecord): RecordChange[] {
    return this.list.flatMap((h) => h.added?.(env, player) ?? []);
  }
}

/** The process's hook list (stateless hooks; one list like `tokenHooks`). */
export const playerLifecycleHooks = new PlayerHooks(playerHooks);
