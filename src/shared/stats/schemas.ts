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
  // Sprint 8 (FR-STATS-45): one session's luck (`n` inside it; absent = the newest) or the campaign's.
  z.strictObject({
    scope: z.literal("luck"),
    n: z.int().min(1).optional(),
    campaign: z.literal(true).optional(),
  }),
  z.strictObject({ scope: z.literal("trophies"), characterId: Id }),
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

// ---------- highlights (sprint 8, FR-STATS-31–36) ----------

/** FR-STATS-36: the Highlights items' `data-record-id`s, in display order. */
export const HIGHLIGHT_KEYS = [
  "mvp",
  "biggest-hit",
  "biggest-overkill",
  "most-healing",
  "kills",
  // Not "downs": that key is the DM fight row's (the leak scans look for it).
  "downed",
  "nat20",
  "nat1",
  "rounds",
  "duration",
  "standing",
] as const;
export type HighlightKey = (typeof HIGHLIGHT_KEYS)[number];
/** FR-STATS-48: kills / downs listed, then "+N". */
export const FELL_LIST_MAX = 20;

const winnerFields = {
  /** A party character's id (companions roll into the current owner); a DM's monster: its combatant id. */
  key: Id,
  name: Name,
  /** The owning player (colour); null = the DM's (a monster, a DM character). */
  playerId: Id.nullable(),
  /** Companion names whose facts counted ("Mira + Owlbear"). */
  with: z.array(Name).min(1).max(8).optional(),
};
export const PlayerHighlightWinner = z.strictObject(winnerFields);
/** The DM's winners may be monsters; `hidden` = a hidden side (the eye-off mark). */
export const DmHighlightWinner = z.strictObject({ ...winnerFields, hidden: z.boolean() });

/** The line behind a biggest-* item ("Thorn → Goblin 1, 30"). */
export const HighlightDetail = z.strictObject({ from: Name, to: Name, raw: Count });

const statOf = <W extends z.ZodType>(winner: W) =>
  z.strictObject({
    /** Sum / count / max; null + no winners = nobody scored (the item is hidden). */
    value: Count.nullable(),
    winners: z.array(winner).max(TIED_MAX),
    more: z.int().min(1).optional(),
    detail: HighlightDetail.optional(),
  });
export const PlayerHighlightStat = statOf(PlayerHighlightWinner);
export const DmHighlightStat = statOf(DmHighlightWinner);
export type PlayerHighlightStat = z.infer<typeof PlayerHighlightStat>;
export type DmHighlightStat = z.infer<typeof DmHighlightStat>;

const fellFields = {
  fell: z.enum(["kill", "down"]),
  /** The attacker's fact name; null = the DM's direct damage ("Goblin 1 falls"). */
  from: Name.nullable(),
  to: Name,
  /** The line has the overkill callout ("Overkill! …"). */
  callout: z.boolean(),
};
/** FR-STATS-31: one kill / down in log order, as the feed words it (FR-STATS-27). */
export const PlayerFellEvent = z.strictObject(fellFields);
export type PlayerFellEvent = z.infer<typeof PlayerFellEvent>;
/** The DM's: + `hidden` (players never saw the line) and a callout's overkill amount. */
export const DmFellEvent = z.strictObject({
  ...fellFields,
  hidden: z.boolean(),
  overkill: Count.optional(),
});
export type DmFellEvent = z.infer<typeof DmFellEvent>;
const fellListOf = <E extends z.ZodType>(event: E) =>
  z.strictObject({
    events: z.array(event).max(FELL_LIST_MAX),
    more: z.int().min(1).optional(),
  });

const highlightFields = <S extends z.ZodType, E extends z.ZodType>(stat: S, event: E) => ({
  mvp: stat,
  "biggest-hit": stat,
  "biggest-overkill": stat,
  "most-healing": stat,
  kills: fellListOf(event),
  downed: fellListOf(event),
  nat20: stat,
  nat1: stat,
  rounds: Count,
  /** ms from Start to End (to now while started). */
  duration: Count,
});

/**
 * FR-STATS-31, -35, -47: a player's Highlights: party only, public facts, no hidden mark, no
 * Still standing, no overkill amount (Biggest overkill = the callout line's `raw`).
 */
export const PlayerHighlights = z.strictObject(
  highlightFields(PlayerHighlightStat, PlayerFellEvent),
);
export type PlayerHighlights = z.infer<typeof PlayerHighlights>;

/** FR-STATS-31: the DM's monsters still standing at End (or now). */
export const StandingSide = z.strictObject({ key: Id, name: Name, hidden: z.boolean() });
export const DmHighlights = z.strictObject({
  ...highlightFields(DmHighlightStat, DmFellEvent),
  standing: z.array(StandingSide).max(FIGHT_ROWS_MAX),
});
export type DmHighlights = z.infer<typeof DmHighlights>;

const fightOf = <R extends z.ZodType, H extends z.ZodType>(row: R, highlights: H) =>
  z.strictObject({
    key: Id,
    label: Label,
    round: Count,
    status: FightStatus,
    rows: z.array(row).max(FIGHT_ROWS_MAX),
    /** Sprint 8 (FR-STATS-31): always sent by the server; optional so tier-A acks still parse. */
    highlights: highlights.optional(),
  });

