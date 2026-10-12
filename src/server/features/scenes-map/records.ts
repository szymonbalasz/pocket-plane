// Record types `scene`, `scene-folder`, `token` (FR-MAP-26, protocol §12). Providers return
// every scene's rows of the campaign; the scene gate filters for players (CON-22).
import {
  SCENE_FOLDER_TYPE,
  SCENE_TYPE,
  SceneFolderRecord,
  SceneRecord,
  TOKEN_TYPE,
  TokenRecord,
} from "@shared/scenes-map/schemas";
import { asc, eq } from "drizzle-orm";
import { scene, sceneFolder, token } from "../../db/schema";
import { defineRecordType } from "../../ws/records";
import { toFolderRecord, toSceneRecord, toTokenRecord } from "./rows";
import {
  folderVisibility,
  redactScene,
  redactToken,
  sceneVisibility,
  tokenVisibility,
} from "./visibility";

export const sceneRecordTypes = [
  defineRecordType<SceneRecord>({
    type: SCENE_TYPE,
    scope: "scene",
    schema: SceneRecord,
    idOf: (r) => r.id,
    campaignOf: (r) => r.campaignId,
    sceneOf: (r) => r.id,
    visibility: sceneVisibility,
    redact: redactScene,
    snapshot: ({ db }, v) =>
      db
        .select()
        .from(scene)
        .where(eq(scene.campaignId, v.campaignId))
        .orderBy(asc(scene.seq))
        .all()
        .map(toSceneRecord),
  }),
  defineRecordType<SceneFolderRecord>({
    type: SCENE_FOLDER_TYPE,
    scope: "campaign",
    // DM only: players get no list at all (FR-MAP-26).
    audience: "dm",
    schema: SceneFolderRecord,
    idOf: (r) => r.id,
    campaignOf: (r) => r.campaignId,
    visibility: folderVisibility,
    snapshot: ({ db }, v) =>
      db
        .select()
        .from(sceneFolder)
        .where(eq(sceneFolder.campaignId, v.campaignId))
        .orderBy(asc(sceneFolder.seq))
        .all()
        .map(toFolderRecord),
  }),
  defineRecordType<TokenRecord>({
    type: TOKEN_TYPE,
    scope: "scene",
    schema: TokenRecord,
    idOf: (r) => r.id,
    campaignOf: (r) => r.campaignId,
    sceneOf: (r) => r.sceneId,
    visibility: tokenVisibility,
    redact: redactToken,
    // ≤ 1,000 per campaign (FR-MAP-14).
    snapshot: ({ db }, v) =>
      db
        .select()
        .from(token)
        .where(eq(token.campaignId, v.campaignId))
        .orderBy(asc(token.seq))
        .all()
        .map(toTokenRecord),
  }),
] as const;
