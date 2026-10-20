// FR-DICE-07: physical-dice mode, per client, in browser storage. Shared by the log window's
// toggle and every roll control in this tab (same-tab listeners + the `storage` event).
// FR-DICE-30 / -77: the roll bar's Options state and a player's actor pick, one entry per client.
import { ENTITY_TYPE } from "@shared/entities/schemas";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { useRecords, useSync } from "../../sync/store";
import { sheetSelection } from "../character-sheet/selection";
import { type CreatureLike, pickerModel, shownSheetId } from "../character-sheet/view-model";
import {
  type ActorOption,
  createFlagStore,
  optionsKey,
  physicalKey,
  playerActorPick,
} from "./logic";

const listeners = new Set<() => void>();

function read(key: string | null): boolean {
  if (!key) return false;
  try {
    return globalThis.localStorage?.getItem(key) === "1";
  } catch {
    return false;
  }
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key?.startsWith("pp.dice.v1.")) fn();
  };
  globalThis.addEventListener?.("storage", onStorage);
  return () => {
    listeners.delete(fn);
    globalThis.removeEventListener?.("storage", onStorage);
  };
}

/** `[on, set]` for this client's campaign; off until the first snapshot. */
export function usePhysicalDice(): [boolean, (on: boolean) => void] {
  const you = useSync((s) => s.store.you);
  const key = you ? physicalKey(you.campaignId, you.role, you.playerId) : null;
  const on = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => false,
  );
  const set = useCallback(
    (v: boolean) => {
      if (!key) return;
      try {
        globalThis.localStorage?.setItem(key, v ? "1" : "0");
      } catch {
        // Storage unavailable (private mode quota): the toggle just doesn't stick.
      }
      for (const fn of [...listeners]) fn();
    },
    [key],
  );
  return [on, set];
}

// FR-DICE-30: roll-bar Options open / closed, per browser beside the FR-DICE-07 entry.
const optionsStore = createFlagStore(() => globalThis.localStorage);
const optionsListeners = new Set<() => void>();

function subscribeOptions(fn: () => void): () => void {
  optionsListeners.add(fn);
  return () => {
    optionsListeners.delete(fn);
  };
}

/** `[open, set]` for this client's campaign; closed by default (and before the first snapshot). */
export function useRollOptionsOpen(): [boolean, (open: boolean) => void] {
  const you = useSync((s) => s.store.you);
  const key = you ? optionsKey(you.campaignId, you.role, you.playerId) : null;
  // The same read as the server snapshot: static renders (tests) see the stored state too.
  const read = () => (key ? optionsStore.read(key) : false);
  const open = useSyncExternalStore(subscribeOptions, read, read);
  const set = useCallback(
    (v: boolean) => {
      if (!key) return;
      optionsStore.write(key, v);
      for (const fn of [...optionsListeners]) fn();
    },
    [key],
  );
  return [open, set];
}

/**
 * FR-DICE-77: the roll bar's actor pick, shaped as `useState`. The DM: this page's pick only (as
 * before). A player: a pick is also stored with the Options state (kept across reloads); with no
 * pick in this page, `playerActorPick` (stored pick → the sheet's PC → the only PC → "Me").
 * `set(null)` (FR-DICE-34: a stale pick answered) clears both.
 */
export function useRollBarActor(
  actors: readonly ActorOption[],
): [ActorOption | null, (a: ActorOption | null) => void] {
  const you = useSync((s) => s.store.you);
  const player = you?.role === "player";
  const key = you && player ? optionsKey(you.campaignId, you.role, you.playerId) : null;
  const [picked, setPicked] = useState<ActorOption | null>(null);
  const readActor = () => (key ? optionsStore.readActor(key) : null);
  const stored = useSyncExternalStore(subscribeOptions, readActor, readActor);
  // Not zustand's `useStore`: its server snapshot is the initial state (static render tests).
  const readSheet = () => sheetSelection.getState().selectedId;
  const selectedId = useSyncExternalStore(sheetSelection.subscribe, readSheet, readSheet);
  // The PC the sheet shows, by its own rule: its selection, else its first own PC (a fresh
  // browser shows Brakka without a pick; walkthrough U17).
  const entities = useRecords<CreatureLike>(ENTITY_TYPE);
  const sheetId = useMemo(() => {
    if (!player || !you) return null;
    const viewer = { role: you.role, playerId: you.playerId };
    return shownSheetId(pickerModel(entities, {}, viewer, [], null).options, selectedId);
  }, [player, you, entities, selectedId]);
  const set = useCallback(
    (a: ActorOption | null) => {
      setPicked(a);
      if (!key) return;
      optionsStore.writeActor(key, a ? a.value : null);
      for (const fn of [...optionsListeners]) fn();
    },
    [key],
  );
  if (!player) return [picked, set];
  return [picked ?? playerActorPick(actors, stored, sheetId), set];
}
