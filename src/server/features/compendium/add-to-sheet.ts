// `cmp.addToSheet` (FR-CMP-28, -29; intent, DM + player): one transaction: entry visible to the
// caller (FR-CMP-14, else `not_found`) → `char.putRow`'s authorisation (DM any campaign
// character; the owner unless locked) → CHARX internal row insert → if FR-CMP-29 resolves a
// trigger preset, MOD's `addTriggerFromPreset`, unless the character already has that trigger
// (#241: skipped, `triggerSkipped` in the ack). Any failure (MOD validation included) → nothing
// written. Events: `CharacterSheetEdited` (+ `RuleTriggerSaved` with the trigger row).
import {
  AddToSheetIntent,
  type AddToSheetResult,
  CMP_INTENTS,
  clip,
  ROW_TEXT_MAX,
} from "@shared/compendium/homebrew";
import { type ResolvedPreset, resolvePreset } from "@shared/compendium/presets";
import type { BodyOf, FacetsOf } from "@shared/compendium/schemas";
import { getTriggerPreset } from "@shared/effect-modifiers/trigger-presets";
import { RuleTriggerSaved } from "@shared/events/effect-modifiers";
import { suggestPreset } from "@shared/spell-fx/presets";
import { and, eq, isNull } from "drizzle-orm";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { invalid, notFound } from "../../commands/errors";
import { ruleTrigger } from "../../db/schema";
import { editableCreature } from "../character-sheet/access";
import { insertSheetRows, type NewSheetRows } from "../character-sheet/row-insert";
import { addTriggerFromPreset } from "../effect-modifiers";
import { sourceLabelOf } from "./derive";
import { type EntryRow, getEntry, inheritedPreset } from "./entries";
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
            // FR-VFX-04 (spell-fx §14): a spell the catalogue knows gets its map effect.
            ...suggestedFx(name),
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

/** FR-VFX-04: `{fx}` with the suggested preset's defaults, or nothing. */
function suggestedFx(name: string) {
  const p = suggestPreset(name);
  return p ? { fx: { preset: p.key, params: p.params.parse({}) } } : {};
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * #241: the character already has the trigger `preset` would add. A built-in key: a trigger
 * named like the preset (case-insensitive) or with its exact rule (rows don't keep the key they
 * started from); an inline preset: a trigger with the entry's name.
 */
export function hasTriggerFor(
  env: Pick<CommandEnv, "tx">,
  characterId: string,
  preset: ResolvedPreset,
): boolean {
  const rows = env.tx
    .select({ name: ruleTrigger.name, rule: ruleTrigger.rule })
    .from(ruleTrigger)
    .where(and(eq(ruleTrigger.characterId, characterId), isNull(ruleTrigger.definitionId)))
    .all();
  if (!("presetKey" in preset.from)) {
    const { name } = preset.from;
    return rows.some((r) => sameName(r.name, name));
  }
  const p = getTriggerPreset(preset.from.presetKey);
  if (!p) return false;
  return rows.some((r) => sameName(r.name, p.name) || Bun.deepEquals(r.rule, p.rule));
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
    const preset = resolvePreset(e) ?? inheritedPreset(env.tx, e);
    if (preset && hasTriggerFor(env, characterId, preset)) {
      result.triggerSkipped = true;
    } else if (preset) {
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
