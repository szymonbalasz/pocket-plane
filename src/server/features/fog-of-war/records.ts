// Record type `fog` (FOG §9, protocol §35). Scene scope, `sceneOf = id` (= the scene id). DM: full,
// every scene's row (compact; **never** windowed, ADR-0041). Players: redacted (no campaign, no
// undo), active scene only via the scene gate (CON-22).
import {
  FOG_TYPE,
  type FogRecord,
  FogRecord as FogRecordSchema,
  type PlayerFogRecord,
} from "@shared/fog-of-war/schemas";
import { defineRecordType, type Visibility } from "../../ws/records";
import { campaignFogRecords } from "./rows";

export const fogVisibility = (): Visibility => "redacted";

export function redactFog(r: FogRecord): PlayerFogRecord {
  return { id: r.id, fill: r.fill, box: r.box, runs: r.runs };
}

export const fogRecordType = defineRecordType<FogRecord>({
  type: FOG_TYPE,
  scope: "scene",
  schema: FogRecordSchema,
  idOf: (r) => r.id,
  campaignOf: (r) => r.campaignId,
  sceneOf: (r) => r.id,
  visibility: fogVisibility,
  redact: redactFog,
  snapshot: ({ db }, v) => campaignFogRecords(db, v.campaignId),
});
