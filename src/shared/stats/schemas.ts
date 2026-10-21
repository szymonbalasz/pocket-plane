// stats boundary schemas (STATS §9, ADR-0059): `stats.query` / `stats.showAwards` inputs, the
// per-role results (FR-STATS-05: the player schemas have no field for a hidden number) and the
// `stats-awards` notification payload (FR-NOTE-48). Nothing here is a record type.
import { z } from "zod";

export const STATS_QUERY_INTENT = "stats.query";
export const STATS_SHOW_AWARDS_INTENT = "stats.showAwards";
/** FR-NOTE-48: the notification kind `stats.showAwards` makes. */
export const STATS_AWARDS_KIND = "stats-awards";

/** FR-STATS-13: a ≥ 6 h gap between log entries starts a new session. */
export const SESSION_GAP_MS = 6 * 60 * 60 * 1000;

/** FR-STATS-25 limits. */
export const FIGHT_ROWS_MAX = 70;
export const TIED_MAX = 8;
export const SESSIONS_MAX = 200;
export const ACK_MAX_BYTES = 64 * 1024;
/** The fight picker's list (FR-STATS-18), newest first. */
export const FIGHTS_MAX = 50;
/** FR-STATS-16: computed answers per connection (actor) per second; the excess is coalesced. */
export const QUERIES_PER_SECOND = 4;

/** FR-STATS-18: the special rows (DM only). */
export const DM_DIRECT_KEY = "dm-direct";
export const UNATTRIBUTED_KEY = "unattributed";
export const DM_DIRECT_NAME = "DM (direct)";
export const UNATTRIBUTED_NAME = "Unattributed";

/** FR-STATS-12: the 9 session awards, in card order. */
export const AWARD_KEYS = [
  "biggest-hit",
  "biggest-overkill",
  "most-dealt",
  "most-taken",
  "most-healing",
  "most-kills",
  "most-nat20",
  "most-nat1",
  "most-downed",
] as const;
export const AwardKey = z.enum(AWARD_KEYS);
export type AwardKey = z.infer<typeof AwardKey>;

export const AWARD_TITLE: Record<AwardKey, string> = {
  "biggest-hit": "Biggest hit",
  "biggest-overkill": "Biggest overkill",
  "most-dealt": "Most damage dealt",
  "most-taken": "Most damage taken",
  "most-healing": "Most healing",
  "most-kills": "Most kills",
  "most-nat20": "Most nat 20s",
  "most-nat1": "Most nat 1s",
  "most-downed": "Most times downed",
};

const Id = z.string().min(1).max(64);
const Name = z.string().max(120);
const Count = z.int().min(0);
const Label = z.string().max(80);
const Iso = z.string().max(40);

// ---------- inputs ----------

/** FR-STATS-16, STATS §9: one read-only query per scope. */
export const StatsQueryInput = z.discriminatedUnion("scope", [
  z.strictObject({ scope: z.literal("fight"), encounterId: Id.optional() }),
  z.strictObject({ scope: z.literal("session"), n: z.int().min(1).optional() }),
  z.strictObject({ scope: z.literal("sessions") }),
]);
export type StatsQueryInput = z.infer<typeof StatsQueryInput>;

/** FR-STATS-20: `fromN` = a session key (the unclipped first `n`). */
export const ShowAwardsInput = z.strictObject({ fromN: z.int().min(1) });
export type ShowAwardsInput = z.infer<typeof ShowAwardsInput>;
export const ShowAwardsResult = z.strictObject({ notificationId: Id });
export type ShowAwardsResult = z.infer<typeof ShowAwardsResult>;

// ---------- fight (FR-STATS-15, -18) ----------

const FightStatus = z.enum(["started", "ended"]);

/**
 * One picker entry. `key` = the encounter id: a player's list holds only fights with a public
 * fact, whose public lines already carry that id (FR-STATS-17's refresh filter needs it).
 * `label`: the DM's encounter name; a player's "Fight N · Tue 20 Oct" (OQ-STATS-19 A).
 */
export const FightSummary = z.strictObject({ key: Id, label: Label, status: FightStatus });
export type FightSummary = z.infer<typeof FightSummary>;

const RowCounts = {
  key: Id,
  name: Name,
  /** A companion's row sits under its current owner's (FR-STATS-09); the owner's row key. */
  ownerKey: Id.optional(),
  dealt: Count,
  taken: Count,
  healed: Count,
  kills: Count,
};

