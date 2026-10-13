// Sheet roll route (FR-CBT-30, #135): while the character is an active, non-removed combatant of
// the started encounter in this client's store, the sheet's Initiative sends
// `cbt.rollInitiative` and Attack sends `cbt.attack` (no `public`). Checks and saves are never
// claimed: they stay `char.roll` (FR-CBT-45). A PC hidden from its owner isn't in the player's
// store, so the sheet falls back to `char.roll` (OQ-CBT-28).
import { critExpression } from "@shared/combat-tracker/rules";
import { COMBATANT_TYPE, type CombatantView } from "@shared/combat-tracker/schemas";
import type { RecordStore } from "@shared/protocol/store";
import type { RollRoute } from "../character-sheet/routing";
import { startedIn } from "./store";

function combatantOf(store: RecordStore, characterId: string): CombatantView | null {
  const enc = startedIn(store);
  if (!enc) return null;
  const all = Object.values(store.records[COMBATANT_TYPE] ?? {}) as CombatantView[];
  return (
    all.find(
      (c) =>
        c.encounterId === enc.id &&
        c.kind === "pc" &&
        c.entityId === characterId &&
        c.active !== false &&
        !c.removed,
    ) ?? null
  );
}

function damageOf(store: RecordStore, characterId: string): string | null {
  const e = store.records.entity?.[characterId] as
    | { statBlock?: { attacks?: { damage: string }[] } }
    | undefined;
  return e?.statBlock?.attacks?.[0]?.damage ?? null;
}

export const combatRollRoute: RollRoute = {
  name: "combat-tracker",
  claim(store, characterId, kind) {
    if (kind !== "initiative" && kind !== "attack") return null;
    const c = combatantOf(store, characterId);
    if (!c) return null;
    if (kind === "initiative") {
      return {
        badge: "In combat",
        send: (sendIntent, input) =>
          sendIntent("cbt.rollInitiative", {
            combatantIds: [c.id],
            mode: input.mode,
            ...(input.manual?.[0] ? { manual: input.manual[0] } : {}),
            ...(input.public !== undefined ? { public: input.public } : {}),
          }),
      };
    }
    const damage = damageOf(store, characterId);
    return {
      badge: "In combat",
      ...(damage ? { critExpressions: [critExpression(damage)] } : {}),
      send: (sendIntent, input) =>
        sendIntent("cbt.attack", {
          attackerId: c.id,
          mode: input.mode,
          ...(input.manual ? { manual: input.manual } : {}),
        }),
    };
  },
};
