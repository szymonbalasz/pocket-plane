// FR-CMP-66 pins: per browser and campaign, `localStorage` `pp.rules.pins.v1.<campaignId>`, ≤ 30
// entry ids, newest last; never sent to the server. Storage may throw (private window, blocked
// site data): the pins then live in memory for this page, with one console warning.
import { parsePins } from "@shared/compendium/rules";
import { RULES_PINS_MAX, rulesPinsKey } from "@shared/compendium/rules-pages";
import { useSyncExternalStore } from "react";

export type PinsBackend = Pick<Storage, "getItem" | "setItem">;

export function createPins(getBackend: () => PinsBackend = () => window.localStorage) {
  const memory = new Map<string, string[]>();
  const listeners = new Set<() => void>();
  let failed = false;
  const fail = (err: unknown) => {
    if (!failed) console.warn("compendium: rules pins storage failed; keeping them in memory", err);
    failed = true;
  };
  const read = (campaignId: string): string[] => {
    const key = rulesPinsKey(campaignId);
    const held = memory.get(key);
    if (held) return held;
    let pins: string[] = [];
    if (!failed) {
      try {
        const raw = getBackend().getItem(key);
        pins = raw === null ? [] : parsePins(JSON.parse(raw));
      } catch (err) {
        if (err instanceof SyntaxError) pins = [];
        else fail(err);
      }
    }
    memory.set(key, pins);
    return pins;
  };
  const write = (campaignId: string, pins: string[]) => {
    const key = rulesPinsKey(campaignId);
    memory.set(key, pins);
    if (!failed) {
      try {
        getBackend().setItem(key, JSON.stringify(pins));
      } catch (err) {
        fail(err);
      }
    }
    for (const l of listeners) l();
  };
  return {
    get: read,
    /** Pin (appended; the oldest drops past 30) or unpin. */
    toggle(campaignId: string, id: string) {
      const pins = read(campaignId);
      write(
        campaignId,
        pins.includes(id) ? pins.filter((x) => x !== id) : [...pins, id].slice(-RULES_PINS_MAX),
      );
    },
    /** A pinned id that no longer resolves (404) leaves the list (CMP §11). */
    drop(campaignId: string, ids: readonly string[]) {
      const pins = read(campaignId);
      const next = pins.filter((x) => !ids.includes(x));
      if (next.length !== pins.length) write(campaignId, next);
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export type Pins = ReturnType<typeof createPins>;

let pins: Pins | null = null;
/** This page's pins (created on first use: `localStorage` is read lazily). */
export const rulesPins = (): Pins => {
  pins ??= createPins();
  return pins;
};

const NONE: readonly string[] = [];

/** The campaign's pins, re-rendered on every change; none before the first snapshot. */
export function usePins(campaignId: string | null): readonly string[] {
  const p = rulesPins();
  const get = () => (campaignId ? p.get(campaignId) : NONE);
  return useSyncExternalStore(p.subscribe, get, get);
}
