// REST for encounters (CBT §9, protocol §21). Mounted at /api. DM only; no GET (snapshot).
import { EncounterBody, type EncounterRecord } from "@shared/combat-tracker/schemas";
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
import { ENCOUNTER_REST } from "./encounters";

export function encounterRoutes(s: Services) {
  return new Hono<DmCampaignEnv>()
    .post("/encounters", dmOnly(s), dmCampaign(s), jsonBody(EncounterBody), (c) => {
      try {
        const encounter = s.commands.run(ENCOUNTER_REST.create, c.req.valid("json"), {
          actor: dmActor(c.get("campaignId")),
        }) as EncounterRecord;
        return c.json({ encounter }, 201);
      } catch (err) {
        return errorResponse(c, err, s);
      }
    })
    .put("/encounters/:id", dmOnly(s), dmCampaign(s), jsonBody(EncounterBody), (c) => {
      try {
        const input = { ...c.req.valid("json"), id: c.req.param("id") };
        const encounter = s.commands.run(ENCOUNTER_REST.update, input, {
          actor: dmActor(c.get("campaignId")),
        }) as EncounterRecord;
        return c.json({ encounter }, 200);
      } catch (err) {
        return errorResponse(c, err, s);
      }
    })
    .delete("/encounters/:id", dmOnly(s), dmCampaign(s), (c) => {
      try {
        s.commands.run(
          ENCOUNTER_REST.delete,
          { id: c.req.param("id") },
          { actor: dmActor(c.get("campaignId")) },
        );
        return c.body(null, 204);
      } catch (err) {
        return errorResponse(c, err, s);
      }
    });
}