/** `fight` null = no fight yet (FR-STATS-24); `fights` = the picker, newest first. */
const fightResultOf = <R extends z.ZodType, H extends z.ZodType>(row: R, highlights: H) =>
  z.strictObject({
    fight: fightOf(row, highlights).nullable(),
    fights: z.array(FightSummary).max(FIGHTS_MAX),
  });
export const PlayerFightResult = fightResultOf(PlayerFightRow, PlayerHighlights);
export const DmFightResult = fightResultOf(DmFightRow, DmHighlights);
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

// ---------- luck (sprint 8, FR-STATS-37–41) ----------

export const LUCK_ROWS_MAX = 70;
/** FR-STATS-39: the DM's row of DM, monster and token d20s (hidden included). */
export const DM_DICE_KEY = "dm-dice";
export const DM_DICE_NAME = "DM dice";

const luckRowFields = {
  /** A party character's id; the DM's extra row `dm-dice`. */
  key: Id,
  name: Name,
  playerId: Id.nullable(),
  rolls: Count,
  /** Every d20 face with a value, kept and dropped (OQ-STATS-26 A). */
  d20s: Count,
  /** Mean of the faces, 1 decimal; null = none ("—"). */
  avg: z.number().min(1).max(20).nullable(),
  nat20: Count,
  nat1: Count,
};
export const DmLuckRow = z.strictObject(luckRowFields);
export type DmLuckRow = z.infer<typeof DmLuckRow>;
/** FR-STATS-47: no `dm-dice` for players. */
export const PlayerLuckRow = DmLuckRow.refine((r) => r.key !== DM_DICE_KEY, "DM-only row");

/**
 * `pending` (FR-STATS-46): campaign partials are still building; the client shows a skeleton and
 * re-queries in 1 s (`rows` empty). `fromN` = the session key (scope `session`); absent with no
 * session yet.
 */
const luckResultOf = <R extends z.ZodType>(row: R) =>
  z.strictObject({
    luck: z.strictObject({
      scope: z.enum(["session", "campaign"]),
      fromN: z.int().min(1).optional(),
      pending: z.literal(true).optional(),
      rows: z.array(row).max(LUCK_ROWS_MAX),
    }),
  });
export const DmLuckResult = luckResultOf(DmLuckRow);
export const PlayerLuckResult = luckResultOf(PlayerLuckRow);
export type DmLuckResult = z.infer<typeof DmLuckResult>;
export type PlayerLuckResult = z.infer<typeof PlayerLuckResult>;

// ---------- trophies (sprint 8, FR-STATS-42–44) ----------

/** FR-STATS-42 Lifetime (campaign-wide; 0 = "—" in the UI). */
export const TrophyLifetime = z.strictObject({
  avgD20: z.number().min(1).max(20).nullable(),
  nat20: Count,
  nat1: Count,
  fights: Count,
  dealt: Count,
  taken: Count,
  healing: Count,
  kills: Count,
  downed: Count,
});
export type TrophyLifetime = z.infer<typeof TrophyLifetime>;

/**
 * One record: `value` (Biggest overkill per role, FR-STATS-12: a player's is the callout line's
 * `raw`), the target of a hit, the viewer's fight label. Null = none yet.
 */
export const TrophyRecord = z
  .strictObject({ value: Count, to: Name.optional(), fight: Label })
  .nullable();
export type TrophyRecord = z.infer<typeof TrophyRecord>;
export const TrophyRecords = z.strictObject({
  "biggest-hit": TrophyRecord,
  "biggest-overkill": TrophyRecord,
  "best-fight-damage": TrophyRecord,
  "best-fight-kills": TrophyRecord,
});
export type TrophyRecords = z.infer<typeof TrophyRecords>;

/** `pending`: as luck's (no `lifetime` / `records` then). */
export const TrophiesResult = z.strictObject({
  trophies: z.strictObject({
    characterId: Id,
    pending: z.literal(true).optional(),
    lifetime: TrophyLifetime.optional(),
    records: TrophyRecords.optional(),
  }),
});
export type TrophiesResult = z.infer<typeof TrophiesResult>;

export const PlayerStatsResult = z.union([
  PlayerFightResult,
  SessionResult,
  SessionsResult,
  PlayerLuckResult,
  TrophiesResult,
]);
export const DmStatsResult = z.union([
  DmFightResult,
  SessionResult,
  SessionsResult,
  DmLuckResult,
  TrophiesResult,
]);
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

// ---------- fight summary notification (sprint 8, FR-NOTE-68) ----------

/** FR-NOTE-68: the kind stats' `ended` rule hook makes at End (FR-STATS-33). Toast class info. */
export const STATS_FIGHT_SUMMARY_KIND = "stats-fight-summary";
/** FR-NOTE-68: the row's text (no encounter name, no numbers). */
export const FIGHT_SUMMARY_TEXT = "Fight summary";

/** Player-safe: the encounter id is already on public lines (#327). */
export const StatsFightSummaryPayload = z.strictObject({ encounterId: Id });
export type StatsFightSummaryPayload = z.infer<typeof StatsFightSummaryPayload>;
