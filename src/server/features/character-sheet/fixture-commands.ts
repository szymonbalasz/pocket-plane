// Internal command for fixtures (not an intent; class-resources §13): a fixture step can't read a
// sheet row id, so `char.linkSpendByName` names the feature row to give a spend link and, for a
// feature source, the row it spends from (case-insensitive), then runs `char.putRow` with the ids.
import { type FeatureRow, SPEND_AMOUNT_MAX } from "@shared/character-sheet/sheet";
import { z } from "zod";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { invalid } from "../../commands/errors";
import type { DefinitionHooks } from "../entities/definition-hooks";
import { charPutRowCommand } from "./edit";
import { getSheet } from "./sheet-rows";

const Name = z.string().trim().min(1).max(60);

function rowNamed(env: CommandEnv, creatureId: string, name: string): FeatureRow {
  const want = name.toLowerCase();
  const row = getSheet(env.tx, creatureId)?.features.find(
    (f) => f.name.trim().toLowerCase() === want,
  );
  if (!row) throw invalid(`No feature named ${name}`);
  return row;
}

export const LinkSpendByNameInput = z.strictObject({
  creatureId: z.string().min(1).max(64),
  row: Name,
  from: z.union([
    z.strictObject({ feature: Name }),
    z.strictObject({ pact: z.literal(true) }),
    z.strictObject({ slot: z.literal("any") }),
  ]),
  amount: z.union([z.int().min(1).max(SPEND_AMOUNT_MAX), z.literal("ask")]),
});
export type LinkSpendByNameInput = z.input<typeof LinkSpendByNameInput>;

export function linkSpendByName(hooks: DefinitionHooks) {
  const putRow = charPutRowCommand(hooks);
  return defineCommand({
    name: "char.linkSpendByName",
    input: LinkSpendByNameInput,
    roles: ["dm"],
    execute({ creatureId, row, from, amount }, env) {
      const target = rowNamed(env, creatureId, row);
      const link =
        "feature" in from ? { feature: rowNamed(env, creatureId, from.feature).id } : from;
      const { used: _used, ...rest } = target;
      return putRow.execute(
        { creatureId, list: "features", row: { ...rest, spend: { from: link, amount } } },
        env,
      );
    },
  });
}
