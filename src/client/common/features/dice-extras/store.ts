// Dice-extras client memory (FR-DICEX-02, -09, -10, -18, -35): the staged tray request, the
// pending throw, the tray's last own result and the running throw with its timeline. Never
// stored or sent.
import type { DiceLook } from "@shared/dice-extras/looks";
import type { DiceThrow } from "@shared/dice-extras/throw";
import type {
  DmRollActorRef,
  GameLogEntryView,
  RollCategory,
  RollMode,
  RollPurpose,
} from "@shared/dice-roll-log/schemas";
import { useSyncExternalStore } from "react";
import { createStore, type StoreApi } from "zustand";
import type { RollControlOptions } from "../dice-roll-log/roll-control";
import type { ThrowPlan } from "./display";
import {
  FADE_MS,
  FLAT_IN_MS,
  HANDOFF_MS,
  PENDING_MS,
  REST_MS,
  REST_NO_POPUP_MS,
  SETTLE_MAX_MS,
} from "./timing";
import type { Composition, PartType } from "./tray-parts";

export { PENDING_MS };

/**
 * FR-DICEX-02: one staged request at a time (a new one replaces it). `free` = notation, palette,
 * roll bar; `control` = a roll control's options **verbatim** (Alt+click). `previewMode` = a
 * later spec's pre-roll mode (MOD R2); the tray only renders it (FR-DICEX-08 e). Sprint 15
 * (#385): a `free` request has a `purpose` (the tray's toggle, FR-DICEX-99) and, for damage, a
 * type per term; a `purpose` control keeps its edits in `edit` (FR-DICEX-97: no fresh `free`).
 */
export type TrayRequest =
  | {
      kind: "free";
      expression: string;
      mode: RollMode;
      category: RollCategory;
      label?: string;
      /** `dice.roll` actor (FR-DICE-10, -34). */
      actor?: DmRollActorRef;
      /** FR-DICEX-99: absent = plain. */
      purpose?: RollPurpose;
      /** FR-DICEX-101: damage only, one per term of `expression` (null = untyped / constant). */
      types?: (PartType | null)[];
    }
  | {
      kind: "control";
      options: RollControlOptions;
      mode: RollMode;
      previewMode?: RollMode;
      /** FR-DICEX-97: the edited dice of a `purpose` control; absent = as staged. */
      edit?: Composition;
    };

export interface DiceExtrasState {
  request: TrayRequest | null;
  /** Bumped per stage: the runtime opens the tray on a change (FR-DICEX-01). */
  staged: number;
  /**
   * Bumped when a one-shot staged request is spent (BL-112: a roll-request answer): the runtime
   * puts the tray back as it was before that stage (`trayRestore`).
   */
  restored: number;
  /** The tray's roll mode (FR-DICEX-05): the staged request's, back to normal after a roll. */
  mode: RollMode;
  /** A tray Roll is in flight (`rolling`). */
  rolling: boolean;
  /** The tray's last own roll, shown in `result` (FR-DICEX-10). */
  result: GameLogEntryView[] | null;
  /** A roll was sent and its entry hasn't arrived yet (FR-DICEX-09). */
  pending: boolean;
  /** The running throw. */
  current: ThrowRun | null;
  /** The throw a new one interrupted: snapped to rest, handing off / fading (FR-DICEX-18). */
  leaving: ThrowRun | null;
}

/**
 * FR-DICEX-35 timeline: `moving` (≤ 2.5 s) → `rest` (1 s; popups off 1.5 s) → `handoff` (0.4 s;
 * popups off: `fading`, 0.3 s) → gone. A new throw sends the running one to its hand-off at once.
 */
export type RunPhase = "moving" | "rest" | "handoff" | "fading";

export interface ThrowRun {
  t: DiceThrow;
  /** Tells a new throw from a re-render. */
  seq: number;
  plan: ThrowPlan;
  phase: RunPhase;
  /** Each entry's roller look, read when the throw starts (FR-DICEX-20). */
  looks: Record<string, DiceLook>;
}

export interface DiceExtrasTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}

export interface DiceExtrasStore {
  api: StoreApi<DiceExtrasState>;
  stage(request: TrayRequest): void;
  /** The tray's mode toggle. */
  setMode(mode: RollMode): void;
  /** Esc / Clear / the tray window closed. */
  clear(): void;
  /** BL-112: the staged request is this roll control's (`control`, its `onRoll` verbatim). */
  holds(onRoll: RollControlOptions["onRoll"]): boolean;
  /** BL-112: the staged one-shot request was spent (answered, declined): put the tray back. */
  restoreTray(): void;
  /** A roll left this client (button or tray); `tray` = from the tray (→ `rolling`). */
  sent(tray: boolean): void;
  /** The tray's roll was rejected: the shake stops, the tray goes back (FR-DICEX-09). */
  failed(): void;
  /** This client's first new own `roll` entries arrived in one frame. */
  ownRolled(entries: GameLogEntryView[]): void;
  /** A new throw (FR-DICEX-18: the running one becomes `leaving` and hands off at once). */
  play(t: DiceThrow, plan: ThrowPlan, looks?: Record<string, DiceLook>): void;
  /** The throw `seq` is at rest (the renderer's report; flat throws rest on their own). */
  rested(seq: number): void;
  /**
   * 3D failed for the throw `seq` (context lost, unmounted): it shows flat in the zone at its
   * values; with popups on it ends and its popup takes the dice.
   */
  flat(seq: number): void;
  /** The throw `seq` is gone (its hand-off / fade ended). */
  done(seq: number): void;
}

const browserTimers: DiceExtrasTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

const initial = (): DiceExtrasState => ({
  request: null,
  staged: 0,
  restored: 0,
  mode: "normal",
  rolling: false,
  result: null,
  pending: false,
  current: null,
  leaving: null,
});

