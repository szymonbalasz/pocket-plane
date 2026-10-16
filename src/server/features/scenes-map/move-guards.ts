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
// ADR-0042 (FR-SCN-38 / -40): a guard may also **return** `{refuse?, hint?}`: `refuse` = the
// `conflict` message (same as throwing it), `hint` = segments the client may draw. `map.checkMove`
// runs every guard as a dry run (`check`): read-only, nothing written, logged or emitted.
import type { TokenRecord } from "@shared/scenes-map/schemas";
import { CommandError, conflict } from "../../commands/errors";
import type { Actor } from "../../events/types";
import { scnWallGuard } from "../scene-tools/guard";
import type { SceneRead } from "./visibility-hooks";

export interface MoveGuardEnv {
  /** Read-only access to the move's transaction (committed state at drop, SCN §11). */
  read: SceneRead;
  actor: Actor;
}

/** A guard's hint for `map.checkMove` (FR-SCN-38): segments `[x1, y1, x2, y2]` in grid units. */
export interface MoveGuardHint {
  segments: [number, number, number, number][];
}

/** What a guard may return instead of throwing. */
export interface MoveGuardVerdict {
  /** Refuse with `conflict(refuse)`. */
  refuse?: string;
  hint?: MoveGuardHint;
}

export type MoveGuard = (
  env: MoveGuardEnv,
  token: TokenRecord,
  from: { col: number; row: number },
  to: { col: number; row: number },
) => MoveGuardVerdict | undefined;

/** `map.checkMove`'s answer (FR-SCN-38). */
export interface MoveCheck {
  ok: boolean;
  hints: { guard: string; segments: [number, number, number, number][] }[];
}

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

  /** Runs every guard in list order; the first throw or `refuse` refuses the move. */
  run(
    env: MoveGuardEnv,
    token: TokenRecord,
    from: { col: number; row: number },
    to: { col: number; row: number },
  ): void {
    for (const g of this.list) {
      const v = g.guard(env, token, from, to);
      if (v?.refuse !== undefined) throw conflict(v.refuse);
    }
  }

  /**
   * Dry run for `map.checkMove` (FR-SCN-38): every guard runs; a `refuse` or a thrown `conflict`
   * makes `ok` false; hints are collected in list order. Other errors propagate.
   */
  check(
    env: MoveGuardEnv,
    token: TokenRecord,
    from: { col: number; row: number },
    to: { col: number; row: number },
  ): MoveCheck {
    const out: MoveCheck = { ok: true, hints: [] };
    for (const g of this.list) {
      let v: MoveGuardVerdict | undefined;
      try {
        v = g.guard(env, token, from, to);
      } catch (err) {
        if (!(err instanceof CommandError) || err.code !== "conflict") throw err;
        out.ok = false;
        continue;
      }
      if (v?.refuse !== undefined) out.ok = false;
      if (v?.hint && v.hint.segments.length > 0) {
        out.hints.push({ guard: g.name, segments: v.hint.segments });
      }
    }
    return out;
  }
}

/** The process's guard list (stateless guards; one list like `tokenHooks`). */
export const tokenMoveGuards = new MoveGuards(moveGuards);
