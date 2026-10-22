// The players' pause runtime (FR-SHELL-127, -130, -136): follows `campaign.pause` in the synced
// store. Up → the gate closes and the shell's alerts go quiet (sounds but `pause`); a live
// `CampaignPaused` that starts a pause plays `pause`. Down → the gate opens (deferred opens run)
// and a live `CampaignResumed` catches up: the turn alert if it is their PC's turn, else one
// sound by priority (request > resume). A snapshot (reload, reconnect) plays nothing.
import type { AlertKey } from "@shared/campaign-management/table-state";
import { CampaignPaused, CampaignResumed } from "@shared/events/campaign-management";
import type { EventFrame } from "@shared/protocol/frames";
import type { RecordStore } from "@shared/protocol/store";
import type { TurnAlert } from "../combat-tracker/turn-alert";
import type { PauseGate } from "./gate";
import { isPausedFor, pauseOf, resumeCatchUp } from "./logic";

export interface PauseRuntimeDeps {
  gate: Pick<PauseGate, "set">;
  /** The shell's alert controller: quiet while paused (sounds but `pause`). */
  suppress(on: boolean): void;
  alert(a: TurnAlert): void;
  alertSound(key: AlertKey): void;
}

export interface PauseRuntime {
  /** Every store change; the connection applies a frame to the store before its handlers. */
  onStore(store: RecordStore): void;
  /** Live frames only (`useEventFrame`). */
  onFrame(frame: Pick<EventFrame, "cause">, store: RecordStore): void;
}

export function createPauseRuntime(deps: PauseRuntimeDeps): PauseRuntime {
  /** The pause this client is under (null: running, or the DM). */
  let startedAt: string | null = null;
  /** Its `startedAt` before the latest store change (a new pause vs an update). */
  let before: string | null = null;
  /** The last pause's start: prompts since then are caught up at resume. */
  let since: string | null = null;
  return {
    onStore(store) {
      const next = isPausedFor(store) ? (pauseOf(store)?.startedAt ?? null) : null;
      before = startedAt;
      if (next === startedAt) return;
      startedAt = next;
      if (next !== null && before === null) {
        since = next;
        deps.suppress(true);
        deps.gate.set(true);
      } else if (next === null) {
        deps.suppress(false);
        deps.gate.set(false);
      } else {
        since = next; // ended and started again between two store changes
      }
    },
    onFrame(frame, store) {
      if (frame.cause.name === CampaignPaused.type) {
        if (startedAt !== null && startedAt !== before) deps.alertSound("pause");
        return;
      }
      if (frame.cause.name !== CampaignResumed.type || startedAt !== null || before === null) {
        return;
      }
      if (store.you?.role !== "player") return;
      const c = resumeCatchUp(store, since);
      if (c.turn) deps.alert(c.turn);
      else deps.alertSound(c.sound);
    },
  };
}
