// Per-browser memory of the Party windows, never sent to the server:
// - FR-PARTY-13 seen revs (player): `localStorage` `pp.party.v1.<campaignId>.<playerId>` =
//   `{seen: {handoutId: rev}}`, ≤ 500 entries, oldest dropped;
// - FR-PARTY-11 tab choice (both): `pp.party.tab.v1.<campaignId>.<dm | playerId>`.
// As FR-SHELL-17: an invalid entry → default + console warning, the next change overwrites it;
// storage unavailable or throwing → memory only for this page, one console warning, no error UI.
import { z } from "zod";
import { createStore } from "zustand";
import { PARTY_TABS, type PartyTab } from "./logic";

export const SEEN_MAX = 500;

export const seenKey = (campaignId: string, playerId: string) =>
  `pp.party.v1.${campaignId}.${playerId}`;

export const tabKey = (campaignId: string, role: "dm" | "player", playerId: string | null) =>
  `pp.party.tab.v1.${campaignId}.${role === "dm" ? "dm" : (playerId ?? "unknown")}`;

export const SeenMap = z.strictObject({
  seen: z
    .record(z.string().min(1).max(64), z.int().min(1))
    .refine((m) => Object.keys(m).length <= SEEN_MAX, { message: `≤ ${SEEN_MAX} entries` }),
});
export type SeenRevs = Readonly<Record<string, number>>;

const TabMemory = z.strictObject({ tab: z.enum(PARTY_TABS) });

export type MemoryBackend = Pick<Storage, "getItem" | "setItem">;

/** `seen` with `id` at `rev`, moved to the newest end; the oldest dropped past 500. */
export function withSeen(seen: SeenRevs, id: string, rev: number): Record<string, number> {
  const { [id]: _, ...rest } = seen;
  const next: Record<string, number> = { ...rest, [id]: rev };
  const keys = Object.keys(next);
  for (const k of keys.slice(0, Math.max(0, keys.length - SEEN_MAX))) delete next[k];
  return next;
}

export function createPartyMemory(
  getBackend: () => MemoryBackend = () => window.localStorage,
  warn: (msg: string, err?: unknown) => void = (m, e) =>
    e === undefined ? console.warn(m) : console.warn(m, e),
) {
  const memory = new Map<string, string>();
  let failed = false;
  const fail = (what: string, err: unknown) => {
    if (!failed) warn(`party-board: browser memory ${what} failed; keeping it in memory`, err);
    failed = true;
  };
  const readRaw = (key: string): string | null => {
    if (!failed) {
      try {
        return getBackend().getItem(key);
      } catch (err) {
        fail("read", err);
      }
    }
    return memory.get(key) ?? null;
  };
  const writeRaw = (key: string, value: string) => {
    memory.set(key, value);
    if (failed) return;
    try {
      getBackend().setItem(key, value);
    } catch (err) {
      fail("write", err);
    }
  };
  function parse<T>(key: string, schema: z.ZodType<T>): T | null {
    const raw = readRaw(key);
    if (raw === null) return null;
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      json = undefined;
    }
    const r = schema.safeParse(json);
    if (!r.success) {
      warn(`party-board: invalid browser memory "${key}"; using the default`);
      return null;
    }
    return r.data;
  }
  return {
    readSeen: (key: string): SeenRevs => parse(key, SeenMap)?.seen ?? {},
    writeSeen: (key: string, seen: SeenRevs) => writeRaw(key, JSON.stringify({ seen })),
    readTab: (key: string): PartyTab => parse(key, TabMemory)?.tab ?? "handouts",
    writeTab: (key: string, tab: PartyTab) => writeRaw(key, JSON.stringify({ tab })),
  };
}

export type PartyMemory = ReturnType<typeof createPartyMemory>;

/** One per page: the bound key's seen revs, reactive for the list's marks. */
export function createSeenState(mem: PartyMemory) {
  const state = createStore<{ key: string | null; seen: SeenRevs }>(() => ({
    key: null,
    seen: {},
  }));
  return {
    state,
    /** Binds the viewer's key (campaign + player); reads its revs once per key. */
    bind(key: string | null) {
      if (state.getState().key === key) return;
      state.setState({ key, seen: key ? mem.readSeen(key) : {} });
    },
    /** FR-PARTY-13: opening a handout marks it seen at its `rev`. */
    markSeen(id: string, rev: number) {
      const { key, seen } = state.getState();
      if (!key || seen[id] === rev) return;
      const next = withSeen(seen, id, rev);
      state.setState({ seen: next });
      mem.writeSeen(key, next);
    },
  };
}

/**
 * One per page: the bound key's tab (FR-PARTY-11), reactive so `openPartyTab` (FR-PARTY-30)
 * switches an open board as a click would.
 */
export function createTabState(mem: PartyMemory) {
  const state = createStore<{ key: string | null; tab: PartyTab }>(() => ({
    key: null,
    tab: "handouts",
  }));
  return {
    state,
    /** Binds the viewer's key (campaign + viewer); reads its stored tab once per key. */
    bind(key: string | null) {
      if (state.getState().key === key) return;
      state.setState({ key, tab: key ? mem.readTab(key) : "handouts" });
    },
    /** A tab click or `openPartyTab`: shown at once, stored for the key. */
    choose(key: string | null, tab: PartyTab) {
      state.setState({ key, tab });
      if (key) mem.writeTab(key, tab);
    },
  };
}

export type TabState = ReturnType<typeof createTabState>;

let page: {
  memory: PartyMemory;
  seen: ReturnType<typeof createSeenState>;
  tabs: TabState;
} | null = null;

/** The page's memory (browser `localStorage`), made on first use. */
export function partyMemory() {
  if (!page) {
    const memory = createPartyMemory();
    page = { memory, seen: createSeenState(memory), tabs: createTabState(memory) };
  }
  return page;
}
