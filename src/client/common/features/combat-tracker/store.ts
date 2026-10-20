// Combat reads from the synced store and the intent sender both clients use (FR-CBT-29). No
// feature logic: the server ranks, validates and decides; clients render `position` /
// `playerPosition` as written.
import {
  COMBATANT_TYPE,
  type CombatantView,
  ENCOUNTER_TYPE,
  type EncounterView,
} from "@shared/combat-tracker/schemas";
import type { RecordStore } from "@shared/protocol/store";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { IntentRejected } from "../../sync/connection";
import { useRecords, useSync } from "../../sync/store";

export const LOST_MESSAGE = "Connection lost — check the game log / HP before trying again";

/** The started encounter in a store (player `cbt.initiative` availability). */
export function startedIn(store: RecordStore): EncounterView | null {
  const all = Object.values(store.records[ENCOUNTER_TYPE] ?? {}) as EncounterView[];
  return all.find((e) => e.status === "started") ?? null;
}

export function useStartedEncounter(): EncounterView | null {
  const encounters = useRecords<EncounterView>(ENCOUNTER_TYPE);
  return useMemo(() => encounters.find((e) => e.status === "started") ?? null, [encounters]);
}

/**
 * Combatants of an encounter in rank order: DM by `position`, players by `playerPosition`.
 * Sprint 6 (FR-CBT-112): a dismissed companion (`active` false in the DM's store; players get a
 * delete) has left the fight.
 */
export function useCombatants(encounterId: string | null | undefined): CombatantView[] {
  const all = useRecords<CombatantView>(COMBATANT_TYPE);
  return useMemo(
    () =>
      all
        .filter((c) => c.encounterId === encounterId && c.active !== false)
        .sort(
          (a, b) =>
            (a.position ?? a.playerPosition ?? 0) - (b.position ?? b.playerPosition ?? 0) ||
            (a.seq ?? 0) - (b.seq ?? 0),
        ),
    [all, encounterId],
  );
}

export function useLive(): boolean {
  return useSync((s) => s.state === "live");
}

/** Reject → Toast with the server's message; a drop in flight → the "connection lost" Toast. */
export function toastIntentError(err: unknown): void {
  if (err instanceof IntentRejected) {
    if (err.code === "disconnected" || err.code === "offline") toast.error(LOST_MESSAGE);
    else toast.error(err.message);
    return;
  }
  console.error(err);
  toast.error("Something went wrong");
}

/**
 * One intent in flight per control (FR-CBT-29): `send` is a no-op while `busy`; errors toast.
 * Resolves with the ack result (null for intents without one), or undefined on failure.
 */
export function useCbtIntent() {
  const connection = useSync((s) => s.connection);
  const live = useLive();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const send = useCallback(
    async <R = unknown>(name: string, payload: unknown): Promise<R | undefined> => {
      if (inFlight.current) return undefined;
      inFlight.current = true;
      setBusy(true);
      try {
        // `?? null`: an ack without a result (cbt.end, note.dismiss) is still a success.
        return ((await connection.sendIntent(name, payload)) ?? null) as R;
      } catch (err) {
        toastIntentError(err);
        return undefined;
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [connection],
  );
  return { send, busy, live, disabled: busy || !live };
}
