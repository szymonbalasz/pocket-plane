// "New" dot while minimised (FR-SHELL-38, N1 #190). A window type may declare `activity(store)`;
// the shell takes a baseline when it sees the window minimised and shows a dot on its launcher
// button while the current value differs. Restore or close drops the baseline (no dot; a closed
// window never has one). Client memory only: nothing stored or sent.
import type { RecordStore } from "@shared/protocol/store";
import { useRef } from "react";
import { useSync } from "../../sync/store";
import type { Windows } from "./manager";
import type { WindowDef } from "./registry";
import { useRegistry, useShellState } from "./ShellContext";

export type ActivityValue = string | number | null;

/** Kinds whose `activity` already threw on this page: logged once (FR-SHELL-38). */
const warned = new Set<string>();

/** `def.activity(store)`, or null when it has none or it throws (logged once per kind). */
export function readActivity(
  def: Pick<WindowDef, "kind" | "activity">,
  store: RecordStore,
  warn: (msg: string, err: unknown) => void = (m, e) => console.warn(m, e),
): ActivityValue {
  if (!def.activity) return null;
  try {
    return def.activity(store);
  } catch (err) {
    if (!warned.has(def.kind)) warn(`window ${def.kind}: activity() threw`, err);
    warned.add(def.kind);
    return null;
  }
}

export interface ActivityBaselines {
  /** Layout key the baselines belong to; a new key (campaign switch) starts over. */
  key: string | null;
  /** Window id (`kind:instance`) → value when it was first seen minimised. */
  values: ReadonlyMap<string, ActivityValue>;
}

export const NO_BASELINES: ActivityBaselines = { key: null, values: new Map() };

const idOf = (w: { kind: string; instance: string }) => `${w.kind}:${w.instance}`;

/**
 * Baselines after the layout changed. A window seen minimised without one gets the current value
 * (at minimise; for a layout restored after load, that is after the first snapshot, since the
 * layout key comes from it); any other state drops it. Returns `prev` when nothing changed.
 */
export function nextBaselines(
  prev: ActivityBaselines,
  key: string | null,
  windows: Windows,
  read: (kind: string) => ActivityValue,
): ActivityBaselines {
  const base = prev.key === key ? prev.values : new Map<string, ActivityValue>();
  const next = new Map<string, ActivityValue>();
  let changed = base !== prev.values;
  for (const w of windows) {
    if (w.state !== "minimised") continue;
    const id = idOf(w);
    if (base.has(id)) next.set(id, base.get(id) ?? null);
    else {
      next.set(id, read(w.kind));
      changed = true;
    }
  }
  if (next.size !== base.size) changed = true;
  return changed ? { key, values: next } : prev;
}

/** Kinds whose launcher button shows the dot: minimised, and the value moved off its baseline. */
export function activityDots(
  baselines: ActivityBaselines,
  windows: Windows,
  read: (kind: string) => ActivityValue,
): Set<string> {
  const out = new Set<string>();
  for (const w of windows) {
    if (w.state !== "minimised") continue;
    const id = idOf(w);
    if (!baselines.values.has(id)) continue;
    if (!Object.is(read(w.kind), baselines.values.get(id))) out.add(w.kind);
  }
  return out;
}

/** FR-SHELL-38: kinds whose launcher button shows the "new" dot now. */
export function useActivityDots(windows: Windows): ReadonlySet<string> {
  const registry = useRegistry();
  const store = useSync((s) => s.store);
  const key = useShellState((s) => s.key);
  const read = (kind: string) => {
    const def = registry.get(kind);
    return def ? readActivity(def, store) : null;
  };
  // Baselines are taken while rendering the layout change that minimised the window, so they hold
  // the store as it was then. Idempotent: a repeated render keeps the same baselines.
  const ref = useRef<ActivityBaselines>(NO_BASELINES);
  ref.current = nextBaselines(ref.current, key, windows, read);
  return activityDots(ref.current, windows, read);
}
