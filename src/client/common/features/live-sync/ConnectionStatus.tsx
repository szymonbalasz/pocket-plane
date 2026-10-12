// Connection indicator + reconnect banner (FR-SYNC-24, SYNC §7).
import { useEffect, useState } from "react";
import { Tooltip } from "../../components/ui/overlays";
import { Alert, Badge } from "../../components/ui/primitives";
import { cn } from "../../lib/utils";
import { useSync } from "../../sync/store";

const LABEL = {
  connecting: "Connecting…",
  live: "Connected",
  reconnecting: "Reconnecting…",
  waiting: "Waiting",
  rejected: "Rejected",
} as const;

export function ConnectionIndicator() {
  const state = useSync((s) => s.state);
  return (
    <Tooltip content={LABEL[state]}>
      <Badge variant="outline" data-testid="sync-connection-status" data-state={state}>
        <span
          className={cn(
            "size-2 rounded-full",
            state === "live"
              ? "bg-success"
              : state === "rejected"
                ? "bg-destructive"
                : "bg-warning",
          )}
        />
        {LABEL[state]}
      </Badge>
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
