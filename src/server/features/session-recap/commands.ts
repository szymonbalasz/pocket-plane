// session-recap commands (RECAP §9): `recap.query` (DM, player) is read-only: no write, event, log
// row or `seq`, so the hub answers it in frame order (FR-RECAP-01). `recap.share` (DM) notifies
// all in one transaction with its log row (FR-RECAP-20). Results parse with the viewer's role
// schema (FR-RECAP-08).
import {
  type DmRecapResult,
  type PlayerRecapResult,
  RECAP_QUERY_INTENT,
  RECAP_SHARE_INTENT,
  RecapQueryInput,
  RecapShareInput,
  type RecapShareResult,
  recapShareText,
  SESSION_RECAP_KIND,
} from "@shared/session-recap/schemas";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { conflict, notFound } from "../../commands/errors";
import { activeCampaign } from "../campaign-management/commands";
import { campaignFeatures } from "../campaign-management/features";
import type { StatsViewer } from "../dice-roll-log/stats-read";
import { notify } from "../notifications";
import { lootHighWater } from "../party-loot/recap-read";
import type { SessionCache } from "../stats/cache";
import { awardsPayload, pickSession, type StatsRead } from "../stats/compute";
import { lootRange, recapBody, recapFor, recapHeader, sharedOf } from "./compose";
import type { RecapGate } from "./memo";

/** The actor's campaign (WS: the connection's; REST / system: the active one). */
function readOf(env: CommandEnv): StatsRead {
  const campaignId = env.actor.campaignId ?? activeCampaign(env.tx)?.id;
  if (!campaignId) throw conflict("No active campaign");
  const viewer: StatsViewer = {
    role: env.actor.role === "player" ? "player" : "dm",
    features: campaignFeatures(env.tx, campaignId),
  };
  return { db: env.tx, viewer, campaignId };
}

export function recapCommands(sessions: () => SessionCache, gate: RecapGate) {
  const query = defineCommand({
    name: RECAP_QUERY_INTENT,
    input: RecapQueryInput,
    roles: ["dm", "player"],
    execute(input, env): DmRecapResult | PlayerRecapResult {
      const r = readOf(env);
      const all = sessions().sessions(r.db, r.campaignId);
      // FR-RECAP-02: stats' rule (listable sessions; absent `n` = the newest; else `not_found`).
      const hit = pickSession(r, all, input.n);
      if (!hit) return { recap: null };
      const { fromAt, toAt } = lootRange(all, hit.s);
      const body = gate.answer({
        campaignId: r.campaignId,
        actorKey: `${r.campaignId}|${env.actor.role}|${env.actor.playerId ?? ""}`,
        // FR-RECAP-29: every player shares one entry (FR-RECAP-03).
        memoKey: `${hit.s.fromN}|${r.viewer.role}|${r.viewer.features.join(",")}`,
        loot: lootHighWater(r.db, r.campaignId, fromAt, toAt),
        now: env.ctx.clock.now(),
        compute: () => recapBody(r, all, hit.s),
      });
      const shared = sharedOf(r.db, r.campaignId, hit.s.fromN);
      return { recap: recapFor(r.viewer.role, recapHeader(hit), body, shared) } as
        | DmRecapResult
        | PlayerRecapResult;
    },
  });

  const share = defineCommand({
    name: RECAP_SHARE_INTENT,
    input: RecapShareInput,
    execute({ fromN, note, omit }, env): RecapShareResult {
      const r = readOf(env);
      const s = sessions()
        .sessions(r.db, r.campaignId)
        .find((x) => x.fromN === fromN);
      if (!s) throw notFound("Session not found");
      const payload = {
        ...awardsPayload(s, r.viewer.features),
        ...(note ? { note } : {}),
        omit: omit ?? [],
      };
      const notificationId = notify(env, {
        kind: SESSION_RECAP_KIND,
        audience: "all",
        text: recapShareText(payload.label),
        payload,
      });
      return { notificationId };
    },
  });

  return { query, share };
}
