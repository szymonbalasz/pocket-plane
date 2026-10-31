// Connection indicator + reconnect banner (FR-SYNC-24, SYNC §7). The indicator is the first part
// of the top bar's status pill (kit-parity FR-KIT-13): a dot and "Live", "Reconnecting…", ….
import { useEffect, useState } from "react";
import { Tooltip } from "../../components/ui/overlays";
import { Alert } from "../../components/ui/primitives";
import { cn } from "../../lib/utils";
import { useSync } from "../../sync/store";
import { type Rect, TOP_BAR_H, type Viewport } from "../play-shell/geometry";
import { RAIL_CLEAR } from "../play-shell/placement";

/** The pill's word per state ("Connected" reads "Live", FR-KIT-13). */
export const CONNECTION_LABEL = {
  connecting: "Connecting…",
  live: "Live",
  reconnecting: "Reconnecting…",
  waiting: "Waiting",
  rejected: "Rejected",
} as const;

const TOOLTIP = { ...CONNECTION_LABEL, live: "Connected" } as const;

export function ConnectionIndicator() {
  const state = useSync((s) => s.state);
  return (
    <Tooltip content={TOOLTIP[state]}>
      <span
        data-testid="sync-connection-status"
        data-state={state}
        className="inline-flex items-center gap-1.5 whitespace-nowrap"
      >
        <span
          aria-hidden="true"
          data-slot="topbar-status-dot"
          className={cn(
            "size-2 rounded-full",
            state === "live"
              ? "bg-success"
              : state === "rejected"
                ? "bg-destructive"
                : "bg-warning",
          )}
        />
        {CONNECTION_LABEL[state]}
      </span>
    </Tooltip>
  );
}

/** FR-SYNC-41: the banner's top, just below the top bar. */
export const RECONNECT_BANNER_TOP = TOP_BAR_H + 4;

/**
 * FR-SYNC-41: where a banner of `w` × `h` draws: centred, between gutters as wide as the tool
 * rail's clearance on both sides, so no width reaches the rail. As `ReconnectBannerSlot` lays it out.
 */
export function reconnectBannerBox(vp: Viewport, w: number, h: number): Rect {
  const width = Math.min(w, vp.w - 2 * RAIL_CLEAR);
  return { x: (vp.w - width) / 2, y: RECONNECT_BANNER_TOP, w: width, h };
}

/**
 * FR-SYNC-41 (BL-164, BL-171): the banner's place in the frame. Moved off the rail, and
 * click-through: windows can be anywhere, so only `pointer-events: none` keeps every close button
 * under it working. Its own controls (none today) take clicks.
 */
export function ReconnectBannerSlot() {
  return (
    <div
      data-testid="sync-reconnect-slot"
      className="pointer-events-none absolute inset-x-0 z-30 flex justify-center"
      style={{ top: RECONNECT_BANNER_TOP, paddingInline: RAIL_CLEAR }}
    >
      <ReconnectBanner />
    </div>
  );
}

/** "Reconnecting…" after 1 s not live; after 60 s adds "Server unreachable". */
export function ReconnectBanner() {
  const notLiveSince = useSync((s) => s.notLiveSince);
  const state = useSync((s) => s.state);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (notLiveSince === null) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [notLiveSince]);
  if (notLiveSince === null || state === "rejected" || state === "waiting") return null;
  const elapsed = now - notLiveSince;
  if (elapsed < 1000) return null;
  return (
    <Alert
      variant="warning"
      data-testid="sync-reconnect-banner"
      className="pointer-events-none w-auto max-w-full rounded-md bg-background/90 px-3 py-1.5 text-center [&_a]:pointer-events-auto [&_button]:pointer-events-auto"
    >
      Reconnecting…
      {elapsed >= 60_000 && (
        <span data-testid="sync-reconnect-unreachable">
          {" "}
          Server unreachable — check with your DM.
        </span>
      )}
    </Alert>
  );
}
