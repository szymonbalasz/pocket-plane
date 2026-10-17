// FR-DICE-37 `focusLogEntry(entryId)`: open or restore and front `dice.log` (FR-SHELL-08), scroll
// the entry into view and highlight it for 2 s (`dice-log-entry` `data-focused`). An entry not in
// the store (below the window, FR-DICE-17) → the log opens only. Client memory only. Caller: the
// roll popup (FR-DICEX-39). The window's companion (`LogFocusRuntime`) does the opening, so the
// call works whether the log is open, minimised or closed.
import { GAME_LOG_ENTRY_TYPE } from "@shared/dice-roll-log/schemas";
import { type RecordStore, recordsOf } from "@shared/protocol/store";
import { useContext, useEffect, useSyncExternalStore } from "react";
import { createStore, type StoreApi } from "zustand";
import { SyncContext } from "../../sync/store";
import { useOpenWindow } from "../play-shell/ShellContext";

/** FR-DICE-37: the highlight lasts this long. */
export const FOCUS_MS = 2000;

export interface LogFocusState {
  /** The focused entry, or null (none / the highlight ended / not in the store). */
  entryId: string | null;
  /** Bumped per call: the companion opens the log on a change, the list scrolls. */
  seq: number;
}

export interface LogFocusTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}

export interface LogFocus {
  api: StoreApi<LogFocusState>;
  focus(entryId: string): void;
  /** The entry isn't in the store: drop the highlight (the log still opens). */
  clear(seq: number): void;
}

// The browser's timers throw "Illegal invocation" when called with `this` = another object, so
// the defaults call them unbound.
const globalTimers: LogFocusTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export function createLogFocus(timers: LogFocusTimers = globalTimers): LogFocus {
  const api = createStore<LogFocusState>()(() => ({ entryId: null, seq: 0 }));
  let timer: unknown = null;
  const clear = (seq: number) => {
    if (api.getState().seq !== seq) return;
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
    api.setState({ entryId: null });
  };
  return {
    api,
    focus(entryId) {
      if (timer !== null) timers.clearTimeout(timer);
      const seq = api.getState().seq + 1;
      api.setState({ entryId, seq });
      timer = timers.setTimeout(() => clear(seq), FOCUS_MS);
    },
    clear,
  };
}

export const logFocus = createLogFocus();

/** FR-DICE-37: open / front the game log at `entryId` (highlighted 2 s). */
export function focusLogEntry(entryId: string): void {
  logFocus.focus(entryId);
}

export function useLogFocus<T>(select: (s: LogFocusState) => T, focus: LogFocus = logFocus): T {
  return useSyncExternalStore(
    focus.api.subscribe,
    () => select(focus.api.getState()),
    () => select(focus.api.getState()),
  );
}

/**
 * One focus request against the shell and the store: open / front `dice.log`; an entry the
 * store doesn't hold loses its highlight. Returns whether the entry is known.
 */
export function applyLogFocus(
  focus: LogFocus,
  store: RecordStore | undefined,
  open: (kind: string) => void,
  logKind: string,
): boolean {
  const { entryId, seq } = focus.api.getState();
  open(logKind);
  const known =
    entryId !== null &&
    !!store &&
    recordsOf<{ id: string }>(store, GAME_LOG_ENTRY_TYPE).some((e) => e.id === entryId);
  if (!known) focus.clear(seq);
  return known;
}

/** The focused entry's row in `list`, scrolled into view (nearest edge). */
export function scrollToEntry(
  list: Pick<ParentNode, "querySelector"> | null,
  entryId: string | null,
): boolean {
  if (!list || entryId === null) return false;
  // Record ids never contain quotes.
  const el = list.querySelector(`[data-testid="dice-log-entry"][data-record-id="${entryId}"]`);
  if (!el) return false;
  el.scrollIntoView({ block: "nearest" });
  return true;
}

/** `dice.log` companion: mounted while the kind is available, open or not. */
export function makeLogFocusRuntime(logKind: string) {
  return function LogFocusRuntime() {
    const open = useOpenWindow();
    const sync = useContext(SyncContext);
    const seq = useLogFocus((s) => s.seq);
    useEffect(() => {
      if (seq === 0) return;
      applyLogFocus(logFocus, sync?.getState().store, open, logKind);
    }, [seq, open, sync]);
    return null;
  };
}
