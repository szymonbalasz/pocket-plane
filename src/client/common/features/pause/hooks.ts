// Feature API (FR-SHELL-134): `usePaused()` = this client is a player under the pause card (the DM
// never is). Non-React code with the store uses `isPausedFor(store)`; without it, `pauseGate`.
import { useSync } from "../../sync/store";
import { isPausedFor } from "./logic";

export function usePaused(): boolean {
  return useSync((s) => isPausedFor(s.store));
}
