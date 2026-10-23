// One `stats.query` the window shows (FR-STATS-17, -23, -24), pure (clock and sender injected):
// - `set(input)` asks at once (open, tab / picker change); an older input's answer is dropped;
// - `poke()` (a live log upsert) asks again 1 s later (trailing; pokes in between coalesce);
// - `snapshot()` (each snapshot: reconnect, resync) asks at once;
// - while hidden (minimised) nothing is asked: a poke or snapshot marks it, and showing asks;
// - one request in flight; a request wanted meanwhile follows when it answers.
// The last answer stays while a new one loads or fails (offline = muted, FR-STATS-24).
// *(Sprint 9)* FR-STATS-69 (BL-74): an answer `conflict` (over the per-viewer rate, no memo) keeps
// what shows, no error, and asks once more `CONFLICT_RETRY_MS` later with the latest input; only a
// second `conflict` in a row is an error ("Couldn't load stats" + Retry).
import { REFRESH_MS } from "./logic";

/** FR-STATS-69: the quiet retry after a `conflict` answer, ms. */
export const CONFLICT_RETRY_MS = 1000;

export type QueryStatus = "loading" | "ok" | "error";

export interface QueryState<I, R> {
  input: I | null;
  status: QueryStatus;
  /** The last answer (for `input`, or an older one while loading after a change). */
  result: R | null;
  /** The input `result` answers. */
  resultFor: I | null;
  /** The last reject's code and message (status `error`). */
  error: { code: string; message: string } | null;
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}

const browserTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as number),
};

export function createStatsQuery<I, R>(opts: {
  /** Sends the intent; resolves with the parsed ack, rejects with `{code, message}`. */
  send(input: I): Promise<R>;
  onChange(s: QueryState<I, R>): void;
  timers?: Timers;
  /** The same input asked again? (deep: inputs are small JSON objects). */
  same?: (a: I, b: I) => boolean;
}) {
  const timers = opts.timers ?? browserTimers;
  const same = opts.same ?? ((a: I, b: I) => JSON.stringify(a) === JSON.stringify(b));
  let state: QueryState<I, R> = {
    input: null,
    status: "loading",
    result: null,
    resultFor: null,
    error: null,
  };
  let shown = true;
  let dirty = false;
  let timer: unknown = null;
  let inFlight = false;
  let again = false;
  let disposed = false;
  let asked = 0;
  /** FR-STATS-69: the next request is the one quiet retry after a `conflict`. */
  let conflictRetry = false;

  const emit = (patch: Partial<QueryState<I, R>>) => {
    state = { ...state, ...patch };
    if (!disposed) opts.onChange(state);
  };
  const cancelTimer = () => {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
  };

  function ask() {
    cancelTimer();
    const input = state.input;
    if (input === null || disposed) return;
    if (!shown) {
      dirty = true;
      return;
    }
    dirty = false;
    if (inFlight) {
      again = true;
      return;
    }
    inFlight = true;
    const id = ++asked;
    const retried = conflictRetry;
    conflictRetry = false;
    if (state.status !== "loading") emit({ status: "loading" });
    opts.send(input).then(
      (result) =>
        done(id, input, () => emit({ status: "ok", result, resultFor: input, error: null })),
      (err: unknown) =>
        done(id, input, () => {
          const e = err as { code?: unknown; message?: unknown };
          // FR-STATS-69: keep what shows (still loading, no error) and ask once more in 1 s with
          // the latest input; a request already wanted asks at once instead.
          if (e?.code === "conflict" && !retried) {
            if (again) return;
            cancelTimer();
            conflictRetry = true;
            timer = timers.setTimeout(ask, CONFLICT_RETRY_MS);
            return;
          }
          emit({
            status: "error",
            error: {
              code: typeof e?.code === "string" ? e.code : "error",
              message: typeof e?.message === "string" ? e.message : "Request failed",
            },
          });
        }),
    );
  }

  function done(id: number, input: I, apply: () => void) {
    inFlight = false;
    if (disposed) return;
    // An answer for an input no longer shown is dropped (a picker change wins).
    if (id === asked && state.input !== null && same(state.input, input)) apply();
    if (again) {
      again = false;
      ask();
    }
  }

  return {
    get state() {
      return state;
    },
    /** A new input asks at once; the same one is a no-op. */
    set(input: I) {
      if (state.input !== null && same(state.input, input)) return;
      conflictRetry = false; // a new input gets its own quiet retry (FR-STATS-69)
      emit({ input, status: "loading", error: null });
      ask();
    },
    /** FR-STATS-17: a live log upsert; asks once, `REFRESH_MS` after the first poke. */
    poke() {
      if (state.input === null || disposed) return;
      if (!shown) {
        dirty = true;
        return;
      }
      if (timer === null) timer = timers.setTimeout(ask, REFRESH_MS);
    },
    /** A snapshot (reconnect / resync): asks at once (FR-STATS-23). */
    snapshot() {
      ask();
    },
    retry() {
      ask();
    },
    /** FR-STATS-17: minimised → nothing asked; shown again after a change → asks at once. */
    setShown(next: boolean) {
      if (shown === next) return;
      shown = next;
      if (!shown) {
        if (timer !== null) dirty = true;
        cancelTimer();
      } else if (dirty) {
        ask();
      }
    },
    dispose() {
      disposed = true;
      cancelTimer();
    },
  };
}

export type StatsQuery<I, R> = ReturnType<typeof createStatsQuery<I, R>>;
