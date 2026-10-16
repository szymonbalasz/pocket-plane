// Dice-extras client memory (FR-DICEX-02, -09, -10, -18): the staged tray request, the pending
// throw, the tray's last own result and the running throw. Never stored or sent.
import type { DiceThrow } from "@shared/dice-extras/throw";
import type {
  DmRollActorRef,
  GameLogEntryView,
  RollCategory,
  RollMode,
} from "@shared/dice-roll-log/schemas";
import { useSyncExternalStore } from "react";
import { createStore, type StoreApi } from "zustand";
import type { RollControlOptions } from "../dice-roll-log/roll-control";

/** FR-DICEX-09: a pending throw ends after this long without an own `roll` entry. */
export const PENDING_MS = 3000;

/**
 * FR-DICEX-02: one staged request at a time (a new one replaces it). `free` = notation, palette,
 * roll bar; `control` = a roll control's options **verbatim** (Alt+click). `previewMode` = a
 * later spec's pre-roll mode (MOD R2); the tray only renders it (FR-DICEX-08 e).
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
    }
  | { kind: "control"; options: RollControlOptions; mode: RollMode; previewMode?: RollMode };

export interface DiceExtrasState {
  request: TrayRequest | null;
  /** Bumped per stage: the runtime opens the tray on a change (FR-DICEX-01). */
  staged: number;
  /** A tray Roll is in flight (`rolling`). */
  rolling: boolean;
  /** The tray's last own roll, shown in `result` (FR-DICEX-10). */
  result: GameLogEntryView[] | null;
  /** A roll was sent and its entry hasn't arrived yet (FR-DICEX-09). */
  pending: boolean;
  /** The running throw; `seq` tells a new throw from a re-render. */
  current: { t: DiceThrow; seq: number } | null;
}

export interface DiceExtrasTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}

export interface DiceExtrasStore {
  api: StoreApi<DiceExtrasState>;
  stage(request: TrayRequest): void;
  /** Esc / Clear / the tray window closed. */
  clear(): void;
  /** A roll left this client (button or tray); `tray` = from the tray (→ `rolling`). */
  sent(tray: boolean): void;
  /** The tray's roll was rejected: the shake stops, the tray goes back (FR-DICEX-09). */
  failed(): void;
  /** This client's first new own `roll` entries arrived in one frame. */
  ownRolled(entries: GameLogEntryView[]): void;
  /** A new throw (FR-DICEX-18: it replaces the running one). */
  play(t: DiceThrow): void;
  /** The throw `seq` faded out. */
  done(seq: number): void;
}

const browserTimers: DiceExtrasTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

const initial = (): DiceExtrasState => ({
  request: null,
  staged: 0,
  rolling: false,
  result: null,
  pending: false,
  current: null,
});

export function createDiceExtrasStore(timers: DiceExtrasTimers = browserTimers): DiceExtrasStore {
  const api = createStore<DiceExtrasState>()(initial);
  let timer: unknown = null;
  let seq = 0;
  const stopTimer = () => {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
  };
  return {
    api,
    stage(request) {
      api.setState((s) => ({ request, staged: s.staged + 1, rolling: false, result: null }));
    },
    clear() {
      api.setState({ request: null, rolling: false, result: null });
    },
    sent(tray) {
      stopTimer();
      timer = timers.setTimeout(() => {
        timer = null;
        api.setState({ pending: false, rolling: false });
      }, PENDING_MS);
      api.setState((s) => ({ pending: true, rolling: tray || s.rolling }));
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
    play(t) {
      seq += 1;
      api.setState({ current: { t, seq } });
    },
    done(n) {
      if (api.getState().current?.seq === n) api.setState({ current: null });
    },
  };
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
