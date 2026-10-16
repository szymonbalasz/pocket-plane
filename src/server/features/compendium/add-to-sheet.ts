// `cmp.addToSheet` (FR-CMP-28, -29; intent, DM + player): one transaction: entry visible to the
// caller (FR-CMP-14, else `not_found`) → `char.putRow`'s authorisation (DM any campaign
// character; the owner unless locked) → CHARX internal row insert → if FR-CMP-29 resolves a
// trigger preset, MOD's `addTriggerFromPreset`. Any failure (MOD validation included) → nothing
// written. Events: `CharacterSheetEdited` (+ `RuleTriggerSaved` with the trigger row).
import {
  AddToSheetIntent,
  type AddToSheetResult,
  CMP_INTENTS,
  clip,
  ROW_TEXT_MAX,
} from "@shared/compendium/homebrew";
import { resolvePreset } from "@shared/compendium/presets";
import type { BodyOf, FacetsOf } from "@shared/compendium/schemas";
import { RuleTriggerSaved } from "@shared/events/effect-modifiers";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { invalid, notFound } from "../../commands/errors";
import { editableCreature } from "../character-sheet/access";
import { insertSheetRows, type NewSheetRows } from "../character-sheet/row-insert";
import { addTriggerFromPreset } from "../effect-modifiers";
import { sourceLabelOf } from "./derive";
import { type EntryRow, getEntry } from "./entries";
import { campaignOf } from "./homebrew";
import { entryVisibleTo } from "./visibility";

const ROW_NAME_MAX = 60;

/** FR-CMP-28's row per kind. */
export function sheetRowOf(env: Pick<CommandEnv, "tx">, e: EntryRow): NewSheetRows {
  const name = clip(e.name, ROW_NAME_MAX);
  switch (e.kind) {
    case "spell": {
      const f = e.facets as FacetsOf<"spell">;
      return {
        list: "spells",
        rows: [
          {
            name,
            level: f.level,
            concentration: f.concentration,
            ritual: f.ritual,
            roll: "none",
            effect: "damage",
          },
        ],
      };
    }
    case "item":
      return { list: "items", rows: [{ name, qty: 1 }] };
    case "feature":
      return {
        list: "features",
        rows: [
          {
            name,
            source: sourceLabelOf(env.tx, e.source),
            text: clip((e.body as BodyOf<"feature">).text, ROW_TEXT_MAX),
          },
        ],
      };
    default:
      throw invalid("Only spells, items and features go on a sheet", [
        { path: ["entryId"], message: "Not a spell, item or feature" },
      ]);
  }
}

export const addToSheet = defineCommand({
  name: CMP_INTENTS.addToSheet,
  input: AddToSheetIntent,
  roles: ["dm", "player"],
  execute({ entryId, characterId }, env): AddToSheetResult {
    const cid = campaignOf(env);
    const e = getEntry(env.tx, entryId);
    const role = env.actor.role === "player" ? "player" : "dm";
    if (!e || !entryVisibleTo(e, { role, campaignId: cid, playerId: env.actor.playerId })) {
      throw notFound("Entry not found");
    }
    const add = sheetRowOf(env, e);
    // `char.putRow`'s rule; Add to sheet targets characters only (no NPC sheets).
    const { creature } = editableCreature(env, characterId);
    if (creature.kind !== "character") throw notFound("Character not found");
    const { rowIds } = insertSheetRows(env, characterId, add);
    const result: AddToSheetResult = { list: add.list, rowId: rowIds[0] as string };
    const preset = resolvePreset(e);
    if (preset) {
      const { triggerId, changes } = addTriggerFromPreset(env, characterId, preset.from);
      env.emit({
        type: RuleTriggerSaved.type,
        campaignId: cid,
        payload: { triggerId },
        changes,
      });
      result.triggerId = triggerId;
    }
    return result;
  },
});
