// stats commands (STATS §9): `stats.query` (DM, player) is read-only: no write, event, log row or
// `seq`, so the hub answers it in frame order (FR-STATS-16). `stats.showAwards` (DM) notifies all
// (FR-STATS-20, FR-NOTE-48). Results parse with the viewer's role schema (FR-STATS-05).
import {
  DmStatsResult,
  PlayerStatsResult,
  ShowAwardsInput,
  type ShowAwardsResult,
  STATS_AWARDS_KIND,
  STATS_QUERY_INTENT,
  STATS_SHOW_AWARDS_INTENT,
  StatsQueryInput,
} from "@shared/stats/schemas";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { conflict, notFound } from "../../commands/errors";
import { activeCampaign } from "../campaign-management/commands";
import { campaignFeatures } from "../campaign-management/features";
import type { StatsViewer } from "../dice-roll-log/stats-read";
import { notify } from "../notifications";
import type { QueryGate, SessionCache } from "./cache";
import {
  awardsPayload,
  fightStats,
  luckStats,
  type StatsRead,
  sessionStats,
  sessionsStats,
  trophiesStats,
} from "./compute";
import type { Partials } from "./partials";

/** The actor's campaign (WS: the connection's; REST / system: the active one). */
function campaignOf(env: CommandEnv): string {
  const id = env.actor.campaignId ?? activeCampaign(env.tx)?.id;
  if (!id) throw conflict("No active campaign");
  return id;
}

function readOf(env: CommandEnv): StatsRead {
  const campaignId = campaignOf(env);
  const viewer: StatsViewer = {
    role: env.actor.role === "player" ? "player" : "dm",
    features: campaignFeatures(env.tx, campaignId),
  };
  return { db: env.tx, viewer, campaignId };
}

/** FR-STATS-46: a campaign answer still waiting for its partials (never memoised). */
const isPending = (x: unknown): boolean => {
  const v = x as { luck?: { pending?: true }; trophies?: { pending?: true } };
  return v.luck?.pending === true || v.trophies?.pending === true;
};

export function statsCommands(cache: SessionCache, gate: QueryGate, partials: Partials) {
  const query = defineCommand({
    name: STATS_QUERY_INTENT,
    input: StatsQueryInput,
    roles: ["dm", "player"],
    execute(input, env): DmStatsResult | PlayerStatsResult {
      const r = readOf(env);
      const role = r.viewer.role;
      return gate.answer({
        campaignId: r.campaignId,
        actorKey: `${r.campaignId}|${env.actor.role}|${env.actor.playerId ?? ""}`,
        // Every player gets the same numbers (FR-STATS-03): one memo per viewer class.
        // Trophies: a player's answer depends on who asks (own character only, FR-STATS-43).
        memoKey: `${role}|${r.viewer.features.join(",")}|${JSON.stringify(input)}${
          input.scope === "trophies" && role !== "dm" ? `|${env.actor.playerId ?? ""}` : ""
        }`,
        now: env.ctx.clock.now(),
        keep: (x) => !isPending(x),
        compute: () => {
          const sessions = () => cache.sessions(r.db, r.campaignId);
          const result =
            input.scope === "fight"
              ? fightStats(r, input.encounterId)
              : input.scope === "session"
                ? sessionStats(r, sessions(), input.n)
                : input.scope === "luck"
                  ? luckStats(r, sessions(), partials, input)
                  : input.scope === "trophies"
                    ? trophiesStats(r, partials, input.characterId, env.actor.playerId)
                    : sessionsStats(r, sessions());
          // FR-STATS-05: the role's strict schema; a field it lacks is a bug, never sent.
          return role === "dm" ? DmStatsResult.parse(result) : PlayerStatsResult.parse(result);
        },
      });
    },
  });

  const showAwards = defineCommand({
    name: STATS_SHOW_AWARDS_INTENT,
    input: ShowAwardsInput,
    execute({ fromN }, env): ShowAwardsResult {
      const r = readOf(env);
      const s = cache.sessions(r.db, r.campaignId).find((x) => x.fromN === fromN);
      if (!s) throw notFound("Session not found");
      const payload = awardsPayload(s, r.viewer.features);
      const notificationId = notify(env, {
        kind: STATS_AWARDS_KIND,
        audience: "all",
        text: `Session awards: ${payload.label}`,
        payload,
      });
      return { notificationId };
    },
  });

  return { query, showAwards };
}
