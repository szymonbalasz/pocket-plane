// Diagonal rule (SCN §9; FR-SCN-29, -30, -33): `scn.setDiagonalRule {rule}`, DM only. One
// `map-settings` row per campaign, created on the first set (no row = `5-10-5`). One transaction:
// the row + one event-log entry → `DiagonalRuleSet` with one `map-settings` upsert, which every
// client receives (full). The rule already in effect (no row = `5-10-5`) writes nothing.
import { DiagonalRuleSet } from "@shared/events/scene-tools";
import { MAP_SETTINGS_TYPE, SCN_INTENTS, SetDiagonalRuleInput } from "@shared/scene-tools/schemas";
import { defineCommand } from "../../commands/commands";
import { mapSettings } from "../../db/schema";
import { campaignOf } from "../scenes-map/rows";
import { diagonalRuleOf, readSettings } from "./rows";

export const setDiagonalRule = defineCommand({
  name: SCN_INTENTS.setDiagonalRule,
  input: SetDiagonalRuleInput,
  execute({ rule }, { tx, actor, ctx, emit }): void {
    const cid = campaignOf(actor);
    if (diagonalRuleOf(tx, cid) === rule) return;
    const before = readSettings(tx, cid);
    const values = { diagonalRule: rule, updatedAt: ctx.clock.iso() };
    tx.insert(mapSettings)
      .values({ campaignId: cid, ...values })
      .onConflictDoUpdate({ target: mapSettings.campaignId, set: values })
      .run();
    emit({
      type: DiagonalRuleSet.type,
      campaignId: cid,
      payload: { rule },
      changes: [{ type: MAP_SETTINGS_TYPE, id: cid, before, after: readSettings(tx, cid) }],
    });
  },
});
