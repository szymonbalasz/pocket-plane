// DM secret check + throttle + player link resolver (FR-CAMP-03/04/05/17/18, ADR-0019).
import { createHash, timingSafeEqual } from "node:crypto";
import { LinkToken } from "@shared/campaign-management/schemas";
import { eq } from "drizzle-orm";
import type { Clock } from "../../commands/context";
import type { Db } from "../../db/client";
import { campaign, player } from "../../db/schema";
import type { CredentialResolvers } from "../../services";
import { activeCampaign } from "./commands";

export const THROTTLE_MAX_FAILURES = 5;
export const THROTTLE_WINDOW_MS = 60_000;
export const THROTTLE_LOCK_MS = 60_000;

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();

/** Server-wide, in memory, cleared on restart (OQ-CAMP-12 pick). */
export class DmSecretChecker {
  private readonly expected: Buffer;
  private failures: number[] = [];
  private lockedUntil = 0;

  constructor(
    secret: string,
    private readonly clock: Clock,
  ) {
    this.expected = digest(secret);
  }

  check(presented: string): "ok" | "invalid" | "throttled" {
    const now = this.clock.now();
    if (now < this.lockedUntil) return "throttled";
    if (timingSafeEqual(digest(presented), this.expected)) return "ok";
    this.failures = this.failures.filter((t) => now - t < THROTTLE_WINDOW_MS);
    this.failures.push(now);
    if (this.failures.length >= THROTTLE_MAX_FAILURES) {
      this.lockedUntil = now + THROTTLE_LOCK_MS;
      this.failures = [];
    }
    return "invalid";
  }
}

export interface PlayerLink {
  campaignId: string;
  playerId: string;
  campaignActive: boolean;
  playerName: string;
  campaignName: string;
}

export function lookupPlayerLink(db: Db, token: string): PlayerLink | null {
  if (!LinkToken.safeParse(token).success) return null;
  const row = db
    .select({
      playerId: player.id,
      playerName: player.name,
      campaignId: campaign.id,
      campaignName: campaign.name,
      campaignActive: campaign.active,
    })
    .from(player)
    .innerJoin(campaign, eq(player.campaignId, campaign.id))
    .where(eq(player.linkToken, token))
    .get();
  return row ?? null;
}

export function createResolvers(db: Db, checker: DmSecretChecker): CredentialResolvers {
  return {
    checkDmSecret: (v) => checker.check(v),
    verifyDmCredential(v) {
      const r = checker.check(v);
      if (r !== "ok") return r;
      const active = activeCampaign(db);
      return active ? { campaignId: active.id } : "noActiveCampaign";
    },
    resolvePlayerLink(token) {
      const l = lookupPlayerLink(db, token);
      return l
        ? { campaignId: l.campaignId, playerId: l.playerId, campaignActive: l.campaignActive }
        : null;
    },
  };
}
