// session-recap boundary schemas (RECAP §9): `recap.query` / `recap.share` inputs, the per-role
// recap (FR-RECAP-08: the player schema has no field for a hidden number, name or roll) and the
// `session-recap` notification payload (FR-RECAP-23). Nothing here is a record type.
import { cleanText } from "@shared/notifications/schemas";
import {
  Award,
  DmFellEvent,
  DmHighlightStat,
  FELL_LIST_MAX,
  PlayerFellEvent,
  PlayerHighlightStat,
  StandingSide,
} from "@shared/stats/schemas";
import { z } from "zod";

export const RECAP_QUERY_INTENT = "recap.query";
export const RECAP_SHARE_INTENT = "recap.share";
/** FR-RECAP-23: the notification kind `recap.share` makes. */
export const SESSION_RECAP_KIND = "session-recap";
/** FR-RECAP-10: the window kind (both clients, instance `main`). */
export const RECAP_WINDOW_KIND = "recap.session";

/** FR-RECAP-05: computed answers per actor per second; the excess is coalesced. */
export const RECAP_QUERIES_PER_SECOND = 2;
/** FR-RECAP-12, -15: listed lines, then "+N more". */
export const RECAP_FIGHTS_MAX = 12;
export const RECAP_ROLLS_MAX = 12;
/** FR-RECAP-14: loot rows listed, then "+N more" (totals always complete). */
export const RECAP_LOOT_MAX = 60;
/** FR-RECAP-20: the share note, after cleaning. */
export const RECAP_NOTE_MAX = 280;
/** FR-RECAP-18: one ack. */
export const RECAP_ACK_MAX_BYTES = 64 * 1024;
/** FR-RECAP-23: one share row's payload. */
export const RECAP_PAYLOAD_MAX_BYTES = 2048;
/** FR-RECAP-23: the row's text, "Session recap: Tue 20 Oct". */
export const recapShareText = (label: string) => `Session recap: ${label}`;

/** FR-RECAP-11–16: the sections, in display order (`recap-section` `data-record-id`). */
export const RECAP_SECTIONS = ["header", "fights", "party", "loot", "rolls", "awards"] as const;
export type RecapSection = (typeof RECAP_SECTIONS)[number];
/** FR-RECAP-20: the sections a share may leave out (header and fights always show). */
export const OMITTABLE_SECTIONS = ["party", "loot", "rolls", "awards"] as const;
export const OmittableSection = z.enum(OMITTABLE_SECTIONS);
export type OmittableSection = z.infer<typeof OmittableSection>;

export const SECTION_TITLE: Record<RecapSection, string> = {
  header: "Session",
  fights: "Fights",
  party: "Party",
  loot: "Loot",
  rolls: "Notable rolls",
  awards: "Awards",
};

const Id = z.string().min(1).max(64);
const Name = z.string().max(120);
const Count = z.int().min(0);
const Label = z.string().max(80);
const Iso = z.string().max(40);
const Key = z.int().min(1);
/** A cleaned note: ≤ 280 code points (≤ 560 UTF-16 units). */
const NoteText = z.string().max(2 * RECAP_NOTE_MAX);

/** FR-RECAP-20: control characters removed, trimmed, then clipped to 280 (plain text). */
export const RecapNote = z
  .string()
  .max(4 * RECAP_NOTE_MAX)
  .transform((s) => [...cleanText(s)].slice(0, RECAP_NOTE_MAX).join("").trim());

/** FR-RECAP-20: each section once, in display order. */
const Omit = z
  .array(OmittableSection)
  .max(OMITTABLE_SECTIONS.length)
  .transform((xs) => OMITTABLE_SECTIONS.filter((k) => xs.includes(k)));

// ---------- inputs ----------

/** FR-RECAP-01, -02: `n` inside a session the viewer can list; absent = the newest. */
export const RecapQueryInput = z.strictObject({ n: Key.optional() });
export type RecapQueryInput = z.infer<typeof RecapQueryInput>;

/** FR-RECAP-20: `fromN` = a session key. An empty note is no note. */
export const RecapShareInput = z.strictObject({
  fromN: Key,
  note: RecapNote.optional(),
  omit: Omit.optional(),
});
export type RecapShareInput = z.input<typeof RecapShareInput>;
export const RecapShareResult = z.strictObject({ notificationId: Id });
export type RecapShareResult = z.infer<typeof RecapShareResult>;

// ---------- share (FR-RECAP-22, -23) ----------

/** The newest share of the session: its note, the sections left out, and when. */
export const RecapShared = z.strictObject({
  note: NoteText.nullable(),
  omit: z.array(OmittableSection).max(OMITTABLE_SECTIONS.length),
  at: Iso,
});
export type RecapShared = z.infer<typeof RecapShared>;

/** FR-RECAP-23: player-safe (times = what players see, as `stats-awards`'s `awardsPayload`). */
export const SessionRecapPayload = z.strictObject({
  fromN: Key,
  toN: Key,
  from: Iso,
  to: Iso,
  label: z.string().min(1).max(40),
  note: NoteText.min(1).optional(),
  omit: z.array(OmittableSection).max(OMITTABLE_SECTIONS.length),
});
export type SessionRecapPayload = z.infer<typeof SessionRecapPayload>;

// ---------- sections ----------

const fellListOf = <E extends z.ZodType>(event: E) =>
  z.strictObject({ events: z.array(event).max(FELL_LIST_MAX), more: z.int().min(1).optional() });

/**
 * FR-RECAP-12: one fight with a counted fact the viewer sees in the session. `label`: the DM's
 * encounter name, a player's "Fight N · Tue 20 Oct"; `duration` ms Start → End, null = running.
 */
