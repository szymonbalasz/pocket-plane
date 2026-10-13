// The encounter open in the DM's Encounters window, remembered across reloads (session-sim
// glitch 5). Browser-local like the window layout (#121): one `localStorage` entry per
// campaign, never sent to the server. Missing / bad / blocked storage → the list.
import { useSync } from "@ui/sync/store";
import { useCallback, useState } from "react";

export type OpenEncounterBackend = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const openEncounterKey = (campaignId: string) => `pp.cbt.open-encounter.v1.${campaignId}.dm`;

const ID = /^[\w-]{1,64}$/;

const browser = (): OpenEncounterBackend => window.localStorage;

/** The remembered encounter ID for `campaignId`, or null. Never throws. */
export function readOpenEncounter(
  campaignId: string | null,
  backend: () => OpenEncounterBackend = browser,
): string | null {
  if (!campaignId) return null;
  try {
    const v = backend().getItem(openEncounterKey(campaignId));
    return v !== null && ID.test(v) ? v : null;
  } catch {
    return null;
  }
}

/** Remembers `id` (null = back to the list). Never throws. */
export function writeOpenEncounter(
  campaignId: string | null,
  id: string | null,
  backend: () => OpenEncounterBackend = browser,
): void {
  if (!campaignId) return;
  try {
    const key = openEncounterKey(campaignId);
    if (id === null) backend().removeItem(key);
    else backend().setItem(key, id);
  } catch {
    // Storage blocked or full: remembered for this mount only.
  }
}

/** `[selected, setSelected]` for the Encounters window, per active campaign. */
export function useOpenEncounter(): [string | null, (id: string | null) => void] {
  const campaignId = useSync((s) => s.store.you?.campaignId ?? null);
  const [state, setState] = useState(() => ({ campaignId, id: readOpenEncounter(campaignId) }));
  const id = state.campaignId === campaignId ? state.id : readOpenEncounter(campaignId);
  const set = useCallback(
    (next: string | null) => {
      writeOpenEncounter(campaignId, next);
      setState({ campaignId, id: next });
    },
    [campaignId],
  );
  return [id, set];
}
