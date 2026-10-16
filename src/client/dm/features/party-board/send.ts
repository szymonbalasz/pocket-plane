// One handout intent in flight per form (FR-PARTY-15, -16): a reject → inline message, an intent
// lost to a disconnect → the form's toast.
import { intentFailure } from "@ui/features/party-board/logic";
import { useSync } from "@ui/sync/store";
import { useState } from "react";
import { toast } from "sonner";

export function useLive(): boolean {
  return useSync((s) => s.state === "live");
}

export function useIntent(lost: string) {
  const connection = useSync((s) => s.connection);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Resolves the intent's result, or `undefined` after a failure (already reported). */
  const send = async (name: string, payload: unknown): Promise<{ result: unknown } | undefined> => {
    if (busy) return undefined;
    setBusy(true);
    setError(null);
    try {
      return { result: await connection.sendIntent(name, payload) };
    } catch (err) {
      const f = intentFailure(err, lost);
      if (f.kind === "toast") toast.error(f.message);
      else setError(f.message);
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, send };
}
