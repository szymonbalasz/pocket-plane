// Sending `map.*` intents from either client. No feature logic: the server validates and wins.
import { useCallback } from "react";
import { toast } from "sonner";
import { IntentRejected } from "../../sync/connection";
import { useSync } from "../../sync/store";

/** Typed-by-name intent sender; resolves on `ack`, rejects on `reject` / disconnect. */
export function useMapIntent(): (name: string, payload: unknown) => Promise<unknown> {
  const connection = useSync((s) => s.connection);
  return useCallback((name, payload) => connection.sendIntent(name, payload), [connection]);
}

/** Reject → Toast (FR-MAP-15). Disconnects are shown by the reconnect banner instead. */
export function toastReject(err: unknown): void {
  if (err instanceof IntentRejected) {
    if (err.code === "disconnected" || err.code === "offline") return;
    toast.error(err.message);
    return;
  }
  console.error(err);
  toast.error("Something went wrong");
}

export function useLive(): boolean {
  return useSync((s) => s.state === "live");
}
