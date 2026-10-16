// effect-modifiers reads over the synced store and the intent sender, both clients. The one
// client seam for preset transport (#190 D5 A): every preset read goes through `presetsIn` /
// `usePresets`, so moving campaign presets to on-demand loading changes this file only.
import { CREATURE_SHEET_TYPE, type CreatureSheetRecord } from "@shared/character-sheet/sheet";
import { EFFECT_PRESET_TYPE, type EffectPresetRecord } from "@shared/effect-modifiers/schemas";
import type { RecordStore } from "@shared/protocol/store";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { IntentRejected } from "../../sync/connection";
import { useRecords, useSync } from "../../sync/store";
import { useLive } from "../combat-tracker/store";

/** FR-MOD-29: a lost in-flight intent is not resent. */
export const MOD_LOST_MESSAGE = "Connection lost — check effects before trying again";

const bySeq = (a: EffectPresetRecord, b: EffectPresetRecord) => a.seq - b.seq;

/** Preset rows the viewer holds (DM: all; a player: their own), `seq` order. */
export function presetsIn(store: RecordStore): EffectPresetRecord[] {
  return (Object.values(store.records[EFFECT_PRESET_TYPE] ?? {}) as EffectPresetRecord[]).sort(
    bySeq,
  );
}

export function usePresets(): EffectPresetRecord[] {
  const rows = useRecords<EffectPresetRecord>(EFFECT_PRESET_TYPE);
  return useMemo(() => [...rows].sort(bySeq), [rows]);
}

/** A creature's `creature-sheet` row in the store (features for tier-3 uses), if held. */
export const sheetIn = (store: RecordStore, entityId: string | null) =>
  entityId === null
    ? undefined
    : (Object.values(store.records[CREATURE_SHEET_TYPE] ?? {}) as CreatureSheetRecord[]).find(
        (s) => s.entityId === entityId,
      );

/** A character's presets (toggles), `seq` order. */
export function useCharacterPresets(characterId: string): EffectPresetRecord[] {
  const all = usePresets();
  return useMemo(() => all.filter((p) => p.characterId === characterId), [all, characterId]);
}

/**
 * FR-MOD-29: one intent in flight per control; disabled unless live; a rejection toasts, a lost
 * intent toasts {@link MOD_LOST_MESSAGE}. Resolves with the result (null without one), or
 * undefined on failure.
 */
export function useModIntent() {
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
        return ((await connection.sendIntent(name, payload)) ?? null) as R;
      } catch (err) {
        if (err instanceof IntentRejected) {
          const lost = err.code === "disconnected" || err.code === "offline";
          toast.error(lost ? MOD_LOST_MESSAGE : err.message);
        } else {
          console.error(err);
          toast.error("Something went wrong");
        }
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