const fightFields = {
  key: Id,
  label: Label,
  status: z.enum(["started", "ended"]),
  rounds: Count,
  duration: Count.nullable(),
};
export const PlayerRecapFight = z.strictObject({
  ...fightFields,
  mvp: PlayerHighlightStat,
  kills: fellListOf(PlayerFellEvent),
  downed: fellListOf(PlayerFellEvent),
});
export type PlayerRecapFight = z.infer<typeof PlayerRecapFight>;
/** FR-RECAP-09: + hidden marks and overkill amounts on the lists, Still standing. */
export const DmRecapFight = z.strictObject({
  ...fightFields,
  mvp: DmHighlightStat,
  kills: fellListOf(DmFellEvent),
  downed: fellListOf(DmFellEvent),
  standing: z.array(StandingSide).max(70),
});
export type DmRecapFight = z.infer<typeof DmRecapFight>;

/** FR-RECAP-13: a party character's session tally (companions rolled into the owner). */
export const RecapPartyRow = z.strictObject({
  characterId: Id,
  name: Name,
  playerId: Id.nullable(),
  dealt: Count,
  kills: Count,
  downed: Count,
  healed: Count,
  nat20: Count,
  nat1: Count,
  /** FR-STATS-38: mean d20 face, 1 decimal; null = none. */
  avg: z.number().min(1).max(20).nullable(),
});
export type RecapPartyRow = z.infer<typeof RecapPartyRow>;

const Coin = z.int();
export const RecapCoins = z.strictObject({ cp: Coin, sp: Coin, ep: Coin, gp: Coin, pp: Coin });
export type RecapCoins = z.infer<typeof RecapCoins>;

/** The party side of a loot row: the pot, or one character. */
export const RecapHolder = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("party") }),
  z.strictObject({ kind: z.literal("character"), characterId: Id, name: Name }),
]);
export type RecapHolder = z.infer<typeof RecapHolder>;

/**
 * FR-RECAP-14: one `world ↔ party / character` ledger row. Coins signed from the party's side
 * (+ gained, − spent); item rows: `qty` + found, − removed, coins 0. Same for every viewer.
 */
export const RecapLootRow = z.strictObject({
  id: Id,
  kind: z.enum(["coins", "item"]),
  holder: RecapHolder,
  text: z.string().max(200),
  coins: RecapCoins,
  qty: z.int().optional(),
});
export type RecapLootRow = z.infer<typeof RecapLootRow>;

export const RecapLoot = z.strictObject({
  rows: z.array(RecapLootRow).max(RECAP_LOOT_MAX),
  more: z.int().min(1).optional(),
  /** Net per coin and per item name, over every row (not just those listed). */
  totals: z.strictObject({
    coins: RecapCoins,
    items: z.array(z.strictObject({ name: z.string().max(200), qty: z.int() })).max(2000),
  }),
});
export type RecapLoot = z.infer<typeof RecapLoot>;

/** FR-RECAP-15: a counted natural 20 or 1, "Mira · nat 20 · ‹roll label›". */
const rollFields = {
  /** The listing entry's id (`recap-roll` `data-record-id`). */
  id: Id,
  name: Name,
  natural: z.union([z.literal(20), z.literal(1)]),
  label: z.string().max(120),
};
export const PlayerRecapRoll = z.strictObject(rollFields);
export type PlayerRecapRoll = z.infer<typeof PlayerRecapRoll>;
/** FR-RECAP-09: + hidden rolls (marked) and DM dice. */
export const DmRecapRoll = z.strictObject({ ...rollFields, hidden: z.boolean() });
export type DmRecapRoll = z.infer<typeof DmRecapRoll>;
const rollsOf = <R extends z.ZodType>(roll: R) =>
  z.strictObject({ rows: z.array(roll).max(RECAP_ROLLS_MAX), more: z.int().min(1).optional() });

// ---------- the recap ----------

const headerFields = {
  /** The session key and the unclipped last `n`. */
  fromN: Key,
  toN: Key,
  /** The viewer's clipped span (FR-STATS-13) and its date label ("Tue 20 Oct"). */
  from: Iso,
  to: Iso,
  label: z.string().min(1).max(40),
  fightsMore: z.int().min(1).optional(),
  shared: RecapShared.nullable(),
};

/**
 * FR-RECAP-08: a player's recap: party only, public facts, neutral fight labels. Sections the
 * newest share left out (FR-RECAP-22) are absent.
 */
export const PlayerRecap = z.strictObject({
  ...headerFields,
  fights: z.array(PlayerRecapFight).max(RECAP_FIGHTS_MAX),
  party: z.array(RecapPartyRow).max(70).optional(),
  loot: RecapLoot.optional(),
  rolls: rollsOf(PlayerRecapRoll).optional(),
  awards: z.array(Award).max(9).optional(),
});
export type PlayerRecap = z.infer<typeof PlayerRecap>;

/** The DM's: every section, always (omitted ones are marked by `shared.omit`). */
export const DmRecap = z.strictObject({
  ...headerFields,
  fights: z.array(DmRecapFight).max(RECAP_FIGHTS_MAX),
  party: z.array(RecapPartyRow).max(70),
  loot: RecapLoot,
  rolls: rollsOf(DmRecapRoll),
  awards: z.array(Award).max(9),
});
export type DmRecap = z.infer<typeof DmRecap>;

/** `recap` null = no session the viewer can list yet (FR-RECAP-17). */
export const PlayerRecapResult = z.strictObject({ recap: PlayerRecap.nullable() });
export const DmRecapResult = z.strictObject({ recap: DmRecap.nullable() });
export type PlayerRecapResult = z.infer<typeof PlayerRecapResult>;
export type DmRecapResult = z.infer<typeof DmRecapResult>;
