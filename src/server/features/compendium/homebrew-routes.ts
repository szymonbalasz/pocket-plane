// Compendium homebrew REST (CMP §9, FR-CMP-24/25/27; C4). Mounted at /api, DM only (DM secret;
// a player credential → 401). `POST /compendium/entries` / `PUT …/:id`: `cmp.putEntry`;
// `DELETE …/:id`: `cmp.deleteEntry`; `POST /compendium/derive-monster`: `cmp.deriveMonster`.
import {
  DeriveMonsterBody,
  type DeriveMonsterResponse,
  PutEntryBody,
  type PutEntryResponse,
} from "@shared/compendium/homebrew";
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
import { noCache } from "./auth";
import { DERIVE_MONSTER } from "./derive";
import { DELETE_ENTRY, PUT_ENTRY } from "./homebrew";

export function compendiumHomebrewRoutes(s: Services) {
  return new Hono<DmCampaignEnv>()
    .use("/compendium/*", noCache)
    .post("/compendium/entries", dmOnly(s), dmCampaign(s), jsonBody(PutEntryBody), (c) => {
      try {
        const r = s.commands.run(PUT_ENTRY, c.req.valid("json"), {
          actor: dmActor(c.get("campaignId")),
        }) as PutEntryResponse;
        return c.json(r, 201);
      } catch (err) {
        return errorResponse(c, err, s);
      }
    })
    .put("/compendium/entries/:id", dmOnly(s), dmCampaign(s), jsonBody(PutEntryBody), (c) => {
      try {
        const r = s.commands.run(
          PUT_ENTRY,
          { ...c.req.valid("json"), id: c.req.param("id") },
          { actor: dmActor(c.get("campaignId")) },
        ) as PutEntryResponse;
        return c.json(r, 200);
      } catch (err) {
        return errorResponse(c, err, s);
      }
    })
    .delete("/compendium/entries/:id", dmOnly(s), dmCampaign(s), (c) => {
      try {
        s.commands.run(
          DELETE_ENTRY,
          { id: c.req.param("id") },
          { actor: dmActor(c.get("campaignId")) },
        );
        return c.body(null, 204);
      } catch (err) {
        return errorResponse(c, err, s);
      }
    })
    .post(
      "/compendium/derive-monster",
      dmOnly(s),
      dmCampaign(s),
      jsonBody(DeriveMonsterBody),
      (c) => {
        try {
          const r = s.commands.run(DERIVE_MONSTER, c.req.valid("json"), {
            actor: dmActor(c.get("campaignId")),
          }) as DeriveMonsterResponse;
          return c.json(r, 201);
        } catch (err) {
          return errorResponse(c, err, s);
        }
      },
    );
}
