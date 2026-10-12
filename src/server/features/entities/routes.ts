// REST for entities (ENT §9, protocol §13). Mounted at /api. No GET: the snapshot carries
// the records. No route reaches `entities.import` (FR-FIX-24) and none deletes (FR-ENT-14).
import {
  CreateEntityBody,
  type EntityRecord,
  type EntityResponse,
  UpdateEntityBody,
} from "@shared/entities/schemas";
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
import { CREATE, UPDATE } from "./commands";

export function entityRoutes(s: Services) {
  return new Hono<DmCampaignEnv>()
    .post("/entities", dmOnly(s), dmCampaign(s), jsonBody(CreateEntityBody), (c) => {
      try {
        const entity = s.commands.run(CREATE, c.req.valid("json"), {
          actor: dmActor(c.get("campaignId")),
        }) as EntityRecord;
        return c.json({ entity } satisfies EntityResponse, 201);
      } catch (err) {
        return errorResponse(c, err, s);
      }
    })
    .put("/entities/:id", dmOnly(s), dmCampaign(s), jsonBody(UpdateEntityBody), (c) => {
      try {
        const input = { ...c.req.valid("json"), id: c.req.param("id") };
        const entity = s.commands.run(UPDATE, input, {
          actor: dmActor(c.get("campaignId")),
        }) as EntityRecord;
        return c.json({ entity } satisfies EntityResponse, 200);
      } catch (err) {
        return errorResponse(c, err, s);
      }
    });
}
