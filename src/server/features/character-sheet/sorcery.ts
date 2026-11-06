// Flexible Casting (class-resources FR-CRES-06, -07): `char.convertSlot` (a slot or a pact slot →
// sorcery points) and `char.createSlot` (points → a created slot). Characters only; DM and the
// owner, also on a locked sheet (counters, FR-CHARX-12). One `creature-sheet` write and one event
// each; the rules are `@shared/character-sheet/sorcery`'s.
import {
  CHARX_INTENTS,
  CharConvertSlotIntent,
  CharCreateSlotIntent,
  type CharSlotPointsResult,
} from "@shared/character-sheet/sheet";
import { convertSlot, createSlot, type FlexOutcome } from "@shared/character-sheet/sorcery";
import { CharacterSlotConverted, CharacterSlotCreated } from "@shared/events/character-sheet";
import { defineCommand } from "../../commands/commands";
import { invalid } from "../../commands/errors";
import { counterCharacter } from "./access";
import { mergeChanges, sheetOrNew, writeSheet } from "./sheet-rows";

function settled(o: FlexOutcome): Extract<FlexOutcome, { ok: true }> {
  if (!o.ok) throw invalid(o.message);
  return o;
}

export const charConvertSlot = defineCommand({
  name: CHARX_INTENTS.convertSlot,
  input: CharConvertSlotIntent,
  roles: ["dm", "player"],
  execute(input, env): CharSlotPointsResult {
    const c = counterCharacter(env, input.characterId);
    const { before: row, sheet } = sheetOrNew(env, c);
    const out = settled(convertSlot(sheet, c.statBlock, input.from));
    const change = writeSheet(env, row, { ...sheet, ...out.sheet });
    env.emit({
      type: CharacterSlotConverted.type,
      campaignId: c.campaignId,
      payload: { characterId: c.id, from: input.from, points: out.points },
      changes: mergeChanges([change]),
    });
    return { points: out.points.after };
  },
});

export const charCreateSlot = defineCommand({
  name: CHARX_INTENTS.createSlot,
  input: CharCreateSlotIntent,
  roles: ["dm", "player"],
  execute(input, env): CharSlotPointsResult {
    const c = counterCharacter(env, input.characterId);
    const { before: row, sheet } = sheetOrNew(env, c);
    const out = settled(createSlot(sheet, input.level));
    const change = writeSheet(env, row, { ...sheet, ...out.sheet });
    env.emit({
      type: CharacterSlotCreated.type,
      campaignId: c.campaignId,
      payload: { characterId: c.id, level: input.level, points: out.points },
      changes: mergeChanges([change]),
    });
    return { points: out.points.after };
  },
});
