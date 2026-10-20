// The picker's tag intents (FR-ASSET-42, -43): one in flight per form; a reject or a lost intent
// → an inline message (FR-ASSET-47). DM only: players have no picker (FR-ASSET-23, -27).
import { IntentRejected } from "@ui/sync/connection";
import { useSync } from "@ui/sync/store";
import { useState } from "react";

/** Shown on tag controls while the connection isn't live (ASSET §7). */
export const RECONNECTING = "Reconnecting…";
const LOST = "Not saved: the connection dropped. Try again.";

/** Inline text for a failed tag intent. */
export function tagIntentError(err: unknown): string {
  if (err instanceof IntentRejected) {
    return err.code === "offline" || err.code === "disconnected" ? LOST : err.message;
  }
  return "Something went wrong";
}

export function useTagIntent() {
  const connection = useSync((s) => s.connection);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Resolves the result, or `undefined` after a failure (shown in `error`). */
  const send = async (name: string, payload: unknown): Promise<{ result: unknown } | undefined> => {
    if (busy) return undefined;
    setBusy(true);
    setError(null);
    try {
      return { result: await connection.sendIntent(name, payload) };
    } catch (err) {
      setError(tagIntentError(err));
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, send };
}
