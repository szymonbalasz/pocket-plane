// REST for campaign-management (CAMP §9; paths per OQ-CAMP-15, proposed). Mounted at /api.
import {
  AddPlayerBody,
  type CampaignSummary,
  CreateCampaignBody,
  type JoinInfo,
  type PlayerWithLink,
  RenameCampaignBody,
  RenamePlayerBody,
} from "@shared/campaign-management/schemas";
import { asc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { campaign, player } from "../../db/schema";
import type { Actor } from "../../events/types";
import { dmOnly, errorBody, errorResponse, jsonBody } from "../../http";
import type { Services } from "../../services";
import { lookupPlayerLink } from "./auth";
import {
  activateCampaign,
  activeCampaign,
  addPlayer,
  createCampaign,
  renameCampaign,
  renamePlayer,
} from "./commands";

const DM: Actor = { role: "dm", playerId: null, campaignId: null };

export function campaignRoutes(s: Services) {
  const dm = dmOnly(s);
  const run = <T>(c: Parameters<typeof errorResponse>[0], fn: () => T) => {
    try {
      return { ok: true as const, value: fn() };
    } catch (err) {
      return { ok: false as const, response: errorResponse(c, err, s) };
    }
  };

  return new Hono()
    .post("/dm/login", dm, (c) => c.body(null, 204))
    .get("/campaigns", dm, (c) => {
      const campaigns: CampaignSummary[] = s.db
        .select({ id: campaign.id, name: campaign.name, active: campaign.active })
        .from(campaign)
        .orderBy(asc(campaign.createdAt), asc(sql`rowid`))
        .all();
      return c.json({ campaigns }, 200);
    })
    .post("/campaigns", dm, jsonBody(CreateCampaignBody), (c) => {
      const r = run(c, () => s.commands.run(createCampaign, c.req.valid("json"), { actor: DM }));
      if (!r.ok) return r.response;
      return c.json({ campaign: r.value satisfies CampaignSummary }, 201);
    })
    .patch("/campaigns/:id", dm, jsonBody(RenameCampaignBody), (c) => {
      const input = { id: c.req.param("id"), ...c.req.valid("json") };
      const r = run(c, () => s.commands.run(renameCampaign, input, { actor: DM }));
      if (!r.ok) return r.response;
      return c.json({ campaign: r.value satisfies CampaignSummary }, 200);
    })
    .post("/campaigns/:id/activate", dm, (c) => {
      const input = { id: c.req.param("id") };
      const r = run(c, () => s.commands.run(activateCampaign, input, { actor: DM }));
      if (!r.ok) return r.response;
      return c.json({ campaign: r.value satisfies CampaignSummary }, 200);
    })
    .get("/players", dm, (c) => {
      const active = activeCampaign(s.db);
      if (!active) return c.json(errorBody("conflict", "No active campaign"), 409);
      const players: PlayerWithLink[] = s.db
        .select({ id: player.id, name: player.name, linkToken: player.linkToken })
        .from(player)
        .where(eq(player.campaignId, active.id))
        .orderBy(asc(player.createdAt), asc(sql`rowid`))
        .all();
      return c.json({ campaignId: active.id, publicBaseUrl: s.config.publicBaseUrl, players }, 200);
    })
    .post("/players", dm, jsonBody(AddPlayerBody), (c) => {
      const r = run(c, () => s.commands.run(addPlayer, c.req.valid("json"), { actor: DM }));
      if (!r.ok) return r.response;
      return c.json({ player: r.value satisfies PlayerWithLink }, 201);
    })
    .patch("/players/:id", dm, jsonBody(RenamePlayerBody), (c) => {
      const input = { id: c.req.param("id"), ...c.req.valid("json") };
      const r = run(c, () => s.commands.run(renamePlayer, input, { actor: DM }));
      if (!r.ok) return r.response;
      return c.json({ player: r.value satisfies PlayerWithLink }, 200);
    })
    .get("/join/:token", (c) => {
      const link = lookupPlayerLink(s.db, c.req.param("token"));
      if (!link) return c.json(errorBody("not_found", "Unknown link"), 404);
      const body: JoinInfo = {
        playerName: link.playerName,
        campaignName: link.campaignName,
        campaignActive: link.campaignActive,
      };
      return c.json(body, 200);
    });
}
