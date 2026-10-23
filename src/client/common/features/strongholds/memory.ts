// What the `hold.stronghold` window shows (FR-HOLD-23, -24; FR-SHELL-170): the selected stronghold
// and the window's tab, client state kept per browser with the layout (as `party.handout`'s
// selection, but surviving a reload, walkthrough H11): `localStorage`
// `pp.hold.v1.<campaignId>.<dm | playerId>` = `{strongholdId, tab}`. Never sent. As FR-SHELL-17:
// an invalid entry → default + console warning; storage unavailable → memory only for this page.
// `openStronghold` selects, then opens / fronts the window (`by: "user"`, FR-SHELL-170); switching
// the selection doesn't count as "touched" (S2): it changes no geometry.
import type { You } from "@shared/protocol/frames";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { z } from "zod";
import { createStore } from "zustand";
import { useSync } from "../../sync/store";
import type { OpenBy } from "../play-shell/manager";
import { useOpenWindow } from "../play-shell/ShellContext";
import { HOLD_TABS, HOLD_WINDOW_KIND, type HoldTab } from "./logic";

export type MemoryBackend = Pick<Storage, "getItem" | "setItem">;

export const holdKey = (you: You | null) =>
  you
    ? `pp.hold.v1.${you.campaignId}.${you.role === "dm" ? "dm" : (you.playerId ?? "unknown")}`
    : null;

const Entry = z.strictObject({
  strongholdId: z.string().min(1).max(64).nullable(),
  tab: z.enum(HOLD_TABS),
});
export type HoldSelection = z.infer<typeof Entry>;

const EMPTY: HoldSelection = { strongholdId: null, tab: "facilities" };

export function createHoldMemory(
  getBackend: () => MemoryBackend = () => window.localStorage,
  warn: (msg: string) => void = (m) => console.warn(m),
) {
  const state = createStore<{ key: string | null } & HoldSelection>(() => ({
    key: null,
    ...EMPTY,
  }));
  const memory = new Map<string, string>();
  let failed = false;
  const fail = () => {
    if (!failed) warn("strongholds: browser memory failed; keeping it in memory");
    failed = true;
  };
  const read = (key: string): HoldSelection => {
    let raw: string | null = memory.get(key) ?? null;
    if (!failed) {
      try {
        raw = getBackend().getItem(key);
      } catch {
        fail();
      }
    }
    if (raw === null) return EMPTY;
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      json = undefined;
    }
    const r = Entry.safeParse(json);
    if (r.success) return r.data;
    warn(`strongholds: invalid browser memory "${key}"; using the default`);
    return EMPTY;
  };
  const write = (key: string | null, v: HoldSelection) => {
    if (!key) return;
    const raw = JSON.stringify(v);
    memory.set(key, raw);
    if (failed) return;
    try {
      getBackend().setItem(key, raw);
    } catch {
      fail();
    }
  };
  const set = (patch: Partial<HoldSelection>) => {
    const { key, strongholdId, tab } = { ...state.getState(), ...patch };
    state.setState({ key, strongholdId, tab });
    write(key, { strongholdId, tab });
  };
  return {
    state,
    /** Binds the viewer's key; reads its entry once per key. */
    bind(key: string | null) {
      if (state.getState().key === key) return;
      state.setState({ key, ...(key ? read(key) : EMPTY) });
    },
    select: (strongholdId: string) => set({ strongholdId }),
    chooseTab: (tab: HoldTab) => set({ tab }),
  };
}

export type HoldMemory = ReturnType<typeof createHoldMemory>;

let page: HoldMemory | null = null;
/** One per page. */
export function holdMemory(): HoldMemory {
  page ??= createHoldMemory();
  return page;
}

/** The bound selection of this viewer (re-renders on change). */
export function useHoldSelection(): HoldSelection & { chooseTab(t: HoldTab): void } {
  const key = useSync((s) => holdKey(s.store.you));
  const mem = holdMemory();
  useEffect(() => mem.bind(key), [mem, key]);
  const snap = () => {
    const s = mem.state.getState();
    return s.key === key ? s : null;
  };
  // Not zustand's `useStore`: its server snapshot is the initial state (static render tests).
  const s = useSyncExternalStore(mem.state.subscribe, snap, snap);
  return {
    strongholdId: s?.strongholdId ?? null,
    tab: s?.tab ?? "facilities",
    chooseTab: mem.chooseTab,
  };
}

export type OpenWindowFn = (kind: string, instance?: string, opts?: { by?: OpenBy }) => void;

/**
 * Opens (or restores / fronts) `hold.stronghold` on `strongholdId` (FR-HOLD-23). Callers: the
 * Strongholds tab's Open, a reminder's link icon (FR-REM-18, RS1), a loot-log Stores name (RS3).
 */
export function openStronghold(
  strongholdId: string,
  deps: { you: You | null; open: OpenWindowFn; memory?: HoldMemory },
) {
  const mem = deps.memory ?? holdMemory();
  mem.bind(holdKey(deps.you));
  mem.select(strongholdId);
  deps.open(HOLD_WINDOW_KIND, undefined, { by: "user" });
}

/** `openStronghold` bound to this client's viewer and window manager. */
export function useOpenStronghold(): (strongholdId: string) => void {
  const you = useSync((s) => s.store.you);
  const open = useOpenWindow();
  return useCallback((id: string) => openStronghold(id, { you, open }), [you, open]);
}
