// Window-type registry contract (FR-SHELL-07, ADR-0025). Each client has one append-only list:
// `src/client/dm/windows.ts`, `src/client/player/windows.ts`. A feature adds a window by adding
// one line there; no shell code changes.

import { WindowKind } from "@shared/play-shell/layout";
import type { RecordStore } from "@shared/protocol/store";
import type { ComponentType } from "react";

export type ShellClient = "dm" | "player";

export type Anchor = "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";

/**
 * Where a window opens the first time. `dx` / `dy` move it inwards from the anchor (px);
 * top anchors are measured from below the top bar. Resolved against the viewport when the
 * default geometry is first needed, then stored as absolute px.
 */
export interface DefaultPosition {
  anchor: Anchor;
  dx?: number;
  dy?: number;
}

export interface Size {
  w: number;
  h: number;
}

/** What the shell passes to a window body: its identity only, never data (SHELL §9). */
export interface WindowProps {
  kind: string;
  instance: string;
}

export interface LauncherEntry {
  icon: ComponentType<{ className?: string }>;
  label: string;
  /** Ascending, left to right. */
  order: number;
}

export interface WindowDef {
  /** `<prefix>.<name>`, e.g. `camp.players`. */
  kind: string;
  title: string;
  clients: readonly ShellClient[];
  defaultSize: Size;
  minSize: Size;
  defaultPosition: DefaultPosition;
  /** Part of the client's default layout. */
  defaultOpen?: boolean;
  /**
   * Always opens at its default rect, even over other windows (test-mode windows: fixed
   * spots walkthroughs rely on). Otherwise a first open goes to the next free slot in its
   * default column or at the left / right edge, never mid-map (`placement.ts`, #162).
   */
  fixedDefault?: boolean;
  /**
   * Opt-in open height, px (FR-NOTE-31 ruling): with no full-size free slot at an edge, the
   * window opens at this height (clamped to the usable area) on top of others, covering the
   * least, instead of shrinking to a free slot. Absent → it shrinks as usual (≥ min size).
   */
  minOpenH?: number;
  /** No entry = no launcher button (open via `openWindow` only). */
  launcher?: LauncherEntry;
  /** Read from the synced store; false → not rendered, not in the launcher, saved state kept. */
  available?: (store: RecordStore) => boolean;
  /**
   * Launcher badge, e.g. unread count (OQ-NOTE-13, #142); ≤ 0 = no badge. May read client state
   * outside the store; its owner calls `refreshBadges()` (`./badges`) when that changes.
   */
  badge?: (store: RecordStore) => number;
  /**
   * "New" dot while minimised (FR-SHELL-38, `./activity`): a pure read of the synced store. The
   * launcher shows a dot while the value differs from the one at minimise; restore or close
   * clears it. Independent of `badge`.
   */
  activity?: (store: RecordStore) => string | number | null;
  /**
   * Grow to content (FR-SHELL-39): until the user resizes it (`fixedH`), the rendered height
   * follows the measured content, up to the work area; render-only. The body is laid out at its
   * natural height (a root `h-full` resolves to auto), so the whole body scrolls past the cap.
   */
  growToContent?: true;
  /**
   * `false`: loads closed when the layout entry is applied, geometry kept (FR-SHELL-42), for a
   * window whose content needs a target only a feature can give (e.g. the handout viewer).
   */
  restoreOpen?: false;
  /**
   * Always mounted while the kind is available, whatever the window state (e.g. the toast
   * runtime of `note.history`). Renders its own UI, if any; gets no props.
   */
  companion?: ComponentType;
  component: ComponentType<WindowProps>;
}

export interface WindowRegistry {
  client: ShellClient;
  defs: readonly WindowDef[];
  get(kind: string): WindowDef | undefined;
}

/** Identity helper so feature files get type checking without importing the registry list. */
export function defineWindow(def: WindowDef): WindowDef {
  return def;
}

/**
 * Builds one client's registry. Throws on a bad kind, a duplicate kind, a def not meant for
 * this client, or a default size below the min size: a broken registration fails at load.
 */
export function createWindowRegistry(
  client: ShellClient,
  defs: readonly WindowDef[],
): WindowRegistry {
  const byKind = new Map<string, WindowDef>();
  for (const def of defs) {
    if (!WindowKind.safeParse(def.kind).success) {
      throw new Error(`window kind "${def.kind}" must match <prefix>.<name>`);
    }
    if (byKind.has(def.kind)) throw new Error(`window kind "${def.kind}" registered twice`);
    if (!def.clients.includes(client)) {
      throw new Error(`window kind "${def.kind}" is not a ${client} window`);
    }
    const { defaultSize: d, minSize: m } = def;
    if (m.w < 1 || m.h < 1 || d.w < m.w || d.h < m.h) {
      throw new Error(`window kind "${def.kind}": default size must be ≥ min size ≥ 1`);
    }
    byKind.set(def.kind, def);
  }
  return { client, defs: [...defs], get: (kind) => byKind.get(kind) };
}

/** Kinds this client may render right now (FR-SHELL-07, FR-SHELL-18). */
export function availableKinds(registry: WindowRegistry, store: RecordStore): Set<string> {
  const out = new Set<string>();
  for (const def of registry.defs) {
    let ok = true;
    try {
      ok = def.available ? def.available(store) : true;
    } catch (err) {
      console.warn(`window ${def.kind}: available() threw`, err);
      ok = false;
    }
    if (ok) out.add(def.kind);
  }
  return out;
}
