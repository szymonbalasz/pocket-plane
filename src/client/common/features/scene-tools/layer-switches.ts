// DM Layers popover (FR-SCN-05): one switch per registered layer `toggle`, plus "DM-only items"
// (`dm-only`: not a layer of its own; hidden props / templates and every wall read it). Client
// only, never sent; all on by default; kept per campaign in browser storage
// (`pp.layers.v1.<campaignId>`, zod-parsed on read; storage failure → memory only, one warning).
// DOM-free.
import { z } from "zod";
import type { StorageBackend } from "../play-shell/storage";
import type { LayerToggle } from "../scenes-map/layers";

/** FR-SCN-05 "DM-only items": the key the SCN layers read (`useLayerToggles().off["dm-only"]`). */
export const DM_ONLY_SWITCH: LayerToggle = {
  key: "dm-only",
  label: "DM-only items",
  layer: "dm-only",
};

/**
 * FR-SCN-01 / -05: with "DM-only items" off, the DM client drops hidden records (tokens and their
 * labels too). Players never receive hidden ones, so they are never filtered.
 */
export function withoutDmOnly<T extends { hidden: boolean }>(
  items: readonly T[],
  client: "dm" | "player",
  off: LayersOff,
): readonly T[] {
  return client === "dm" && off[DM_ONLY_SWITCH.key] === true
    ? items.filter((t) => !t.hidden)
    : items;
}

/** The popover's switches: the registry's toggles in layer order, then DM-only items. */
export function layerSwitches(toggles: readonly LayerToggle[]): LayerToggle[] {
  return [...toggles.filter((t) => t.key !== DM_ONLY_SWITCH.key), DM_ONLY_SWITCH];
}

export const layerMemoryKey = (campaignId: string) => `pp.layers.v1.${campaignId}`;

/** Stored: the keys switched off. */
const Stored = z.strictObject({ off: z.array(z.string().min(1).max(64)).max(64) });

export type LayersOff = Readonly<Record<string, boolean>>;

/** `off` for the store from what was stored (only `true` keys). */
const toOff = (keys: readonly string[]): Record<string, boolean> =>
  Object.fromEntries(keys.map((k) => [k, true]));

export interface LayerMemory {
  /** The campaign's switched-off keys; missing → all on; invalid → all on + warning. Never throws. */
  read(campaignId: string): Record<string, boolean>;
  /** Synchronous write. Never throws. */
  write(campaignId: string, off: LayersOff): void;
}

export function createLayerMemory(
  getBackend: () => StorageBackend,
  warn: (msg: string, err?: unknown) => void = (m, e) =>
    e === undefined ? console.warn(m) : console.warn(m, e),
): LayerMemory {
  const memory = new Map<string, Record<string, boolean>>();
  let failed = false;
  const fail = (what: string, err: unknown) => {
    if (!failed)
      warn(`scene-tools: layer switches storage ${what} failed; keeping them in memory`, err);
    failed = true;
  };
  const parse = (key: string, text: string | null): Record<string, boolean> => {
    if (text === null) return {};
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    const r = Stored.safeParse(json);
    if (r.success) return toOff(r.data.off);
    warn(`scene-tools: invalid layer switches "${key}"; all layers on`);
    return {};
  };
  return {
    read(campaignId) {
      const key = layerMemoryKey(campaignId);
      const kept = memory.get(key) ?? {};
      if (failed) return { ...kept };
      try {
        return parse(key, getBackend().getItem(key));
      } catch (err) {
        fail("read", err);
        return { ...kept };
      }
    },
    write(campaignId, off) {
      const key = layerMemoryKey(campaignId);
      const keys = Object.keys(off).filter((k) => off[k] === true);
      memory.set(key, toOff(keys));
      if (failed) return;
      try {
        getBackend().setItem(key, JSON.stringify({ off: keys }));
      } catch (err) {
        fail("write", err);
      }
    },
  };
}

/** The browser's localStorage, looked up lazily (access itself can throw). */
export const browserLayerMemory = (): LayerMemory => createLayerMemory(() => window.localStorage);
