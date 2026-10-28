// Diagonal rule (SCN §9; FR-SCN-29, -30, -33): `scn.setDiagonalRule {rule}`, DM only. One
// `map-settings` row per campaign, created on the first set (no row = `5-10-5`). One transaction:
// the row + one event-log entry → `DiagonalRuleSet` with one `map-settings` upsert, which every
// client receives (full). The rule already in effect (no row = `5-10-5`) writes nothing.
// #377 ruling: a snapped sphere / cylinder's squares follow the rule, so in the same transaction
// every kept one in the campaign whose fog copies (`fogged`, `seenBy`) change is re-derived and
// listed in the event's `changes` (as a move would; clients redraw the squares from the rule).
import { DiagonalRuleSet } from "@shared/events/scene-tools";
import {
  AOE_TEMPLATE_TYPE,
  MAP_SETTINGS_TYPE,
  SCN_INTENTS,
  SetDiagonalRuleInput,
} from "@shared/scene-tools/schemas";
import { eq } from "drizzle-orm";
import { defineCommand } from "../../commands/commands";
import { aoeTemplate, mapSettings } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { campaignOf, readScene } from "../scenes-map/rows";
import { templateCopies } from "./copies";
import { campaignTemplates, diagonalRuleOf, readSettings, readTemplate } from "./rows";
import { sameCopies } from "./template-rederive";

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
    const changes: RecordChange[] = [
      { type: MAP_SETTINGS_TYPE, id: cid, before, after: readSettings(tx, cid) },
    ];
    for (const t of campaignTemplates(tx, cid)) {
      if (!t.footprint) continue;
      const c = templateCopies(tx, readScene(tx, t.sceneId), t, t.placedByPlayerId, rule);
      if (sameCopies(t, c)) continue;
      tx.update(aoeTemplate)
        .set({ fogged: c.fogged, seenBy: c.seenBy, updatedAt: values.updatedAt })
        .where(eq(aoeTemplate.id, t.id))
        .run();
      changes.push({ type: AOE_TEMPLATE_TYPE, id: t.id, before: t, after: readTemplate(tx, t.id) });
    }
    emit({ type: DiagonalRuleSet.type, campaignId: cid, payload: { rule }, changes });
  },
});
