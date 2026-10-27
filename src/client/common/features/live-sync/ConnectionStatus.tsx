// Connection indicator + reconnect banner (FR-SYNC-24, SYNC §7). The indicator is the first part
// of the top bar's status pill (kit-parity FR-KIT-13): a dot and "Live", "Reconnecting…", ….
import { useEffect, useState } from "react";
import { Tooltip } from "../../components/ui/overlays";
import { Alert } from "../../components/ui/primitives";
import { cn } from "../../lib/utils";
import { useSync } from "../../sync/store";

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
      className="rounded-none border-x-0"
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
