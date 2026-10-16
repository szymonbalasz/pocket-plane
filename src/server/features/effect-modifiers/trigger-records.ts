// Record type `rule-trigger` (FR-MOD-47, ADR-0043, ADR-0045): a lazy type (`lazy: "all"`: never
// in a snapshot, `sync.load` only), registered in MOD's `index.ts`. Campaign scope. DM full; the owner
// player gets their characters' rows redacted (campaign preset ids → `{name}`); definition
// triggers and everyone else: hidden. `trigger_use` is server-only: no record type at all.
//
// `redact` reads record + viewer only, so the in-registry record carries server-only
// `presetRefs` (built from the DB with the row, like fog's `seenBy`): per preset ref of the rule,
// own preset (kept) or the campaign preset's name. `dmRedact` strips it from the DM's wire.
import {
  type PlayerRuleTriggerRecord,
  RULE_TRIGGER_TYPE,
  RuleTriggerRecord,
  redactRuleForPlayer,
  rulePresetRefs,
  type TriggerPresetRefs,
} from "@shared/effect-modifiers/trigger-records";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Tx } from "../../db/client";
import { effectPreset, ruleTrigger } from "../../db/schema";
import { defineRecordType, type Viewer, type Visibility } from "../../ws/records";

type Read = Pick<Tx, "select">;

/** The record as the registry holds it: the wire row + server-only preset facts. */
export type RuleTriggerRow = RuleTriggerRecord & { presetRefs: TriggerPresetRefs };

/** A stored row → the registry's record (one indexed read of the presets its rule names). */
export function toRuleTriggerRecord(
  read: Read,
  row: typeof ruleTrigger.$inferSelect,
): RuleTriggerRow {
  const refs = rulePresetRefs(row.rule);
  const presets = refs.length
    ? read
        .select({
          id: effectPreset.id,
          name: effectPreset.name,
          characterId: effectPreset.characterId,
        })
        .from(effectPreset)
        .where(and(eq(effectPreset.campaignId, row.campaignId), inArray(effectPreset.id, refs)))
        .all()
    : [];
  const presetRefs: Record<string, TriggerPresetRefs[string]> = {};
  for (const p of presets) {
    presetRefs[p.id] =
      row.characterId !== null && p.characterId === row.characterId
        ? { own: true }
        : { name: p.name };
  }
  return { ...row, presetRefs };
}

const wire = ({ presetRefs: _refs, ...r }: RuleTriggerRow): RuleTriggerRecord => r;

/** FR-MOD-47: owner player of a character trigger → redacted; definition triggers DM only. */
export const ruleTriggerVisibility = (r: RuleTriggerRow, v: Viewer): Visibility =>
  r.definitionId === null && r.ownerPlayerId !== null && r.ownerPlayerId === v.playerId
    ? "redacted"
    : "hidden";

/** FR-MOD-47 (R9, #209): the owner's copy, campaign preset ids in the rule → `{name}`. */
export const redactRuleTrigger = (r: RuleTriggerRow): PlayerRuleTriggerRecord => ({
  ...wire(r),
  rule: redactRuleForPlayer(r.rule, r.presetRefs),
});

/** Every trigger of the viewer's campaign, `seq` order (FR-MOD-52), as registry records. */
export function campaignTriggers(read: Read, campaignId: string): RuleTriggerRow[] {
  return read
    .select()
    .from(ruleTrigger)
    .where(eq(ruleTrigger.campaignId, campaignId))
    .orderBy(asc(ruleTrigger.seq))
    .all()
    .map((row) => toRuleTriggerRecord(read, row));
}

/** The `rule-trigger` registration (`lazy: "all"`, ADR-0045), in MOD's `index.ts`. */
export const ruleTriggerRecordType = defineRecordType<RuleTriggerRow>({
  type: RULE_TRIGGER_TYPE,
  scope: "campaign",
  lazy: "all",
  schema: RuleTriggerRecord as never,
  idOf: (r) => r.id,
  campaignOf: (r) => r.campaignId,
  visibility: ruleTriggerVisibility,
  redact: redactRuleTrigger,
  dmRedact: wire,
  snapshot: ({ db }, v) => campaignTriggers(db, v.campaignId),
});
