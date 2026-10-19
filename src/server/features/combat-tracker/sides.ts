// Ally side (sprint 5, #252, FR-CBT-98–100): `cbt.setSide` sets any combatant of the started
// encounter (PCs too, both ways; removed ones allowed) as ally or enemy. A non-secret change also
// sets `publicSide`, the side players see (`publicSideOf`); a secret one leaves it. Not undoable
// (Undo stays HP-only): the DM sets it back.
import { publicSideOf, sideOf } from "@shared/combat-tracker/rules";
import { CBT_INTENTS, LOG_KIND_SIDE, SetSideInput } from "@shared/combat-tracker/schemas";
import { CombatantSideChanged } from "@shared/events/combat-tracker";
import { eq } from "drizzle-orm";
import { defineCommand } from "../../commands/commands";
import { conflict, notFound } from "../../commands/errors";
import { combatant } from "../../db/schema";
import { gameLog } from "../dice-roll-log";
import { combatantVisibility } from "./records";
import { campaignOf, combatantChange, getCombatant, readCombatant, startedEncounter } from "./rows";

export const setSideCommand = defineCommand({
  name: CBT_INTENTS.setSide,
  input: SetSideInput,
  roles: ["dm"],
  execute({ combatantId, side, secret = false }, env): void {
    const cid = campaignOf(env.actor);
    const enc = startedEncounter(env.tx, cid);
    if (!enc) throw conflict("No encounter running");
    const before = getCombatant(env.tx, cid, combatantId);
    if (before.encounterId !== enc.id) throw notFound("Combatant not found");
    // No-op: same side, and secret or already shown to players (an open set reveals it).
    if (sideOf(before) === side && (secret || publicSideOf(before) === side)) return;
    env.tx
      .update(combatant)
      .set(secret ? { side } : { side, publicSide: side })
      .where(eq(combatant.id, before.id))
      .run();
    const after = readCombatant(env.tx, before.id);
    // FR-CBT-99: players read the line iff the combatant is visible to them and their side changed.
    const shown =
      combatantVisibility(after) !== "hidden" && publicSideOf(after) !== publicSideOf(before);
    const entry = gameLog.append(env, {
      kind: LOG_KIND_SIDE,
      category: "other",
      actorName: "DM",
      payload: { targetName: after.name, side },
      dmPayload: { secret },
      rollIds: [],
      encounterId: enc.id,
      public: shown,
    });
    env.emit({
      type: CombatantSideChanged.type,
      campaignId: cid,
      payload: { encounterId: enc.id, combatantId: before.id, side, secret },
      changes: [combatantChange(before, after), entry],
      // A secret change leaves players' view as it was: no frame at all for them, not an empty one.
      quietWhenUnchanged: true,
    });
  },
});
