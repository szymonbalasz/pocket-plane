// FR-CAMP-04/05 (#163): a WS close 4401 means a changed secret *or* the login throttle lockout
// (the server answers both the same way). Probe `POST /api/dm/login` before wiping the stored
// secret: only a 401 logs the DM out; a 429 keeps it, shows the CAMP §7 wording and retries.

/** CAMP §7 throttle wording (same as the login screen). */
export const THROTTLED_TEXT = "Too many attempts. Try again in a minute.";
/** FR-CAMP-05 lockout length: a retry after this sees the lockout over. */
export const THROTTLED_RETRY_MS = 60_000;
/** Anything else (secret works again, 5xx, unreachable): reconnect soon; the connection backs off. */
export const RECHECK_MS = 1_000;

export type RejectionOutcome = "logout" | "throttled" | "retry";

/** `status` = the login probe's HTTP status; `null` = the probe failed (network). */
export function rejectionOutcome(status: number | null): RejectionOutcome {
  if (status === 401) return "logout";
  if (status === 429) return "throttled";
  return "retry";
}

export interface RejectionDeps {
  /** `POST /api/dm/login` with the stored secret → HTTP status. */
  probe(): Promise<number>;
  /** Wipe the stored secret → login screen. */
  logout(): void;
  /** Tell the DM (THROTTLED_TEXT). */
  throttled(): void;
  /** Open a fresh connection (re-mount the sync provider). */
  reconnect(): void;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Runs once per 4401. Returns a cancel function (unmount / state change). */
export function handleDmRejection(d: RejectionDeps): () => void {
  let cancelled = false;
  let timer: unknown = null;
  void d
    .probe()
    .then(
      (s) => s,
      () => null,
    )
    .then((status) => {
      if (cancelled) return;
      const outcome = rejectionOutcome(status);
      if (outcome === "logout") return d.logout();
      if (outcome === "throttled") d.throttled();
      const wait = outcome === "throttled" ? THROTTLED_RETRY_MS : RECHECK_MS;
      timer = d.setTimeout(() => {
        timer = null;
        if (!cancelled) d.reconnect();
      }, wait);
    });
  return () => {
    cancelled = true;
    if (timer !== null) d.clearTimeout(timer);
  };
}
