// REST for scenes and scene folders (MAP §9, protocol §13), DM only. Mounted at /api. No GET:
// the snapshot carries the records.
import {
  CreateSceneBody,
  PatchSceneBody,
  SceneFolderBody,
  type SceneFolderRecord,
  type SceneFolderResponse,
  type SceneRecord,
  type SceneResponse,
} from "@shared/scenes-map/schemas";
import { Hono } from "hono";
import {
  type DmCampaignEnv,
  dmActor,
  dmCampaign,
  dmOnly,
  errorResponse,
  jsonBody,
} from "../../http";
import type { Services } from "../../services";
import { MAP_REST } from "./commands";

export function sceneRoutes(s: Services) {
  const run = <R>(name: string, input: unknown, campaignId: string) =>
    s.commands.run(name, input, { actor: dmActor(campaignId) }) as R;
  return new Hono<DmCampaignEnv>()
    .post("/scenes", dmOnly(s), dmCampaign(s), jsonBody(CreateSceneBody), (c) => {
      try {
        const scene = run<SceneRecord>(
          MAP_REST.createScene,
          c.req.valid("json"),
          c.get("campaignId"),
        );
        return c.json({ scene } satisfies SceneResponse, 201);
      } catch (err) {
        return errorResponse(c, err, s);
      }
    })
    .patch("/scenes/:id", dmOnly(s), dmCampaign(s), jsonBody(PatchSceneBody), (c) => {
      try {
        const input = { ...c.req.valid("json"), id: c.req.param("id") };
        const scene = run<SceneRecord>(MAP_REST.updateScene, input, c.get("campaignId"));
        return c.json({ scene } satisfies SceneResponse, 200);
      } catch (err) {
        return errorResponse(c, err, s);
      }
    })
    .delete("/scenes/:id", dmOnly(s), dmCampaign(s), (c) => {
      try {
        run(MAP_REST.deleteScene, { id: c.req.param("id") }, c.get("campaignId"));
        return c.body(null, 204);
      } catch (err) {
        return errorResponse(c, err, s);
      }
    })
    .post("/scenes/:id/duplicate", dmOnly(s), dmCampaign(s), (c) => {
      try {
        const scene = run<SceneRecord>(
          MAP_REST.duplicateScene,
          { id: c.req.param("id") },
          c.get("campaignId"),
        );
        return c.json({ scene } satisfies SceneResponse, 201);
      } catch (err) {
        return errorResponse(c, err, s);
      }
    })
    .post("/scene-folders", dmOnly(s), dmCampaign(s), jsonBody(SceneFolderBody), (c) => {
      try {
        const sceneFolder = run<SceneFolderRecord>(
          MAP_REST.createFolder,
          c.req.valid("json"),
          c.get("campaignId"),
        );
        return c.json({ sceneFolder } satisfies SceneFolderResponse, 201);
      } catch (err) {
        return errorResponse(c, err, s);
      }
    })
    .patch("/scene-folders/:id", dmOnly(s), dmCampaign(s), jsonBody(SceneFolderBody), (c) => {
      try {
        const sceneFolder = run<SceneFolderRecord>(
          MAP_REST.renameFolder,
          { ...c.req.valid("json"), id: c.req.param("id") },
          c.get("campaignId"),
        );
        return c.json({ sceneFolder } satisfies SceneFolderResponse, 200);
      } catch (err) {
        return errorResponse(c, err, s);
      }
    })
    .delete("/scene-folders/:id", dmOnly(s), dmCampaign(s), (c) => {
      try {
        run(MAP_REST.deleteFolder, { id: c.req.param("id") }, c.get("campaignId"));
        return c.body(null, 204);
      } catch (err) {
        return errorResponse(c, err, s);
      }
    });
}
