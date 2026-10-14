// FR-CBTX-06 DM Toast "Ended: Bless (Mira, Thorn)": from a live `TurnChanged` event frame whose
// `effect` changes have `endedReason: expired` (never from a snapshot). No notification row.
import { effectName, endedText } from "@shared/combat-extras/rules";
import { EFFECT_TYPE, type EffectRecord } from "@shared/combat-extras/schemas";
import { TurnChanged } from "@shared/events/combat-tracker";
import type { EventFrame } from "@shared/protocol/frames";
import type { RecordStore } from "@shared/protocol/store";

const nameIn = (store: RecordStore, type: string, id: string | null) =>
  id ? (store.records[type]?.[id] as { name?: string } | undefined)?.name : undefined;

/** `store` = after the frame was applied. Null when the frame expired nothing. */
export function expiredToastText(
  frame: Pick<EventFrame, "cause" | "changes">,
  store: RecordStore,
): string | null {
  if (frame.cause.name !== TurnChanged.type) return null;
  const items = frame.changes
    .filter((c) => c.type === EFFECT_TYPE && c.op === "upsert")
    .map((c) => c.data as EffectRecord)
    .filter((e) => e?.endedReason === "expired")
    .map((e) => ({
      name: effectName(e),
      target:
        nameIn(store, "combatant", e.targetCombatantId) ??
        nameIn(store, "entity", e.targetCharacterId) ??
        "?",
    }));
  return items.length > 0 ? endedText(items) : null;
}
