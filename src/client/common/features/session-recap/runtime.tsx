// `recap.session`'s companion (always mounted while the kind is available), both clients, live
// event frames only (never a snapshot, reload or resync: a share made while offline is in history,
// FR-RECAP-21 / §11): a new `session-recap` notification opens the Recap on that session, once,
// as a feature open (placed only if the user never moved or resized it, fronted either way; seams
// S4, S14). The DM's own client only toasts. Paused players: the open waits for resume
// (FR-SHELL-127, `pauseGate`). It also publishes the page's Recap opener (Stats' Recap button,
// FR-STATS-79).
import type { EventFrame } from "@shared/protocol/frames";
import { useEffect } from "react";
import { useEventFrame, useSync } from "../../sync/store";
import { type PauseGate, pauseGate } from "../pause/gate";
import { firstOpen } from "../stats/runtime";
import { shareOpenOf } from "./logic";
import { recapOpener, useOpenRecap } from "./open";

export interface RecapFrameDeps {
  role: "dm" | "player";
  open(fromN: number): void;
  gate?: Pick<PauseGate, "deferUntilResume">;
  seen?: Set<string>;
}

/** One live frame: a share opens the Recap on players' clients (newest share wins at resume). */
export function onRecapFrame(frame: EventFrame, d: RecapFrameDeps): void {
  const share = shareOpenOf(frame);
  if (!share || d.role === "dm" || !firstOpen(share.notificationId, d.seen)) return;
  (d.gate ?? pauseGate).deferUntilResume("recap.share", () => d.open(share.fromN));
}

export function RecapRuntime() {
  const role = useSync((s) => (s.store.you?.role === "dm" ? "dm" : "player"));
  const open = useOpenRecap();
  useEventFrame((frame) => onRecapFrame(frame, { role, open: (n) => open(n, "feature") }));
  // FR-STATS-79: Stats' Recap button opens through this client's shell.
  useEffect(() => {
    recapOpener.setState({ open });
    return () => recapOpener.setState({ open: null });
  }, [open]);
  return null;
}
