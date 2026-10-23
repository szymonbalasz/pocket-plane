// FR-GEM-43 (BL-68, OQ-GEM-22 A): the DM's quick + / − clicks on one gem of one character are
// summed client-side and sent as one `gem.adjust` with the net `delta`, 1.5 s after the last
// click; a sum reaching ±10 (the schema's bound) goes at once. Net 0 → nothing sent. The chip
// shows the count plus the pending sum (unsent and in flight) at once, muted until the ack: the
// count stored at the batch's first click + the sum, so the event frame (before the ack) never
// counts it twice.
// `flush` (the popover closes, the sheet unmounts) sends what is pending while live; `drop` (not
// live) forgets it, so the count reverts. A reload loses it with the page.
import { GEM_ADJUST_INTENT, GEM_DELTA_MAX, type GemKind } from "@shared/gems/schemas";

/** FR-GEM-43: quiet time after the last click before the sum is sent. */
export const AWARD_BATCH_MS = 1500;

export interface AdjustPayload {
  characterId: string;
  gem: GemKind;
  delta: number;
}

interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

interface Pending {
  characterId: string;
  gem: GemKind;
  /** The stored count at the first click (the shown count's base until all settles). */
  base: number;
  /** Clicked, not sent yet. */
  sum: number;
  /** Sent, waiting for the ack. */
  inFlight: number;
  timer: unknown;
}

export interface AwardBatch {
  /** One + (1) or − (−1) click; `stored` = the count the client has now. */
  click(characterId: string, gem: GemKind, step: 1 | -1, stored: number): void;
  /** The count to show for `stored`, and whether a sum is pending (unsent or in flight). */
  shown(characterId: string, gem: GemKind, stored: number): { count: number; pending: boolean };
  /** Sends what is pending now (all, or one character's gem). */
  flush(characterId?: string, gem?: GemKind): void;
  /** Forgets every unsent sum (not live). */
  drop(): void;
  subscribe(fn: () => void): () => void;
  /** Bumped on every change (`useSyncExternalStore`). */
  version(): number;
}

const keyOf = (characterId: string, gem: GemKind) => `${characterId}\u0000${gem}`;

export function createAwardBatch(opts: {
  /** Resolves when the intent is acked or rejected (`gem-error` shows a reject). */
  send(name: string, payload: AdjustPayload): Promise<unknown>;
  timers?: Timers;
  ms?: number;
}): AwardBatch {
  const timers: Timers = opts.timers ?? {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
  };
  const ms = opts.ms ?? AWARD_BATCH_MS;
  const rows = new Map<string, Pending>();
  const subs = new Set<() => void>();
  let ver = 0;
  const changed = () => {
    ver++;
    for (const fn of subs) fn();
  };
  const tidy = (key: string, p: Pending) => {
    if (p.sum === 0 && p.inFlight === 0 && p.timer === null) rows.delete(key);
  };
  const send = (key: string) => {
    const p = rows.get(key);
    if (!p) return;
    if (p.timer !== null) timers.clearTimeout(p.timer);
    p.timer = null;
    const delta = p.sum;
    p.sum = 0;
    if (delta !== 0) {
      p.inFlight += delta;
      const settle = () => {
        p.inFlight -= delta;
        tidy(key, p);
        changed();
      };
      void opts
        .send(GEM_ADJUST_INTENT, { characterId: p.characterId, gem: p.gem, delta })
        .then(settle, settle);
    }
    tidy(key, p);
    changed();
  };
  return {
    click(characterId, gem, step, stored) {
      const key = keyOf(characterId, gem);
      let p = rows.get(key);
      if (!p) {
        p = { characterId, gem, base: stored, sum: 0, inFlight: 0, timer: null };
        rows.set(key, p);
      }
      p.sum += step;
      if (p.timer !== null) timers.clearTimeout(p.timer);
      p.timer = null;
      if (Math.abs(p.sum) >= GEM_DELTA_MAX) {
        send(key);
        return;
      }
      p.timer = timers.setTimeout(() => send(key), ms);
      changed();
    },
    shown(characterId, gem, stored) {
      const p = rows.get(keyOf(characterId, gem));
      if (!p) return { count: stored, pending: false };
      return { count: p.base + p.sum + p.inFlight, pending: p.sum !== 0 || p.inFlight !== 0 };
    },
    flush(characterId, gem) {
      if (characterId !== undefined && gem !== undefined) send(keyOf(characterId, gem));
      else for (const key of [...rows.keys()]) send(key);
    },
    drop() {
      for (const [key, p] of rows) {
        if (p.timer !== null) timers.clearTimeout(p.timer);
        p.timer = null;
        p.sum = 0;
        tidy(key, p);
      }
      changed();
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    version: () => ver,
  };
}
