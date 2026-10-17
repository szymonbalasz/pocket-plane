// fog-of-war record types (FOG §9, protocol §35):
// - `fog`: scene scope, `sceneOf = id`; `dmWindow: "active-scene"` (OQ-FOG-30 B: the DM snapshot
//   holds the active scene's row, others load with `sync.loadScene`). DM: the record without
//   darkness `seenBy`. Players: redacted (no campaign, no undo; darkness = only shapes with the
//   viewer in `seenBy`, FR-FOG-44), active scene only via the scene gate (CON-22).
// - `fog-explored` (FR-FOG-37) and `vision` (FR-FOG-39, derived): `dmWindow: "view-as"`
//   (FR-FOG-43): the DM snapshot carries none; `sync.loadScene {sceneId, viewAs}` loads one
//   player's (`viewAs: "party"`: every player's). Players: their own rows; sprint 4 (FR-FOG-51):
//   while party vision is on, every other player's `vision` too, redacted (no `inv`), through
//   the record's server-only `shared` flag. `vision` is derived (no table): the snapshot computes
//   it from the DB through the vision cache; commands list before / after (`rederive.ts`).
import {
  FOG_EXPLORED_TYPE,
  FOG_TYPE,
  FogExploredRecord,
  FogRecord as FogRecordSchema,
  type PlayerFogRecord,
  VISION_TYPE,
  VisionRecord,
} from "@shared/fog-of-war/schemas";
import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { scene } from "../../db/schema";
import { defineRecordType, type Viewer, type Visibility } from "../../ws/records";
import { loadSceneSight } from "./derive";
import {
  campaignExploredRecords,
  campaignFogRecords,
  dmFogRecord,
  type ServerExploredRecord,
  type ServerFogRecord,
  type ServerVisionRecord,
  toVisionRecord,
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

/**
 * FR-FOG-51: `vision` = the owner, and every other player of the campaign while the record is
 * `shared` (party vision on at compute time); the scope gate checks the campaign.
 */
export const visionVisibility = (r: ServerVisionRecord, v: Viewer): Visibility =>
  v.playerId !== null && (r.playerId === v.playerId || r.shared) ? "redacted" : "hidden";

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

/**
 * FR-FOG-39: `vision` rows computed from the DB (cached sight, FR-FOG-38), `shared` from the
 * campaign's switch (FR-FOG-51). A player: every row of the active scene (the visibility fn keeps
 * their own, plus the others' while shared); the DM: only on a View-as load (`scope`, FR-FOG-43).
 */
function visionSnapshot(db: Db, v: Viewer, scope?: { sceneId: string }): ServerVisionRecord[] {
  if (v.role === "dm" && !scope) return [];
  const sceneId =
    scope?.sceneId ??
    db
      .select({ id: scene.id })
      .from(scene)
      .where(and(eq(scene.campaignId, v.campaignId), eq(scene.active, true)))
      .get()?.id;
  if (!sceneId) return [];
  const loaded = loadSceneSight(db, sceneId);
  if (!loaded || loaded.campaignId !== v.campaignId) return [];
  const sc = { sceneId, campaignId: loaded.campaignId };
  return [...loaded.sight].map(([p, e]) => toVisionRecord(sc, p, e.vision, loaded.party));
}

const wireVision = ({ campaignId: _c, shared: _s, ...r }: ServerVisionRecord): VisionRecord => r;

/** FR-FOG-51: own row in full; another player's shared copy without `inv`. */
export function redactVision(r: ServerVisionRecord, v: Viewer): VisionRecord {
  const w = wireVision(r);
  if (r.playerId === v.playerId) return w;
  const { inv: _inv, ...rest } = w;
  return rest;
}

export const visionRecordType = defineRecordType<ServerVisionRecord>({
  type: VISION_TYPE,
  scope: "scene",
  derived: true,
  schema: VisionRecord as never,
  idOf: (r) => r.id,
  campaignOf: (r) => r.campaignId,
  sceneOf: (r) => r.sceneId,
  visibility: visionVisibility,
  redact: redactVision,
  dmRedact: wireVision,
  dmWindow: "view-as",
  snapshot: ({ db }, v, scope) => visionSnapshot(db, v, scope),
});
