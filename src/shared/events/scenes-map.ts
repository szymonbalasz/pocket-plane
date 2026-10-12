// Domain events of scenes-map (MAP §9, protocol §16). All logged except `TokenMoved`
// (ADR-0016); none transient or undoable.
import { z } from "zod";
import { defineEvent } from "./types";

const scenePayload = z.object({ sceneId: z.string() }).strict();
const folderPayload = z.object({ folderId: z.string() }).strict();
const tokenPayload = z.object({ tokenId: z.string(), sceneId: z.string() }).strict();

const logged = <P extends z.ZodType>(type: string, payload: P) =>
  defineEvent({ type, payload, logged: true, undoable: false });

/** POST /api/scenes. */
export const SceneCreated = logged("SceneCreated", scenePayload);
/** PATCH /api/scenes/:id, `map.setSceneMap`, `map.setGrid`, `map.setLocked` (CON-31). */
export const SceneUpdated = logged("SceneUpdated", scenePayload);
/** POST /api/scenes/:id/duplicate; changes include every copied token. */
export const SceneDuplicated = logged(
  "SceneDuplicated",
  z.object({ sceneId: z.string(), sourceSceneId: z.string() }).strict(),
);
/** DELETE /api/scenes/:id; changes include the scene's tokens + token-changed hook rows. */
export const SceneDeleted = logged("SceneDeleted", scenePayload);

export const SceneFolderCreated = logged("SceneFolderCreated", folderPayload);
export const SceneFolderRenamed = logged("SceneFolderRenamed", folderPayload);
/** Changes include the scenes moved to the root. */
export const SceneFolderDeleted = logged("SceneFolderDeleted", folderPayload);

/** `map.activateScene`: both scene upserts; players are resynced after commit (FR-MAP-06). */
export const SceneActivated = logged(
  "SceneActivated",
  z.object({ sceneId: z.string(), previousSceneId: z.string().nullable() }).strict(),
);

export const TokenPlaced = logged("TokenPlaced", tokenPayload);
export const TokenUpdated = logged("TokenUpdated", tokenPayload);
export const TokenDuplicated = logged(
  "TokenDuplicated",
  z.object({ tokenId: z.string(), sceneId: z.string(), sourceTokenId: z.string() }).strict(),
);
export const TokenDeleted = logged("TokenDeleted", tokenPayload);
export const TokenHidden = logged("TokenHidden", tokenPayload);
export const TokenRevealed = logged("TokenRevealed", tokenPayload);

/** `map.moveToken`: not logged (ADR-0016). */
export const TokenMoved = defineEvent({
  type: "TokenMoved",
  payload: z
    .object({
      tokenId: z.string(),
      sceneId: z.string(),
      col: z.number().int(),
      row: z.number().int(),
    })
    .strict(),
  logged: false,
  undoable: false,
});
