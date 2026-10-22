// The overlay layer (FR-SHELL-112 (2), -135): the registered overlays of this client, in `layer`
// order, above the alert flash and below the dice layer. Portalled to `document.body` (TT4), so
// its z-index competes with every other body portal (Radix dialogs / popovers / tooltips z-50, the
// flash z-100, the toast stack): the play page is `position: fixed`, its own stacking context.
// While an entry blocks input, every other child of the body is `inert` and unreachable (incl.
// portals opened later; the dice layer is inert already and stays above) and the placer's settles
// queue (`input-block.ts`).
import type { RecordStore } from "@shared/protocol/store";
import { useContext, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
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
    const sibling = (n: Node): n is HTMLElement => n !== el && n instanceof HTMLElement;
    setBlocked(true);
    const release = blockInput({
      overlay: {
        contains: (n) => overlay.contains(n as Node | null),
        focusables: () => [...overlay.querySelectorAll<HTMLElement>(FOCUSABLE)],
        focus: (o) => overlay.focus(o),
      },
      siblings: [...host.children].filter(sibling),
      // A portal opened while blocked (a tooltip, a dialog) is a new child of the body.
      watch: (add) => {
        const mo = new MutationObserver((records) => {
          for (const r of records) for (const n of r.addedNodes) if (sibling(n)) add(n);
        });
        mo.observe(host, { childList: true });
        return () => mo.disconnect();
      },
      win: window,
      doc: document,
    });
    return () => {
      release();
      setBlocked(false);
    };
  }, [blocking, setBlocked]);
  if (mine.length === 0) return null;
  const body = typeof document === "undefined" ? undefined : document.body;
  const view = (
    <div
      ref={layer}
      data-testid="ui-overlay-layer"
      data-blocking={blocking ?? undefined}
      className="pointer-events-none fixed inset-0"
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
  return body ? createPortal(view, body) : view;
}
