// `char.useResource` (FR-CHARX-17): slot / hit die / feature-use counters as deltas, so DM and
// owner clicks both apply. Characters only; the owner also on a locked sheet.
import { counterOf, nextUsed, withUsed } from "@shared/character-sheet/counters";
import {
  CHARX_INTENTS,
  CharUseResourceIntent,
  type CharUseResourceResult,
} from "@shared/character-sheet/sheet";
import { CharacterResourceUsed } from "@shared/events/character-sheet";
import { defineCommand } from "../../commands/commands";
import { notFound } from "../../commands/errors";
import { counterCharacter } from "./access";
import { mergeChanges, sheetOrNew, writeSheet } from "./sheet-rows";

export const charUseResource = defineCommand({
  name: CHARX_INTENTS.useResource,
  input: CharUseResourceIntent,
  roles: ["dm", "player"],
  execute(input, env): CharUseResourceResult {
    const c = counterCharacter(env, input.characterId);
    const { before: row, sheet } = sheetOrNew(env, c);
    const counter = counterOf(sheet, c.statBlock, input.resource);
    if (!counter) throw notFound("Feature was deleted");
    const before = counter.used;
    const after = nextUsed(before, counter.max, input);
    // Unchanged (clamp, reset at 0) → success, no event.
    if (after === before) return { before, after };
    const change = writeSheet(env, row, { ...sheet, ...withUsed(sheet, input.resource, after) });
    env.emit({
      type: CharacterResourceUsed.type,
      campaignId: c.campaignId,
      payload: { characterId: c.id, resource: input.resource, before, after },
      changes: mergeChanges([change]),
    });
    return { before, after };
  },
});
