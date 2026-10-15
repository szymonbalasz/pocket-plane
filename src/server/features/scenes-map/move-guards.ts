// Token move guards (ADR-0040, FR-SCN-11, protocol §36). APPEND-ONLY (AGENTS §9.9): a feature adds
// one import and one line to `moveGuards`; nothing else changes here.
//
// A guard runs inside `map.moveToken`'s transaction with `(env, token, from, to)`, after the
// intent is validated and authorized and **before** fog's `derive`, the single write and the
// token-changed hooks (order: guards → derive → write → hooks, ADR-0039 / ADR-0040). It may
// refuse the move by throwing a `CommandError` (e.g. `conflict`): nothing is written, no hook
// runs, no event is emitted. Guards run for every actor; each decides whom it checks (scene-tools'
// wall guard returns at once for the DM). Guards are read-only: `env.read` can only select.
// Placement, `placeTokenIn`, duplicate and scene copy run none. No line registered → no change.
import type { TokenRecord } from "@shared/scenes-map/schemas";
import type { Actor } from "../../events/types";
import { scnWallGuard } from "../scene-tools/guard";
import type { SceneRead } from "./visibility-hooks";

export interface MoveGuardEnv {
  /** Read-only access to the move's transaction (committed state at drop, SCN §11). */
  read: SceneRead;
  actor: Actor;
}

export type MoveGuard = (
  env: MoveGuardEnv,
  token: TokenRecord,
  from: { col: number; row: number },
  to: { col: number; row: number },
) => void;

export interface MoveGuardRegistration {
  /** `<feature>.<what>`, unique. */
  name: string;
  guard: MoveGuard;
}

/** The registry. Append your feature's line; order = run order. */
export const moveGuards: readonly MoveGuardRegistration[] = [
  scnWallGuard, // scene-tools: walls and non-open doors refuse a player's move (FR-SCN-10/11)
];

/** Live guard list, seeded from the registry; tests may add guards via `register`. */
export class MoveGuards {
  private list: MoveGuardRegistration[] = [];

  constructor(initial: readonly MoveGuardRegistration[] = []) {
    for (const g of initial) this.register(g.name, g.guard);
  }

  register(name: string, guard: MoveGuard): void {
    if (this.list.some((g) => g.name === name)) {
      throw new Error(`Move guard "${name}" registered twice`);
    }
    this.list.push({ name, guard });
  }

  /** Test support: remove a guard registered by a test. */
  unregister(name: string): void {
    this.list = this.list.filter((g) => g.name !== name);
  }

  /** Runs every guard in list order; the first throw refuses the move. */
  run(
    env: MoveGuardEnv,
    token: TokenRecord,
    from: { col: number; row: number },
    to: { col: number; row: number },
  ): void {
    for (const g of this.list) g.guard(env, token, from, to);
  }
}

/** The process's guard list (stateless guards; one list like `tokenHooks`). */
export const tokenMoveGuards = new MoveGuards(moveGuards);
