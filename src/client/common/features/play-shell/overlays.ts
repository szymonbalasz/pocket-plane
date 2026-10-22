// Overlay layer registry (FR-SHELL-112 (2), seams S2, ADR-0060 §7). APPEND-ONLY (AGENTS §9.9): a
// feature adds one entry to `OVERLAYS`; nothing else changes here. Overlays are not windows: never
// placed, no keep-out, no fit obstacle. The layer sits above the alert flash and below the dice
// layer (FR-SHELL-135); `layer` orders the entries inside it.
import type { RecordStore } from "@shared/protocol/store";
import type { ComponentType } from "react";
import type { ShellClient } from "./registry";

export interface OverlayEntry {
  id: string;
  clients: readonly ShellClient[];
  /** Its z-slot in the overlay layer: higher draws in front (e.g. the pause card at 10). */
  layer: number;
  /**
   * While it returns true the overlay blocks input (FR-SHELL-112 (2), review-a rulings 4, 5): every
   * sibling of the overlay layer is `inert`, focus stays in the overlay, drags in progress are
   * cancelled, the placer's settles queue until it goes, and one capture-phase `keydown` /
   * `wheel` / `pointerdown` guard on `window` stops every event from outside the overlay.
   */
  blocksInput?: (store: RecordStore) => boolean;
  /** Mounted while the client renders the page; renders nothing while it has nothing to show. */
  Component: ComponentType;
}

/** The overlay entries (append yours: TT4's pause card, after WF1). */
export const OVERLAYS: readonly OverlayEntry[] = [];

/** This client's entries, back to front. */
export function overlaysFor(
  client: ShellClient,
  list: readonly OverlayEntry[] = OVERLAYS,
): OverlayEntry[] {
  return list.filter((o) => o.clients.includes(client)).sort((a, b) => a.layer - b.layer);
}

/** Whether some entry blocks input now (a throwing predicate doesn't block). */
export function blockingOverlay(
  entries: readonly OverlayEntry[],
  store: RecordStore,
): OverlayEntry | null {
  for (const o of entries) {
    try {
      if (o.blocksInput?.(store)) return o;
    } catch (err) {
      console.warn(`overlay ${o.id}: blocksInput() threw`, err);
    }
  }
  return null;
}