/** FR-STATS-05: a player's row: party only, log numbers only. */
export const PlayerFightRow = z.strictObject({
  ...RowCounts,
  kind: z.enum(["pc", "companion"]),
});
export type PlayerFightRow = z.infer<typeof PlayerFightRow>;

/** The DM's row: + monsters and special rows, hidden flag, downs and Effective (OQ-STATS-06 A). */
export const DmFightRow = z.strictObject({
  ...RowCounts,
  kind: z.enum(["pc", "companion", "monster", "special"]),
  hidden: z.boolean(),
  downs: Count,
  effective: z.strictObject({ dealt: Count, taken: Count, healed: Count }),
});
export type DmFightRow = z.infer<typeof DmFightRow>;

const fightOf = <R extends z.ZodType>(row: R) =>
  z.strictObject({
    key: Id,
    label: Label,
    round: Count,
    status: FightStatus,
    rows: z.array(row).max(FIGHT_ROWS_MAX),
  });

/** `fight` null = no fight yet (FR-STATS-24); `fights` = the picker, newest first. */
const fightResultOf = <R extends z.ZodType>(row: R) =>
  z.strictObject({
    fight: fightOf(row).nullable(),
    fights: z.array(FightSummary).max(FIGHTS_MAX),
  });
export const PlayerFightResult = fightResultOf(PlayerFightRow);
export const DmFightResult = fightResultOf(DmFightRow);
export type PlayerFightResult = z.infer<typeof PlayerFightResult>;
export type DmFightResult = z.infer<typeof DmFightResult>;

// ---------- sessions (FR-STATS-13, -19) ----------

/**
 * A session for one viewer: `fromN` / `toN` the unclipped keys (same for every viewer); `from` /
 * `to` the viewer's first / last visible entry (players: public only); `fights` the viewer's.
 */
export const SessionSummary = z.strictObject({
  fromN: z.int().min(1),
  toN: z.int().min(1),
  from: Iso,
  to: Iso,
  fights: Count,
});
export type SessionSummary = z.infer<typeof SessionSummary>;

/** A winner: a party character (companions roll into the current owner, `with` their names). */
export const AwardWinner = z.strictObject({
  characterId: Id,
  name: Name,
  /** The owning player (the client's player colour); null = the DM's character. */
  playerId: Id.nullable(),
  with: z.array(Name).min(1).max(8).optional(),
});
export type AwardWinner = z.infer<typeof AwardWinner>;

/** "Thorn → Goblin 1, 30, ‹fight label›": the line behind a biggest-* award (`raw` = its number). */
export const AwardDetail = z.strictObject({ from: Name, to: Name, raw: Count, fight: Label });
export type AwardDetail = z.infer<typeof AwardDetail>;

/**
 * FR-STATS-12. `value` = the sum / count / max raw; Biggest overkill: the DM's the overkill amount,
 * a player's the callout line's `raw` (the same number as `detail.raw`: no `raw − value`). Null +
 * no winners = nobody scored. Ties: every winner up to 8, `more` = the rest.
 */
export const Award = z.strictObject({
  key: AwardKey,
  value: Count.nullable(),
  winners: z.array(AwardWinner).max(TIED_MAX),
  more: z.int().min(1).optional(),
  detail: AwardDetail.optional(),
});
export type Award = z.infer<typeof Award>;

export const SessionAwards = SessionSummary.extend({
  awards: z.array(Award).length(AWARD_KEYS.length),
});
export type SessionAwards = z.infer<typeof SessionAwards>;

/** `session` null = no session the viewer can list yet (FR-STATS-24). */
export const SessionResult = z.strictObject({ session: SessionAwards.nullable() });
export type SessionResult = z.infer<typeof SessionResult>;
export const SessionsResult = z.strictObject({
  sessions: z.array(SessionSummary).max(SESSIONS_MAX),
});
export type SessionsResult = z.infer<typeof SessionsResult>;

export const PlayerStatsResult = z.union([PlayerFightResult, SessionResult, SessionsResult]);
export const DmStatsResult = z.union([DmFightResult, SessionResult, SessionsResult]);
export type PlayerStatsResult = z.infer<typeof PlayerStatsResult>;
export type DmStatsResult = z.infer<typeof DmStatsResult>;

// ---------- notification (FR-NOTE-48) ----------

/** Player-safe: the session key, the times players see, and a date label ("Tue 20 Oct"). */
export const StatsAwardsPayload = z.strictObject({
  fromN: z.int().min(1),
  toN: z.int().min(1),
  from: Iso,
  to: Iso,
  label: z.string().min(1).max(40),
});
export type StatsAwardsPayload = z.infer<typeof StatsAwardsPayload>;
