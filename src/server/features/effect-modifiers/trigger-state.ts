// Record type `trigger-state` (FR-MOD-53, -55; ADR-0049 D1; protocol §34), registered in MOD's
// `index.ts`. Campaign scope, in the snapshot (not lazy, not windowed: rows exist only while an
// encounter is started). DM full; the owning player (`ownerPlayerId`, character triggers only)
// their own rows full; monster (definition) rows and every other player: nothing. An owner
// change lists the row, so the old owner gets its delete (transition matrix, FR-SYNC-19).
// MOD writes the rows in the causing transaction (S4-3); no server rule reads them.
import {
  TRIGGER_STATE_TYPE,
  TriggerStateRecord,
  type TriggerStateRecord as TriggerStateRow,
} from "@shared/effect-modifiers/trigger-state";
import { asc, eq } from "drizzle-orm";
import type { Tx } from "../../db/client";
import { triggerState } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { defineRecordType, type Viewer, type Visibility } from "../../ws/records";

type Read = Pick<Tx, "select">;

/** FR-MOD-55 (OQ-MOD-41 pick A, #245): own character rows only; never a monster's. */
export const triggerStateVisibility = (r: TriggerStateRow, v: Viewer): Visibility =>
  r.characterId !== null && r.ownerPlayerId !== null && r.ownerPlayerId === v.playerId
    ? "full"
    : "hidden";

/** Every row of a campaign, in a stable order (encounter, combatant, trigger). */
export function campaignTriggerStates(read: Read, campaignId: string): TriggerStateRow[] {
  return read
    .select()
    .from(triggerState)
    .where(eq(triggerState.campaignId, campaignId))
    .orderBy(
      asc(triggerState.encounterId),
      asc(triggerState.combatantId),
      asc(triggerState.triggerId),
    )
    .all();
}

/** A row's change for the causing event's `changes` (null = inserted / deleted). */
export const triggerStateChange = (
  before: TriggerStateRow | null,
  after: TriggerStateRow | null,
): RecordChange => ({
  type: TRIGGER_STATE_TYPE,
  id: (after ?? before)?.id as string,
  before,
  after,
});

export const triggerStateRecordType = defineRecordType<TriggerStateRow>({
  type: TRIGGER_STATE_TYPE,
  scope: "campaign",
  schema: TriggerStateRecord,
  idOf: (r) => r.id,
  campaignOf: (r) => r.campaignId,
  visibility: triggerStateVisibility,
  snapshot: ({ db }, v) => campaignTriggerStates(db, v.campaignId),
});
