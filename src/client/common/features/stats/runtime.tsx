// `stats.board`'s companion (always mounted while the kind is available), both clients, live
// event frames only (never a snapshot, reload or resync):
// - FR-STATS-22 / FR-NOTE-49: the overkill callout toast `stats-overkill-toast`, 4 s, an info
//   toast in the shared stack (no notification row; one at a time; once per line);
// - FR-SHELL-94: a new `stats-awards` notification opens everyone's Stats on that session.
import { useRef } from "react";
import { toast } from "sonner";
import { useEventFrame, useSync } from "../../sync/store";
import { awardsOpenOf, OVERKILL_TOAST_ID, OVERKILL_TOAST_MS, overkillToast } from "./logic";
import { useOpenStatsAwards } from "./open";

/** Line ids already toasted: a later upsert of the same line (an edit) never toasts again. */
const TOASTED_MAX = 200;

export function StatsRuntime() {
  const role = useSync((s) => (s.store.you?.role === "dm" ? "dm" : "player"));
  const openAwards = useOpenStatsAwards();
  const toasted = useRef(new Set<string>());
  useEventFrame((frame) => {
    const t = overkillToast(frame, role);
    if (t && !toasted.current.has(t.entryId)) {
      toasted.current.add(t.entryId);
      if (toasted.current.size > TOASTED_MAX) {
        const [oldest] = toasted.current;
        if (oldest) toasted.current.delete(oldest);
      }
      toast(<span data-testid="stats-overkill-toast">{t.text}</span>, {
        id: OVERKILL_TOAST_ID,
        duration: OVERKILL_TOAST_MS,
      });
    }
    const awards = awardsOpenOf(frame);
    if (awards) openAwards(awards.fromN);
  });
  return null;
}
