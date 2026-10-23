// Window-type registry contract (FR-SHELL-07, ADR-0025). Each client has one append-only list:
// `src/client/dm/windows.ts`, `src/client/player/windows.ts`. A feature adds a window by adding
// one line there; no shell code changes.

import { WindowKind } from "@shared/play-shell/layout";
import type { You } from "@shared/protocol/frames";
import type { RecordStore } from "@shared/protocol/store";
import type { ComponentType } from "react";
import type { Viewport } from "./geometry";

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

/** Viewport classes (FR-SHELL-51): wide = vw ≥ 1440, tall = vh ≥ 900. */
export const WIDE_W = 1440;
export const TALL_H = 900;
export const isWide = (vp: Viewport) => vp.w >= WIDE_W;
export const isTall = (vp: Viewport) => vp.h >= TALL_H;
/** One viewport per class (narrow / wide × short / tall): every default size a type can have. */
export const CLASS_VIEWPORTS: readonly Viewport[] = [
  { w: 1280, h: 720 },
  { w: WIDE_W, h: 720 },
  { w: 1280, h: TALL_H },
  { w: WIDE_W, h: TALL_H },
];

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
  /** A size, or one per viewport class (FR-SHELL-51: `isWide` / `isTall`), e.g. `dice.log`. */
  defaultSize: Size | ((vp: Viewport) => Size);
  /**
   * Default sizes of earlier releases (FR-SHELL-53): a stored window still at one of them (or at
   * a default of any viewport class) takes the current viewport's default when the layout loads.
   */
  previousDefaults?: readonly Size[];
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
  /**
   * Useful size, px (FR-SHELL-79): the smallest size auto placement opens the window at while
   * auto-minimising another window can make room (FR-SHELL-77). Absent → the fitted default
   * width and `minOpenH`, else the default height up to 360; capped by the client's band.
   */
  usefulSize?: Size;
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
   * FR-SHELL-155: window kinds (removed from the registry) whose stored layout entry this type
   * takes over at `load`: an absorbed entry open or minimised, while this type is closed or has
   * no entry, gives it its state, z and (if the absorbed one was remembered) its x / y.
   */
  absorbs?: readonly string[];
  /** FR-SHELL-155: runs once after this type absorbed `fromKind`'s entry (e.g. picks a tab). */
  onAbsorb?: (fromKind: string, you: You | null) => void;
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

/** The type's default size in this viewport (FR-SHELL-51). */
export function defaultSizeAt(def: Pick<WindowDef, "defaultSize">, vp: Viewport): Size {
  return typeof def.defaultSize === "function" ? def.defaultSize(vp) : def.defaultSize;
}

/** Every default size the type has in any viewport class, then its `previousDefaults`. */
export function knownDefaultSizes(def: Pick<WindowDef, "defaultSize" | "previousDefaults">) {
  const out: Size[] = [];
  for (const s of [
    ...CLASS_VIEWPORTS.map((vp) => defaultSizeAt(def, vp)),
    ...(def.previousDefaults ?? []),
  ]) {
    if (!out.some((o) => o.w === s.w && o.h === s.h)) out.push(s);
  }
  return out;
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
    const m = def.minSize;
    for (const vp of CLASS_VIEWPORTS) {
      const d = defaultSizeAt(def, vp);
      if (m.w < 1 || m.h < 1 || d.w < m.w || d.h < m.h) {
        throw new Error(`window kind "${def.kind}": default size must be ≥ min size ≥ 1`);
      }
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
