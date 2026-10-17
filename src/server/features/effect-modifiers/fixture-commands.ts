// Internal commands for fixtures (not intents; MOD §13.1 units): a fixture step can't read a
// sheet row id, so these name a character's feature row (case-insensitive) and run the real
// command with its id, like `mod.putPresetWithUses`. `uses-rage-spent` spends Rage through
// CHARX's `char.useResource`; `trg-mira-uses` links a trigger's `every.feature`.
import { CharUseResourceIntent, type CharUseResourceResult } from "@shared/character-sheet/sheet";
import { type PutTriggerResult, TriggerInput } from "@shared/effect-modifiers/trigger-intents";
import { z } from "zod";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { invalid } from "../../commands/errors";
import { charUseResource } from "../character-sheet/resources";
import { getSheet } from "../character-sheet/sheet-rows";
import { putTrigger } from "./trigger-commands";

const FeatureName = z.string().trim().min(1).max(60);

/** The character's feature row with uses named `name`; none → `invalid`. */
function featureRowId(env: CommandEnv, characterId: string, name: string): string {
  const want = name.toLowerCase();
  const row = getSheet(env.tx, characterId)?.features.find(
    (f) => f.name.trim().toLowerCase() === want && (f.usesMax ?? 0) > 0,
  );
  if (!row) throw invalid(`No feature with uses named ${name}`);
  return row.id;
}

/** `char.useResource {feature}` by the row's name (`uses-rage-spent`, `trg-mira-uses`). */
export const useFeatureByName = defineCommand({
  name: "mod.useFeatureByName",
  input: z.strictObject({
    characterId: CharUseResourceIntent.shape.characterId,
    feature: FeatureName,
    delta: CharUseResourceIntent.shape.delta.unwrap(),
  }),
  roles: ["dm"],
  execute({ characterId, feature, delta }, env): CharUseResourceResult {
    const rowId = featureRowId(env, characterId, feature);
    return charUseResource.execute({ characterId, resource: { feature: rowId }, delta }, env);
  },
});

const PutTriggerWithFeatureInput = z.strictObject({ trigger: TriggerInput, feature: FeatureName });
export type PutTriggerWithFeatureInput = z.input<typeof PutTriggerWithFeatureInput>;

/**
 * `mod.putTrigger` with `every: {feature}` = the row named `feature` (`trg-mira-uses`); the
 * rule's own `every` is replaced.
 */
export const putTriggerWithFeature = defineCommand({
  name: "mod.putTriggerWithFeature",
  input: PutTriggerWithFeatureInput,
  roles: ["dm"],
  execute({ trigger, feature }, env): PutTriggerResult {
    if (trigger.characterId === null) throw invalid("Feature triggers belong to a character");
    const every = { feature: featureRowId(env, trigger.characterId, feature) };
    return putTrigger.execute({ trigger: { ...trigger, rule: { ...trigger.rule, every } } }, env);
  },
});
