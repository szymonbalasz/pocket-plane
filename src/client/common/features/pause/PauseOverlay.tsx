// The players' pause screen (FR-SHELL-125–128, -135, -136): the overlay entry's Component. While
// `campaign.pause` is set it draws the opaque full-viewport card; the entry's `blocksInput` makes
// the shell block everything behind it (WF1). It also hosts the pause runtime (suppression and the
// resume catch-up), so it stays mounted while running and draws nothing then.
import { useContext, useEffect, useState } from "react";
import { SyncContext, useEventFrame, useSync } from "../../sync/store";
import { useAlertController, useAlertState } from "../play-shell/ShellContext";
import { pauseGate } from "./gate";
import { isPausedFor, pauseOf } from "./logic";
import { PauseCard } from "./PauseCard";
import { createPauseRuntime } from "./runtime";

function usePauseRuntime(): void {
  const sync = useContext(SyncContext);
  const alerts = useAlertController();
  const [rt] = useState(() =>
    createPauseRuntime({
      gate: pauseGate,
      suppress: (on) => alerts.setSuppressed(on),
      alert: (a) => alerts.alert(a),
      alertSound: (key) => alerts.alertSound(key),
    }),
  );
  useEffect(() => {
    if (!sync) return;
    rt.onStore(sync.getState().store);
    const off = sync.subscribe((s) => rt.onStore(s.store));
    return () => {
      off();
      alerts.setSuppressed(false);
      pauseGate.set(false);
    };
  }, [rt, sync, alerts]);
  useEventFrame((frame, store) => rt.onFrame(frame, store));
}

export function PauseOverlay() {
  usePauseRuntime();
  const pause = useSync((s) => (isPausedFor(s.store) ? pauseOf(s.store) : null));
  const live = useSync((s) => s.state === "live");
  const muted = useAlertState((s) => s.settings.muted);
  const alerts = useAlertController();
  if (!pause) return null;
  return (
    <div
      data-testid="ui-pause"
      data-state={live ? "paused" : "reconnecting"}
      role="dialog"
      aria-modal="true"
      aria-label="Paused"
      className="pointer-events-auto absolute inset-0 flex items-center justify-center overflow-y-auto bg-background p-6"
    >
      <PauseCard
        pause={pause}
        reconnecting={!live}
        mute={{ muted, onToggle: () => alerts.setSettings({ muted: !muted }) }}
      />
    </div>
  );
}
