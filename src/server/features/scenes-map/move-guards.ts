// Token move guards (ADR-0040, FR-SCN-11, protocol §36). APPEND-ONLY (AGENTS §9.9): a feature adds
// one import and one line to `moveGuards` (or `moveHints`); nothing else changes here.
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
// ADR-0047 (FR-FOG-53, review A2 / A3; sprint 4): `check` then runs a second dry-run **hint
// phase** (`moveHints`), only when **every** guard passed, wherever a guard sits in the list (a
// guard registered later still refuses first). With `as` (a DM drag of an owned token) the gate
// is the guards run **as that player**; the DM's own `ok` and hints stay its own (the DM's move
// stays unguarded, ADR-0040). A hint member may also return server signals for the check's
// result (`withSignals`, OQ-FOG-58: fog's `fog.sight`).
import type { MoveHint, SegmentsHint, TokenRecord } from "@shared/scenes-map/schemas";
import { CommandError, conflict } from "../../commands/errors";
import type { Actor } from "../../events/types";
import { type ResultSignal, withSignals } from "../../ws/signals";
import { fogSightHint } from "../fog-of-war/sight-hint";
import { scnWallGuard } from "../scene-tools/guard";
import type { SceneRead } from "./visibility-hooks";

export interface MoveGuardEnv {
  /** Read-only access to the move's transaction (committed state at drop, SCN §11). */
  read: SceneRead;
  actor: Actor;
}

/**
 * A `map.checkMove` hint (FR-SCN-38, FR-FOG-53), a tagged union on `guard`: a guard's segments
 * `[x1, y1, x2, y2]` in grid units, or fog's `{guard: "fog-sight", tokenId, see, dark}`.
 */
export type MoveGuardHint = MoveHint;

/** What a guard may return instead of throwing. */
export interface MoveGuardVerdict {
  /** Refuse with `conflict(refuse)`. */
  refuse?: string;
  hint?: Pick<SegmentsHint, "segments">;
}

export type MoveGuard = (
  env: MoveGuardEnv,
  token: TokenRecord,
  from: { col: number; row: number },
  to: { col: number; row: number },
) => MoveGuardVerdict | undefined;

/** `map.checkMove`'s answer (FR-SCN-38, FR-FOG-53). */
export interface MoveCheck {
  ok: boolean;
  hints: MoveGuardHint[];
}

export interface MoveGuardRegistration {
  /** `<feature>.<what>`, unique. */
  name: string;
  guard: MoveGuard;
}

/** A hint member's answer: the hint, plus signals the check's result carries (OQ-FOG-58). */
export interface MoveHintResult {
  hint: MoveGuardHint;
  signals?: readonly ResultSignal[];
}

/**
 * A hint-phase member (ADR-0047): read-only, run by `check` only when every guard passed. `env`
 * carries the real sender (the DM for a DM drag). Never runs in `map.moveToken`.
 */
export interface MoveHintRegistration {
  /** `<feature>.<what>`, unique. */
  name: string;
  hint(
    env: MoveGuardEnv,
    token: TokenRecord,
    to: { col: number; row: number },
  ): MoveHintResult | undefined;
}

/** The registry. Append your feature's line; order = run order. */
export const moveGuards: readonly MoveGuardRegistration[] = [
  scnWallGuard, // scene-tools: walls and non-open doors refuse a player's move (FR-SCN-10/11)
];

/** The hint phase (ADR-0047). Append your feature's line; order = hint order. */
export const moveHints: readonly MoveHintRegistration[] = [
  fogSightHint, // fog-of-war: the source's sight at the previewed cell (FR-FOG-53)
];

/** A dry run's gate as the token's owner (a DM drag, FR-FOG-53 review A2). */
export interface CheckAs {
  role: "player";
  playerId: string;
}

type Cell = { col: number; row: number };

/** Live guard list, seeded from the registry; tests may add guards via `register`. */
export class MoveGuards {
  private list: MoveGuardRegistration[] = [];
  private hintList: MoveHintRegistration[] = [];

  constructor(
    initial: readonly MoveGuardRegistration[] = [],
    hints: readonly MoveHintRegistration[] = [],
  ) {
    for (const g of initial) this.register(g.name, g.guard);
    for (const h of hints) this.registerHint(h);
  }

  register(name: string, guard: MoveGuard): void {
    if (this.list.some((g) => g.name === name)) {
      throw new Error(`Move guard "${name}" registered twice`);
    }
    this.list.push({ name, guard });
  }

  registerHint(h: MoveHintRegistration): void {
    if (this.hintList.some((x) => x.name === h.name)) {
      throw new Error(`Move hint "${h.name}" registered twice`);
    }
    this.hintList.push(h);
  }

  /** Test support: remove a guard or hint member registered by a test. */
  unregister(name: string): void {
    this.list = this.list.filter((g) => g.name !== name);
    this.hintList = this.hintList.filter((h) => h.name !== name);
  }

  /** Runs every guard in list order; the first throw or `refuse` refuses the move. */
  run(env: MoveGuardEnv, token: TokenRecord, from: Cell, to: Cell): void {
    for (const g of this.list) {
      const v = g.guard(env, token, from, to);
      if (v?.refuse !== undefined) throw conflict(v.refuse);
    }
  }

  /**
   * Dry run for `map.checkMove` (FR-SCN-38): every guard runs; a `refuse` or a thrown `conflict`
   * makes `ok` false; hints are collected in list order. Other errors propagate. Then the hint
   * phase (ADR-0047), only when every guard passed (with `as`: passed for that player). The
   * result may carry the hint members' signals (`resultSignals`).
   */
  check(
    env: MoveGuardEnv,
    token: TokenRecord,
    from: Cell,
    to: Cell,
    opts: { as?: CheckAs } = {},
  ): MoveCheck {
    const out = this.dry(env, token, from, to);
    const as = opts.as;
    const owner = as
      ? { ...env, actor: { ...env.actor, role: as.role, playerId: as.playerId } }
      : null;
    if (!(owner ? this.dry(owner, token, from, to).ok : out.ok)) return out;
    const signals: ResultSignal[] = [];
    for (const h of this.hintList) {
      const r = h.hint(env, token, to);
      if (!r) continue;
      out.hints.push(r.hint);
      if (r.signals) signals.push(...r.signals);
    }
    return withSignals(out, signals);
  }

  private dry(env: MoveGuardEnv, token: TokenRecord, from: Cell, to: Cell): MoveCheck {
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
export const tokenMoveGuards = new MoveGuards(moveGuards, moveHints);
