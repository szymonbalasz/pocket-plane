// Player turn alert runtime (FR-CBT-41): companion of the player's `cbt.initiative` (mounted while
// an encounter is started). Each applied live event frame goes through `turnAlertFor`; a match
// calls the shell's `alert()` (flash + Toast "Your turn — Mira" + ping, FR-SHELL-22).
import type { EventFrame } from "@shared/protocol/frames";
import type { RecordStore } from "@shared/protocol/store";
import { useEffect } from "react";
import { useSync } from "../../sync/store";
import { useShellAlert } from "../play-shell/ShellContext";
import { turnAlertFor } from "./turn-alert";

type EventSource = { onEvent?: (fn: (f: EventFrame, store: RecordStore) => void) => () => void };

export function TurnAlertRuntime() {
  const alert = useShellAlert();
  const connection = useSync((s) => s.connection);
  useEffect(() => {
    // Bridge until the sync client's event-frame hook (`onEvent` / `useEventFrame`, a shared
    // change in `src/client/common/sync/`) lands; without it no alert fires.
    const onEvent = (connection as unknown as EventSource).onEvent;
    if (!onEvent) return;
    return onEvent.call(connection, (frame, store) => {
      const a = turnAlertFor(frame, store);
      if (a) alert(a);
    });
  }, [connection, alert]);
  return null;
}