export function createDiceExtrasStore(timers: DiceExtrasTimers = browserTimers): DiceExtrasStore {
  const api = createStore<DiceExtrasState>()(initial);
  let timer: unknown = null;
  let seq = 0;
  /** Each run's pending timeline step. */
  const steps = new Map<number, unknown>();
  const stopTimer = () => {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
  };
  const after = (n: number, ms: number, fn: () => void) => {
    const h = steps.get(n);
    if (h !== undefined) timers.clearTimeout(h);
    steps.set(
      n,
      timers.setTimeout(() => {
        steps.delete(n);
        fn();
      }, ms),
    );
  };
  const patch = (n: number, fn: (r: ThrowRun) => ThrowRun) =>
    api.setState((s) => ({
      current: s.current?.seq === n ? fn(s.current) : s.current,
      leaving: s.leaving?.seq === n ? fn(s.leaving) : s.leaving,
    }));
  const runOf = (n: number) => {
    const s = api.getState();
    return s.current?.seq === n ? s.current : s.leaving?.seq === n ? s.leaving : null;
  };
  const done = (n: number) => {
    const h = steps.get(n);
    if (h !== undefined) timers.clearTimeout(h);
    steps.delete(n);
    const s = api.getState();
    if (s.current?.seq === n) api.setState({ current: null });
    if (s.leaving?.seq === n) api.setState({ leaving: null });
  };
  /** Rest → hand-off / fade → gone; `restMs` 0 = at once (an interrupted throw). */
  const leave = (n: number, restMs: number) => {
    const run = runOf(n);
    if (!run) return;
    const handoff = run.plan.handoff;
    const out = () => {
      patch(n, (r) => ({ ...r, phase: handoff ? "handoff" : "fading" }));
      after(n, handoff ? HANDOFF_MS : FADE_MS, () => done(n));
    };
    if (restMs === 0) out();
    else after(n, restMs, out);
  };
  const rested = (n: number) => {
    const run = runOf(n);
    if (run?.phase !== "moving") return;
    patch(n, (r) => ({ ...r, phase: "rest" }));
    leave(n, run.plan.handoff ? REST_MS : REST_NO_POPUP_MS);
  };
  return {
    api,
    stage(request) {
      api.setState((s) => ({
        request,
        staged: s.staged + 1,
        mode: request.mode,
        rolling: false,
        result: null,
      }));
    },
    setMode(mode) {
      api.setState({ mode });
    },
    clear() {
      api.setState({ request: null, rolling: false, result: null });
    },
    holds(onRoll) {
      const r = api.getState().request;
      return r?.kind === "control" && r.options.onRoll === onRoll;
    },
    restoreTray() {
      api.setState((s) => ({ restored: s.restored + 1 }));
    },
    sent(tray) {
      stopTimer();
      timer = timers.setTimeout(() => {
        timer = null;
        api.setState({ pending: false, rolling: false });
      }, PENDING_MS);
      // FR-DICEX-05: Adv / Dis never sticks to the next tray roll (a later 50d6 would be refused).
      api.setState((s) =>
        tray
          ? { pending: true, rolling: true, mode: "normal" }
          : { pending: true, rolling: s.rolling },
      );
    },
    failed() {
      stopTimer();
      api.setState({ pending: false, rolling: false });
    },
    ownRolled(entries) {
      if (!api.getState().pending && !api.getState().rolling) return;
      stopTimer();
      api.setState((s) =>
        s.rolling ? { pending: false, rolling: false, result: entries } : { pending: false },
      );
    },
    play(t, plan, looks = {}) {
      seq += 1;
      const n = seq;
      const prev = api.getState();
      // FR-DICEX-18: one throw at a time; an older leaving throw goes at once.
      if (prev.leaving) done(prev.leaving.seq);
      const old = prev.current;
      api.setState({
        current: { t, seq: n, plan, phase: "moving", looks },
        leaving: old ? { ...old, phase: "rest" } : null,
      });
      if (old) leave(old.seq, 0);
      // Flat faces fade in, then rest; a 3D throw rests by the budget's end at the latest.
      after(n, plan.draw === "flat" ? FLAT_IN_MS : SETTLE_MAX_MS, () => rested(n));
    },
    rested,
    flat(n) {
      const run = runOf(n);
      if (!run || run.plan.draw === "flat") return;
      // Popups on: the run ends and its popup takes the dice (miniature or chips, FR-DICEX-41).
      if (run.plan.handoff) return done(n);
      patch(n, (r) => ({ ...r, plan: { ...r.plan, arena: "zone", draw: "flat" } }));
      if (run.phase === "moving") after(n, FLAT_IN_MS, () => rested(n));
    },
    done,
  };
}

/**
 * BL-112 (FR-DICEX-83): how the tray goes back once a staged roll-request answer is spent: to
 * its state before that stage. Closed → close, minimised → minimise; open stays open on the
 * result (FR-DICEX-10, as any tray roll).
 */
export function trayRestore(before: "open" | "minimised" | "closed"): "close" | "minimise" | null {
  if (before === "closed") return "close";
  if (before === "minimised") return "minimise";
  return null;
}

/** The page's one store (client memory; a reload starts `idle`, FR-DICEX-03). */
export const diceExtras = createDiceExtrasStore();

/** Client-only memory: the server snapshot is the current state too (no hydration to match). */
export function useDiceExtras<T>(selector: (s: DiceExtrasState) => T): T {
  const read = () => selector(diceExtras.api.getState());
  return useSyncExternalStore(diceExtras.api.subscribe, read, read);
}

/** Stage a request in the tray (FR-DICEX-02); the runtime opens the window. */
export const stageTray = (request: TrayRequest) => diceExtras.stage(request);
