// One `hold.*` intent in flight per form (FR-HOLD-26): a reject → inline message, an intent lost
// to a disconnect → the Toast "Connection lost — check the stronghold before saving again".
import { useState } from "react";
import { toast } from "sonner";
import { useSync } from "../../sync/store";
import { intentFailure } from "../party-board/logic";
import { LOST_HOLD } from "./logic";

export function useLive(): boolean {
  return useSync((s) => s.state === "live");
}

export function useHoldIntent() {
  const connection = useSync((s) => s.connection);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The intent's result, or `undefined` after a failure (already reported). */
  const send = async (name: string, payload: unknown): Promise<{ result: unknown } | undefined> => {
    if (busy) return undefined;
    setBusy(true);
    setError(null);
    try {
      return { result: await connection.sendIntent(name, payload) };
    } catch (err) {
      const f = intentFailure(err, LOST_HOLD);
      if (f.kind === "toast") toast.error(f.message);
      else setError(f.message);
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, send };
}
