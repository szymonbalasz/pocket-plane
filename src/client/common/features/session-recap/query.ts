// One `recap.query` the Recap window shows (FR-RECAP-05, -06, -07, -17), pure (sender and timers
// injected), as stats' window query:
// - `set(input)` asks at once (open, picker change, a share's open); an older input's answer is
//   dropped;
// - `poke()` (a live log / loot upsert while the newest session shows) asks again 2 s later
//   (pokes in between coalesce);
// - `snapshot()` (reconnect, resync) asks at once;
// - while minimised nothing is asked: a poke or snapshot marks it, and showing asks;
// - a `conflict` (the per-actor rate limit) keeps the last result and asks again once, 1 s later,
//   quietly; only a second failure shows the error;
// - one request in flight; a request wanted meanwhile follows when it answers.
// The last answer stays while a new one loads or fails (offline = muted, FR-RECAP-17).
import type { QueryState, Timers } from "../stats/refresh";
import { CONFLICT_RETRY_MS, RECAP_REFRESH_MS } from "./logic";

export type { QueryState } from "../stats/refresh";

const browserTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as number),
};

export function createRecapQuery<I, R>(opts: {
  /** Sends the intent; resolves with the parsed ack, rejects with `{code, message}`. */
  send(input: I): Promise<R>;
  onChange(s: QueryState<I, R>): void;
  timers?: Timers;
}) {
  const timers = opts.timers ?? browserTimers;
  const same = (a: I, b: I) => JSON.stringify(a) === JSON.stringify(b);
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
  /** A quiet retry after a `conflict` is pending or running (one per failure). */
  let retrying = false;

  const emit = (patch: Partial<QueryState<I, R>>) => {
    state = { ...state, ...patch };
    if (!disposed) opts.onChange(state);
  };
  const cancelTimer = () => {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
  };

  function ask(quiet = false) {
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
    if (!quiet && state.status !== "loading") emit({ status: "loading" });
    opts.send(input).then(
      (result) =>
        done(id, input, () => {
          retrying = false;
          emit({ status: "ok", result, resultFor: input, error: null });
        }),
      (err: unknown) =>
        done(id, input, () => {
          const e = err as { code?: unknown; message?: unknown };
          const code = typeof e?.code === "string" ? e.code : "error";
          // FR-RECAP-05: coalesced by the rate limit → keep the last result, ask once more.
          if (code === "conflict" && !retrying) {
            retrying = true;
            if (state.result !== null) emit({ status: "ok" });
            timer = timers.setTimeout(() => ask(true), CONFLICT_RETRY_MS);
            return;
          }
          retrying = false;
          emit({
            status: "error",
            error: {
              code,
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
      retrying = false;
      emit({ input, status: "loading", error: null });
      ask();
    },
    /** FR-RECAP-06: a live upsert; asks once, `RECAP_REFRESH_MS` after the first poke. */
    poke() {
      if (state.input === null || disposed) return;
      if (!shown) {
        dirty = true;
        return;
      }
      if (timer === null) timer = timers.setTimeout(ask, RECAP_REFRESH_MS);
    },
    /** A snapshot (reconnect / resync): asks at once (FR-RECAP-07). */
    snapshot() {
      ask();
    },
    retry() {
      retrying = false;
      ask();
    },
    /** FR-RECAP-06: minimised → nothing asked; shown again after a change → asks at once. */
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

export type RecapQuery<I, R> = ReturnType<typeof createRecapQuery<I, R>>;
