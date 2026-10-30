// FR-DICEX-11: which entries throw. Live event frames only; an upsert of kind `roll` with `n` above
// the highest `n` this client had before the frame (set by each snapshot, raised per frame).
// Snapshots, resyncs and undo upserts (old `n`) never throw. No new event, signal or record.
import { GAME_LOG_ENTRY_TYPE, type GameLogEntryView } from "@shared/dice-roll-log/schemas";
import { LogEntryHiddenSet } from "@shared/events/dice-roll-log";
import type { EventFrame, You } from "@shared/protocol/frames";
import { type RecordStore, recordsOf } from "@shared/protocol/store";
import { useContext, useEffect, useRef } from "react";
import { SyncContext, type SyncStore } from "../../sync/store";

/** Highest entry `n` in a store (0 = none). */
export function maxEntryN(store: RecordStore): number {
  let max = 0;
  for (const e of recordsOf<{ n: number }>(store, GAME_LOG_ENTRY_TYPE)) if (e.n > max) max = e.n;
  return max;
}

/**
 * The frame's new `roll` entries in `n` order, as applied (`next`), given the store before it
 * (`prior`): its highest `n` is the high-water mark.
 */
export function newRollEntries(
  frame: Pick<EventFrame, "changes"> & Partial<Pick<EventFrame, "cause">>,
  prior: RecordStore,
  next: RecordStore,
): GameLogEntryView[] {
  // FR-DICE-102: a revealed line is old news, even above this client's high-water mark.
  if (frame.cause?.name === LogEntryHiddenSet.type) return [];
  const hw = maxEntryN(prior);
  const byId = next.records[GAME_LOG_ENTRY_TYPE] ?? {};
  const out: GameLogEntryView[] = [];
  for (const c of frame.changes) {
    if (c.type !== GAME_LOG_ENTRY_TYPE || c.op !== "upsert") continue;
    const e = byId[c.id] as GameLogEntryView | undefined;
    if (e && e.kind === "roll" && e.n > hw && !out.includes(e)) out.push(e);
  }
  return out.sort((a, b) => a.n - b.n);
}

/** FR-DICEX-09 / -19: an entry this client rolled (`rollerRole` / `rollerPlayerId`). */
export function isOwn(e: Pick<GameLogEntryView, "rollerRole" | "rollerPlayerId">, you: You | null) {
  if (!you) return false;
  return you.role === "dm"
    ? e.rollerRole === "dm"
    : e.rollerRole === "player" && e.rollerPlayerId === you.playerId;
}

export type RollFrameHandler = (entries: GameLogEntryView[], store: RecordStore) => void;

/**
 * Calls `handler` with each live frame's new `roll` entries (never for a snapshot). The store
 * before the frame comes from a store subscription, which runs in the same `set` as the frame,
 * just before event handlers. Returns an unsubscribe.
 */
export function subscribeRollFrames(sync: SyncStore, handler: RollFrameHandler): () => void {
  let before = sync.getState().store;
  const unStore = sync.subscribe((s, prev) => {
    if (s.store !== prev.store) before = prev.store;
  });
  const unEvent = sync.getState().connection.onEvent((frame, store) => {
    const entries = newRollEntries(frame, before, store);
    if (entries.length > 0) handler(entries, store);
  });
  return () => {
    unStore();
    unEvent();
  };
}

/** `subscribeRollFrames` for a component (the dice-extras runtime). */
export function useRollFrames(handler: RollFrameHandler) {
  const sync = useContext(SyncContext);
  if (!sync) throw new Error("useRollFrames outside SyncContext");
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => subscribeRollFrames(sync, (e, s) => ref.current(e, s)), [sync]);
}
