// `char.create`, `char.approve`, `char.setLock` (FR-CHARX-08–12). One transaction each:
// entity / sheet rows + event (logged, not undoable, FR-CHARX-19).
import {
  CHARX_INTENTS,
  CharApproveIntent,
  CharCreateIntent,
  type CharCreateResult,
  CharSetLockIntent,
} from "@shared/character-sheet/sheet";
import type { CharacterStatBlock } from "@shared/entities/schemas";
import {
  CharacterApproved,
  CharacterCreated,
  CharacterLockSet,
} from "@shared/events/character-sheet";
import { and, eq } from "drizzle-orm";
import { defineCommand } from "../../commands/commands";
import { conflict, invalid } from "../../commands/errors";
import { creatureSheet } from "../../db/schema";
import { createIn } from "../entities/commands";
import { notifyApproved, notifyDraft } from "./draft-notes";
import { getCharacter } from "./hp";
import { mergeChanges, newSheet, sheetOrNew, writeSheet } from "./sheet-rows";

export const OPEN_DRAFT_MESSAGE = "Finish your draft first: the DM approves it";

/** FR-CHARX-08: medium, AC 10, HP max 1, init +0, no attacks, level 1, class "", scores 10. */
export const STARTING_BLOCK: CharacterStatBlock = {
  size: "medium",
  ac: 10,
  hpMax: 1,
  initBonus: 0,
  attacks: [],
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  level: 1,
  className: "",
};

export const charCreate = defineCommand({
  name: CHARX_INTENTS.create,
  input: CharCreateIntent,
  roles: ["dm", "player"],
  authorize(input, env) {
    // CHARX §9: a player's owner is their link (FR-CHARX-09) and always a draft.
    if (env.actor.role === "player") {
      const issues = (["ownerPlayerId", "draft"] as const)
        .filter((k) => input[k] !== undefined)
        .map((k) => ({ path: [k], message: "Not allowed for players" }));
      if (issues.length) throw invalid("Players create their own draft", issues);
    } else if (input.ownerPlayerId === undefined) {
      throw invalid("Pick an owner", [{ path: ["ownerPlayerId"], message: "Required" }]);
    }
  },
  execute(input, env): CharCreateResult {
    const isPlayer = env.actor.role === "player";
    const ownerPlayerId = (isPlayer ? env.actor.playerId : input.ownerPlayerId) as string;
    const draft = isPlayer ? true : (input.draft ?? false);
    if (isPlayer) {
      const open = env.tx
        .select({ id: creatureSheet.entityId })
        .from(creatureSheet)
        .where(
          and(
            eq(creatureSheet.campaignId, env.actor.campaignId ?? ""),
            eq(creatureSheet.ownerPlayerId, ownerPlayerId),
            eq(creatureSheet.status, "draft"),
          ),
        )
        .get();
      if (open) throw conflict(OPEN_DRAFT_MESSAGE);
    }
    const { record, change } = createIn(env, {
      kind: "character",
      name: input.name,
      ownerPlayerId,
      statBlock: STARTING_BLOCK,
    });
    const status = draft ? "draft" : "ready";
    const sheetChange = writeSheet(env, null, newSheet(env, record, { status }));
    env.emit({
      type: CharacterCreated.type,
      campaignId: record.campaignId,
      payload: { characterId: record.id, ownerPlayerId, status },
      changes: mergeChanges([change, sheetChange]),
    });
    if (isPlayer) notifyDraft(env, record.id, record.name, ownerPlayerId);
    return { characterId: record.id };
  },
});

/**
 * FR-CHARX-10: draft → ready; already ready (or no row) → success, no event. G8: a draft's
 * pending card is resolved and the owner notified (FR-CHARX-45/46).
 */
export const charApprove = defineCommand({
  name: CHARX_INTENTS.approve,
  input: CharApproveIntent,
  execute(input, env): Record<string, never> {
    const c = getCharacter(env, input.characterId);
    const { before, sheet } = sheetOrNew(env, c);
    if (sheet.status === "ready") return {};
    const change = writeSheet(env, before, { ...sheet, status: "ready" });
    env.emit({
      type: CharacterApproved.type,
      campaignId: c.campaignId,
      payload: { characterId: c.id },
      changes: mergeChanges([change]),
    });
    notifyApproved(env, c.id, c.name, c.ownerPlayerId);
    return {};
  },
});

/** FR-CHARX-12: lock / unlock; same value → no event. The DM is never locked out. */
export const charSetLock = defineCommand({
  name: CHARX_INTENTS.setLock,
  input: CharSetLockIntent,
  execute(input, env): Record<string, never> {
    const c = getCharacter(env, input.characterId);
    const { before, sheet } = sheetOrNew(env, c);
    if (sheet.locked === input.locked) return {};
    const change = writeSheet(env, before, { ...sheet, locked: input.locked });
    env.emit({
      type: CharacterLockSet.type,
      campaignId: c.campaignId,
      payload: { characterId: c.id, locked: input.locked },
      changes: mergeChanges([change]),
    });
    return {};
  },
});
