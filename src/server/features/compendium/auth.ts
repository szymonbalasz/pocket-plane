// Route-local REST auth for the compendium reads (FR-CMP-13, OQ-CMP-20, ADR-0046 amending
// ADR-0019): `Authorization: Bearer <DM secret>` (campaign = the active one) or
// `Authorization: Player <link token>` (campaign = the link's; inactive → 409). Not server core:
// no other route accepts a player credential.
import { createMiddleware } from "hono/factory";
import { errorBody } from "../../http";
import type { Services } from "../../services";
import type { EntryViewer } from "./visibility";

/** Hono env of routes behind `compendiumAuth`. */
export type CompendiumEnv = { Variables: { viewer: EntryViewer } };

/** FR-CMP-12: every compendium response, errors included. */
export const CMP_CACHE_CONTROL = "private, no-cache";

/** Outermost: sets `Cache-Control` on whatever the inner layers answered (incl. 401 / 409). */
export const noCache = createMiddleware(async (c, next) => {
  await next();
  c.res.headers.set("Cache-Control", CMP_CACHE_CONTROL);
});

const CREDENTIAL = /^(Bearer|Player)\s+(\S+)\s*$/i;

export function compendiumAuth(s: Services) {
  return createMiddleware<CompendiumEnv>(async (c, next) => {
    const m = CREDENTIAL.exec(c.req.header("authorization") ?? "");
    const scheme = m?.[1]?.toLowerCase();
    const value = m?.[2];
    if (!scheme || !value) {
      return c.json(errorBody("unauthorized", "DM secret or player link required"), 401);
    }
    if (scheme === "bearer") {
      const r = s.auth.verifyDmCredential(value);
      if (r === "throttled") {
        return c.json(errorBody("throttled", "Too many attempts. Try again in a minute."), 429);
      }
      if (r === "invalid") return c.json(errorBody("unauthorized", "Wrong DM secret"), 401);
      if (r === "noActiveCampaign") return c.json(errorBody("conflict", "No active campaign"), 409);
      c.set("viewer", { role: "dm", campaignId: r.campaignId, playerId: null });
    } else {
      const l = s.auth.resolvePlayerLink(value);
      if (!l) return c.json(errorBody("unauthorized", "Unknown player link"), 401);
      if (!l.campaignActive) {
        return c.json(errorBody("conflict", "This campaign isn't active"), 409);
      }
      c.set("viewer", { role: "player", campaignId: l.campaignId, playerId: l.playerId });
    }
    await next();
  });
}
