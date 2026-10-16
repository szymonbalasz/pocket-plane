// fog-of-war record types (FOG §9, protocol §35):
// - `fog`: scene scope, `sceneOf = id`; `dmWindow: "active-scene"` (OQ-FOG-30 B: the DM snapshot
//   holds the active scene's row, others load with `sync.loadScene`). DM: the record without
//   darkness `seenBy`. Players: redacted (no campaign, no undo; darkness = only shapes with the
//   viewer in `seenBy`, FR-FOG-44), active scene only via the scene gate (CON-22).
// - `fog-explored` (FR-FOG-37) and `vision` (FR-FOG-39, derived): `dmWindow: "view-as"`
//   (FR-FOG-43): the DM snapshot carries none; `sync.loadScene {sceneId, viewAs}` loads one
//   player's. Players: their own rows only. V0 registers them empty: nothing writes memory and
//   no vision source exists before V2.
import {
  FOG_EXPLORED_TYPE,
  FOG_TYPE,
  FogExploredRecord,
  FogRecord as FogRecordSchema,
  type PlayerFogRecord,
  VISION_TYPE,
  VisionRecord,
} from "@shared/fog-of-war/schemas";
import { defineRecordType, type Viewer, type Visibility } from "../../ws/records";
import {
  campaignExploredRecords,
  campaignFogRecords,
  dmFogRecord,
  type ServerExploredRecord,
  type ServerFogRecord,
  wireDarkness,
} from "./rows";

export const fogVisibility = (): Visibility => "redacted";

export function redactFog(r: ServerFogRecord, v: Viewer): PlayerFogRecord {
  const p = v.playerId;
  return {
    id: r.id,
    fill: r.fill,
    box: r.box,
    runs: r.runs,
    shapes: r.shapes,
    darkness: r.darkness
      .filter((d) => p !== null && (d.seenBy ?? []).includes(p))
      .map(wireDarkness),
    explored: r.explored,
  };
}

export const fogRecordType = defineRecordType<ServerFogRecord>({
  type: FOG_TYPE,
  scope: "scene",
  schema: FogRecordSchema as never,
  idOf: (r) => r.id,
  campaignOf: (r) => r.campaignId,
  sceneOf: (r) => r.id,
  visibility: fogVisibility,
  redact: redactFog,
  dmRedact: dmFogRecord,
  dmWindow: "active-scene",
  snapshot: ({ db }, v) => campaignFogRecords(db, v.campaignId),
});

/** A per-player row: the owner only (FR-FOG-37 / -39). */
const ownRow = (r: { playerId: string }, v: Viewer): Visibility =>
  v.playerId !== null && r.playerId === v.playerId ? "redacted" : "hidden";

const wireExplored = ({ campaignId: _c, ...r }: ServerExploredRecord): FogExploredRecord => r;

export const fogExploredRecordType = defineRecordType<ServerExploredRecord>({
  type: FOG_EXPLORED_TYPE,
  scope: "scene",
  schema: FogExploredRecord as never,
  idOf: (r) => r.id,
  campaignOf: (r) => r.campaignId,
  sceneOf: (r) => r.sceneId,
  visibility: ownRow,
  redact: wireExplored,
  dmRedact: wireExplored,
  dmWindow: "view-as",
  snapshot: ({ db }, v, scope) =>
    campaignExploredRecords(db, v.campaignId).filter(
      (r) =>
        (scope === undefined || r.sceneId === scope.sceneId) &&
        (v.role === "dm" || r.playerId === v.playerId),
    ),
});

/** Server `vision` rows carry `campaignId` for the scope gate. */
export type ServerVisionRecord = VisionRecord & { campaignId: string };

const wireVision = ({ campaignId: _c, ...r }: ServerVisionRecord): VisionRecord => r;

export const visionRecordType = defineRecordType<ServerVisionRecord>({
  type: VISION_TYPE,
  scope: "scene",
  derived: true,
  schema: VisionRecord as never,
  idOf: (r) => r.id,
  campaignOf: (r) => r.campaignId,
  sceneOf: (r) => r.sceneId,
  visibility: ownRow,
  redact: wireVision,
  dmRedact: wireVision,
  dmWindow: "view-as",
  // V0: no vision source exists (senses are set from V2 on); V2 computes from the DB here.
  snapshot: () => [],
});
