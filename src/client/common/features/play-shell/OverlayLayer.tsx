// The overlay layer (FR-SHELL-112 (2), -135): the registered overlays of this client, in `layer`
// order, above the alert flash and below the dice layer. While an entry blocks input, everything
// else on the page is `inert` and unreachable (`input-block.ts`) and the placer's settles queue.
import type { RecordStore } from "@shared/protocol/store";
import { useContext, useEffect, useRef } from "react";
import { createStore, type StoreApi, useStore } from "zustand";
import { SyncContext } from "../../sync/store";
import { blockInput, FOCUSABLE } from "./input-block";
import { blockingOverlay, OVERLAYS, type OverlayEntry, overlaysFor } from "./overlays";
import type { ShellClient } from "./registry";
import { useSetShellBlocked } from "./ShellContext";

/** The overlay layer's stacking slot: above the alert flash (z-100), below the dice layer. */
export const OVERLAY_LAYER_Z = 1000;

const NO_SYNC = createStore<{ store: RecordStore | undefined }>()(() => ({ store: undefined }));

export function OverlayLayer({
  client,
  entries = OVERLAYS,
}: {
  client: ShellClient;
  /** The registry (tests pass their own). */
  entries?: readonly OverlayEntry[];
}) {
  const mine = overlaysFor(client, entries);
  const sync = useContext(SyncContext) as StoreApi<{ store: RecordStore | undefined }> | null;
  const blocking = useStore(sync ?? NO_SYNC, (s) =>
    s.store ? (blockingOverlay(mine, s.store)?.id ?? null) : null,
  );
  const setBlocked = useSetShellBlocked();
  const layer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = layer.current;
    const host = el?.parentElement;
    const overlay = blocking
      ? el?.querySelector<HTMLElement>(`[data-overlay-id="${blocking}"]`)
      : null;
    if (!el || !host || !overlay) return;
    setBlocked(true);
    const release = blockInput({
      overlay: {
        contains: (n) => overlay.contains(n as Node | null),
        focusables: () => [...overlay.querySelectorAll<HTMLElement>(FOCUSABLE)],
        focus: (o) => overlay.focus(o),
      },
      siblings: [...host.children].filter((c): c is HTMLElement => c !== el && "inert" in c),
      win: window,
      doc: document,
    });
    return () => {
      release();
      setBlocked(false);
    };
  }, [blocking, setBlocked]);
  if (mine.length === 0) return null;
  return (
    <div
      ref={layer}
      data-testid="ui-overlay-layer"
      data-blocking={blocking ?? undefined}
      className="pointer-events-none absolute inset-0"
      style={{ zIndex: OVERLAY_LAYER_Z }}
    >
      {mine.map((o) => (
        // The entry's own root takes pointer events (`pointer-events-auto`) where it shows.
        <div
          key={o.id}
          data-overlay-id={o.id}
          tabIndex={-1}
          className="pointer-events-none absolute inset-0 outline-none"
          style={{ zIndex: o.layer }}
        >
          <o.Component />
        </div>
      ))}
    </div>
  );
}
