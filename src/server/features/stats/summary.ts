// The fight summary at End (FR-STATS-33, FR-CBT-153): combat's `ended` rule hook (registered last
// in `combat-tracker/rule-hooks.ts`). Inside `cbt.end`'s transaction it runs one indexed existence
// query (no Highlights build) and notifies `stats-fight-summary`: audience `all` when the fight has
// a counted public fact, `dm` when only DM-only facts count, none when nothing counts
// (OQ-STATS-27 A). A throw rolls End back.
import {
  FIGHT_SUMMARY_TEXT,
  STATS_FIGHT_SUMMARY_KIND,
  type StatsFightSummaryPayload,
} from "@shared/stats/schemas";
import type { CombatRuleHookSet } from "../combat-tracker/rule-hooks";
import { fightFactPresence } from "../combat-tracker/stats-read";
import { notify } from "../notifications";

export const statsSummaryHooks: CombatRuleHookSet = {
  ended(env, encounter) {
    const has = fightFactPresence(env.tx, encounter.id);
    if (!has.counted) return [];
    const payload: StatsFightSummaryPayload = { encounterId: encounter.id };
    notify(env, {
      kind: STATS_FIGHT_SUMMARY_KIND,
      audience: has.public ? "all" : "dm",
      text: FIGHT_SUMMARY_TEXT,
      payload,
    });
    return [];
  },
};
