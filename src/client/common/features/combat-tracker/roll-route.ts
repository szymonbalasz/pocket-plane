// Sheet roll route (FR-CBT-30, #135): while the character is an active, non-removed combatant of
// the started encounter in this client's store, the sheet's Initiative sends
// `cbt.rollInitiative` and Attack sends `cbt.attack` (no `public`). FR-CHARX-24 (OQ-CBT-47):
// every attack row's Attack and a spell's Attack (only a spell with damage) send `cbt.attack`
// with the row's `ref`. Checks, saves, skills, Damage and spell Damage are never claimed: they
// stay `char.roll` (FR-CBT-45). A PC hidden from its owner isn't in the player's store, so the
// sheet falls back to `char.roll` (OQ-CBT-28).
import { type RollSheet, resolveSheetAttack } from "@shared/character-sheet/logic";
import { CREATURE_SHEET_TYPE } from "@shared/character-sheet/sheet";
import { critExpression } from "@shared/combat-tracker/rules";
import { COMBATANT_TYPE, type CombatantView } from "@shared/combat-tracker/schemas";
import type { RecordStore } from "@shared/protocol/store";
import type { RollRoute, RollRouteRef } from "../character-sheet/routing";
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

/** FR-CBT-46: roll-initiative controls only while round 0 or the combatant has none. */
export function initiativeLocked(store: RecordStore, c: CombatantView): boolean {
  return (startedIn(store)?.round ?? 0) >= 1 && c.initiative != null;
}

/**
 * The row's damage expression from this client's store (full entity + `creature-sheet`, DM and
 * owner), or null: unknown row, no damage, or not in the store.
 */
function damageOf(store: RecordStore, characterId: string, ref?: RollRouteRef): string | null {
  const e = store.records.entity?.[characterId] as
    | { statBlock?: Parameters<typeof resolveSheetAttack>[0] }
    | undefined;
  if (!e?.statBlock?.attacks) return null;
  const sheet = (store.records[CREATURE_SHEET_TYPE]?.[characterId] ?? null) as RollSheet;
  const r = resolveSheetAttack(e.statBlock, sheet, ref ?? {});
  return r.ok ? r.attack.damage : null;
}

export const combatRollRoute: RollRoute = {
  name: "combat-tracker",
  claim(store, characterId, kind, ref) {
    if (kind !== "initiative" && kind !== "attack" && kind !== "spellAttack") return null;
    // A spell attack needs its row; one without damage rolls plainly via `char.roll`.
    if (kind === "spellAttack" && ref?.spellId === undefined) return null;
    if (kind === "attack" && ref?.spellId !== undefined) return null;
    const c = combatantOf(store, characterId);
    if (!c) return null;
    if (kind === "initiative") {
      return {
        badge: "In combat",
        // FR-CHAR-24, FR-CBT-46 (#172): from round 1 nobody re-rolls; a PC without initiative
        // (restored, later a mid-fight joiner) keeps the button and rolls once.
        hidden: initiativeLocked(store, c),
        send: (sendIntent, input) =>
          sendIntent("cbt.rollInitiative", {
            combatantIds: [c.id],
            mode: input.mode,
            ...(input.manual?.[0] ? { manual: input.manual[0] } : {}),
            ...(input.public !== undefined ? { public: input.public } : {}),
          }),
      };
    }
    const damage = damageOf(store, characterId, ref);
    if (kind === "spellAttack" && !damage) return null;
    return {
      badge: "In combat",
      ...(damage ? { critExpressions: [critExpression(damage)] } : {}),
      send: (sendIntent, input) =>
        sendIntent("cbt.attack", {
          attackerId: c.id,
          mode: input.mode,
          ...(input.manual ? { manual: input.manual } : {}),
          ...(ref?.attackId !== undefined ? { attackId: ref.attackId } : {}),
          ...(ref?.spellId !== undefined ? { spellId: ref.spellId } : {}),
        }),
    };
  },
};
