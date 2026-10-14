// Record type `effect` (FR-CBTX-31, protocol §32). Campaign scope; DM full; players get the
// redaction of non-secret, non-hidden, active effects. Snapshot: active effects only (ended ones
// are history, not state); capped at 300 per campaign (FR-CBTX-04), so not windowed.
import {
  EFFECT_TYPE,
  EffectRecord,
  effectVisibleToPlayers,
  redactEffect,
} from "@shared/combat-extras/schemas";
import { and, asc, eq, isNull } from "drizzle-orm";
import { effect } from "../../db/schema";
import { defineRecordType, type Visibility } from "../../ws/records";
import { toEffectRecord } from "./rows";

export const effectVisibility = (r: EffectRecord): Visibility =>
  effectVisibleToPlayers(r) ? "redacted" : "hidden";

export const effectRecordType = defineRecordType<EffectRecord>({
  type: EFFECT_TYPE,
  scope: "campaign",
  schema: EffectRecord,
  idOf: (r) => r.id,
  campaignOf: (r) => r.campaignId,
  visibility: effectVisibility,
  redact: redactEffect,
  snapshot: ({ db }, v) =>
    db
      .select()
      .from(effect)
      .where(and(eq(effect.campaignId, v.campaignId), isNull(effect.endedAt)))
      .orderBy(asc(effect.seq))
      .all()
      .map(toEffectRecord),
});
