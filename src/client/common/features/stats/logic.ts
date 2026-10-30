// Stats window client logic (STATS §7, FR-STATS-17–25, -34, -41, -52, -85), pure: which live frames
// re-query, the live awards and fight-summary opens (FR-SHELL-94, FR-STATS-34), picker labels. The
// kill feed (FR-STATS-28) is `./feed`. The numbers are always the server's (`stats.query`'s ack):
// nothing here aggregates a fact.
import { ENCOUNTER_TYPE } from "@shared/combat-tracker/schemas";
import { GAME_LOG_ENTRY_TYPE, type GameLogEntryView } from "@shared/dice-roll-log/schemas";
import { LogEntryHiddenSet } from "@shared/events/dice-roll-log";
import { NotificationCreated } from "@shared/events/notifications";
import type { NotificationRecord } from "@shared/notifications/schemas";
import type { EventFrame } from "@shared/protocol/frames";
import { dayLabel } from "@shared/stats/rules";
import {
  AWARD_TITLE,
  type Award,
  type AwardKey,
  type CampaignAwardsRow,
  type CampaignRecord,
  type CampaignRecordKey,
  type DmFellEvent,
  type DmFightRow,
  type DmHighlightStat,
  type DmHighlights,
  type HighlightKey,
  type PlayerFellEvent,
  type PlayerFightRow,
  type PlayerHighlightStat,
  type PlayerHighlights,
  type SessionSummary,
  STATS_AWARDS_KIND,
  STATS_FIGHT_SUMMARY_KIND,
  StatsAwardsPayload,
  StatsFightSummaryPayload,
} from "@shared/stats/schemas";
import { NOTIFICATION_TYPE } from "../notifications/logic";

export const STATS_WINDOW_KIND = "stats.board";
/** FR-STATS-85 (sprint 10 T3): Campaign first, and the tab a user open lands on. */
export const STATS_TABS = ["campaign", "fight", "session", "luck"] as const;
export type StatsTab = (typeof STATS_TABS)[number];
export const DEFAULT_TAB: StatsTab = "campaign";

/** FR-STATS-17: trailing re-query delay after a live log upsert. */
export const REFRESH_MS = 1000;
/** FR-STATS-46: a `pending` campaign answer is asked again this much later. */
export const PENDING_RETRY_MS = 1000;

type Frame = Pick<EventFrame, "cause" | "changes">;

export const logUpserts = (frame: Frame) =>
  frame.changes
    .filter((c) => c.type === GAME_LOG_ENTRY_TYPE && c.op === "upsert" && c.data)
    .map((c) => c.data as GameLogEntryView);

/**
 * FR-STATS-17: does this live frame re-query? Fight tab: a log upsert in the shown fight; with no
 * fight picked, any fight's (the default may move to a fight just started); FR-STATS-52 (BL-69):
 * also an `encounter` change (a Start reaches players before any public fact; rounds tick).
 * Session and Campaign (FR-STATS-87) tabs: any log upsert. Luck tab (FR-STATS-41): a log upsert
 * holding a roll.
 */
export function refreshes(
  frame: Frame,
  view: { tab: StatsTab; pickedFight: string | null },
): boolean {
  // FR-DICE-102: a hidden line reaches players as a delete, so no upsert would say so.
  if (frame.cause.name === LogEntryHiddenSet.type) return true;
  const entries = logUpserts(frame);
  if (view.tab === "session" || view.tab === "campaign") return entries.length > 0;
  if (view.tab === "luck") return entries.some((e) => e.rollIds.length > 0);
  if (
    frame.changes.some(
      (c) => c.type === ENCOUNTER_TYPE && (view.pickedFight === null || c.id === view.pickedFight),
    )
  ) {
    return true;
  }
  return entries.some((e) =>
    view.pickedFight === null ? e.encounterId !== null : e.encounterId === view.pickedFight,
  );
}

/** The new notification rows of `kind` a live `NotificationCreated` frame holds. */
function created(frame: Frame, kind: string): NotificationRecord[] {
  if (frame.cause.name !== NotificationCreated.type) return [];
  return frame.changes
    .filter((c) => c.type === NOTIFICATION_TYPE && c.op === "upsert")
    .map((c) => c.data as NotificationRecord | undefined)
    .filter((n): n is NotificationRecord => n?.kind === kind);
}

/** FR-SHELL-94: the session a live frame's new `stats-awards` notification shows; else null. */
export function awardsOpenOf(
  frame: Frame,
): (StatsAwardsPayload & { notificationId: string }) | null {
  for (const n of created(frame, STATS_AWARDS_KIND)) {
    const p = StatsAwardsPayload.safeParse(n.payload);
    if (p.success) return { ...p.data, notificationId: n.id };
  }
  return null;
}

/** FR-STATS-34: the fight a live frame's new `stats-fight-summary` notification opens; else null. */
export function summaryOpenOf(
  frame: Frame,
): (StatsFightSummaryPayload & { notificationId: string }) | null {
  for (const n of created(frame, STATS_FIGHT_SUMMARY_KIND)) {
    const p = StatsFightSummaryPayload.safeParse(n.payload);
    if (p.success) return { ...p.data, notificationId: n.id };
  }
  return null;
}

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/** FR-STATS-19: "Tue 20 Oct · 19:02–23:41 · 3 fights" (local time; "Today" for today's). */
export function sessionLabel(s: SessionSummary, now: Date = new Date()): string {
  const day = sameDay(new Date(s.from), now) ? "Today" : dayLabel(s.from);
  const fights = `${s.fights} fight${s.fights === 1 ? "" : "s"}`;
  return `${day} · ${hhmm(s.from)}–${hhmm(s.to)} · ${fights}`;
}

/**
 * FR-STATS-24, -70 (BL-90): "No damage yet this fight": every row's numbers are 0 **and** the
 * viewer's Highlights hold no event (a kill, a down, a callout). A player's fight whose damage was
 * the DM's own or on hidden sides has all-zero rows; its kill in Highlights carries the fight.
 */
export const noDamageYet = (
  rows: readonly (PlayerFightRow | DmFightRow)[],
  highlights?: Pick<PlayerHighlights, "kills" | "downed" | "biggest-overkill">,
) =>
  rows.every((r) => r.dealt === 0 && r.taken === 0 && r.healed === 0 && r.kills === 0) &&
  !(highlights && highlightEvents(highlights));

/** FR-STATS-70: Highlights hold an event: a kill, a down or a callout (Biggest overkill). */
const highlightEvents = (h: Pick<PlayerHighlights, "kills" | "downed" | "biggest-overkill">) =>
  h.kills.events.length > 0 || h.downed.events.length > 0 || h["biggest-overkill"].value !== null;

/** FR-STATS-12 detail line: "Thorn → Goblin 1, 30, ‹fight label›". */
export const awardDetailText = (a: Award) =>
  a.detail ? `${a.detail.from} → ${a.detail.to}, ${a.detail.raw}, ${a.detail.fight}` : null;

/** Winner names as shown: "Mira + Owlbear" when a companion rolled in (FR-STATS-09). */
export const winnerText = (w: Award["winners"][number]) =>
  w.with ? [w.name, ...w.with].join(" + ") : w.name;

/** Award units (the card's value suffix). */
const UNIT: Record<AwardKey, string> = {
  "biggest-hit": "damage",
  "biggest-overkill": "",
  "most-dealt": "damage",
  "most-taken": "damage",
  "most-healing": "HP",
  "most-kills": "",
  "most-nat20": "",
  "most-nat1": "",
  "most-downed": "",
};
/**
 * Sprint 10 (BL-103): a player's Biggest overkill is the callout line's damage (FR-STATS-12, -22:
 * players never get an overkill amount), so it reads "30 damage", never a bare "30" beside the
 * DM's "17"; the DM's stays the overkill amount.
 */
const unitOf = (key: AwardKey | HighlightKey | CampaignRecordKey, role: "dm" | "player") =>
  key === "biggest-overkill" && role === "player" ? "damage" : null;

export const awardValueText = (a: Award, role: "dm" | "player") => {
  const unit = unitOf(a.key, role) ?? UNIT[a.key];
  return a.value === null ? "—" : unit ? `${a.value} ${unit}` : String(a.value);
};

// ---------- Highlights (FR-STATS-31, -36) ----------

export const HIGHLIGHT_TITLE: Record<HighlightKey, string> = {
  mvp: "MVP",
  "biggest-hit": "Biggest hit",
  "biggest-overkill": "Biggest overkill",
  "most-healing": "Most healing",
  kills: "Kills",
  downed: "Downs",
  nat20: "Nat 20s",
  nat1: "Nat 1s",
  rounds: "Rounds",
  duration: "Duration",
  standing: "Still standing",
};

type Stat = PlayerHighlightStat | DmHighlightStat;
type FellList = { events: readonly (PlayerFellEvent | DmFellEvent)[]; more?: number | undefined };

export type HighlightItem =
  | { key: HighlightKey; kind: "stat"; stat: Stat; value: string }
  | { key: HighlightKey; kind: "fell"; list: FellList }
  | { key: HighlightKey; kind: "text"; text: string }
  | { key: "standing"; kind: "standing"; sides: DmHighlights["standing"] };

const STAT_UNIT: Partial<Record<HighlightKey, string>> = {
  mvp: "damage",
  "biggest-hit": "damage",
  "most-healing": "HP",
};

/** FR-STATS-31: "Duration": "<1 min", "12 min", "1 h 5 min". */
export function durationText(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "<1 min";
  const h = Math.floor(min / 60);
  return h > 0 ? `${h} h ${min % 60} min` : `${min} min`;
}

/**
 * FR-STATS-36: the Highlights items in FR-STATS-31's order, from the ack as sent; an empty one
 * (nobody scored, no kill, 0 rounds, nobody standing) is left out. The DM's ack alone holds
 * Still standing (FR-STATS-47).
 */
export function highlightItems(h: PlayerHighlights | DmHighlights): HighlightItem[] {
  const out: HighlightItem[] = [];
  const stat = (
    key: "mvp" | "biggest-hit" | "biggest-overkill" | "most-healing" | "nat20" | "nat1",
  ) => {
    const s = h[key];
    if (s.value === null || s.winners.length === 0) return;
    const unit = unitOf(key, "standing" in h ? "dm" : "player") ?? STAT_UNIT[key];
    out.push({ key, kind: "stat", stat: s, value: unit ? `${s.value} ${unit}` : String(s.value) });
  };
  const fell = (key: "kills" | "downed") => {
    if (h[key].events.length > 0) out.push({ key, kind: "fell", list: h[key] });
  };
  stat("mvp");
  stat("biggest-hit");
  stat("biggest-overkill");
  stat("most-healing");
  fell("kills");
  fell("downed");
  stat("nat20");
  stat("nat1");
  if (h.rounds > 0) out.push({ key: "rounds", kind: "text", text: String(h.rounds) });
  if (h.duration > 0) out.push({ key: "duration", kind: "text", text: durationText(h.duration) });
  if ("standing" in h && h.standing.length > 0) {
    out.push({ key: "standing", kind: "standing", sides: h.standing });
  }
  return out;
}

/** A biggest-* item's line: "Thorn → Goblin 1, 30". */
export const highlightDetailText = (s: Stat) =>
  s.detail ? `${s.detail.from} → ${s.detail.to}, ${s.detail.raw}` : null;

/** FR-STATS-36: Highlights start open on an ended fight, closed on a started one. */
export const highlightsOpenByDefault = (status: "started" | "ended") => status === "ended";

// ---------- Luck (FR-STATS-38, -41) ----------

/** "Avg": 1 decimal, "—" with no d20. */
export const avgText = (avg: number | null) => (avg === null ? "—" : avg.toFixed(1));

// ---------- Campaign (FR-STATS-81–85) ----------

/**
 * FR-STATS-85: a user open lands on Campaign, so the window's close (not a minimise or put-away)
 * sends the tab back to it; a feature open (End, Show awards) sets its own tab before opening.
 * True when the window went from shown or minimised to closed / gone.
 */
export const closedNow = (prev: string | undefined, next: string | undefined) =>
  (prev === "open" || prev === "minimised") && next !== "open" && next !== "minimised";

/** FR-STATS-81: "2 sessions · 5 fights · 14 monsters slain". */
export function campaignHeaderText(c: { sessions: number; fights: number; slain: number }) {
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  return [
    n(c.sessions, "session", "sessions"),
    n(c.fights, "fight", "fights"),
    `${n(c.slain, "monster", "monsters")} slain`,
  ].join(" · ");
}

export const CAMPAIGN_RECORD_TITLE: Record<CampaignRecordKey, string> = {
  "biggest-hit": "Biggest hit",
  "biggest-overkill": "Biggest overkill",
  "best-fight-damage": "Most damage in a fight",
  "best-fight-kills": "Most kills in a fight",
  "best-fight-healing": "Most healing in a fight",
};

const RECORD_UNIT: Record<CampaignRecordKey, (v: number) => string> = {
  "biggest-hit": () => "damage",
  "biggest-overkill": () => "",
  "best-fight-damage": () => "damage",
  "best-fight-kills": (v) => (v === 1 ? "kill" : "kills"),
  "best-fight-healing": () => "HP",
};

/**
 * FR-STATS-83: a record's value: "30 damage", "4 kills", "8 HP"; Biggest overkill per role as the
 * award card (BL-103): the DM's bare amount, a player's "30 damage" (the callout line's damage).
 */
export function recordValueText(
  key: CampaignRecordKey,
  r: NonNullable<CampaignRecord>,
  role: "dm" | "player",
) {
  const unit = unitOf(key, role) ?? RECORD_UNIT[key](r.value);
  return unit ? `${r.value} ${unit}` : String(r.value);
}

/** FR-STATS-83: "→ Skeleton · Old Crypt · Tue 20 Oct" (the target of a hit, then the fight). */
export const recordWhereText = (r: NonNullable<CampaignRecord>) =>
  r.to !== undefined ? `→ ${r.to} · ${r.fight}` : r.fight;

/** FR-STATS-84: "Biggest hit ×2 · Most kills" (card order, ×N above 1). */
export const awardsWonText = (row: Pick<CampaignAwardsRow, "won">) =>
  row.won.map((w) => `${AWARD_TITLE[w.key]}${w.count > 1 ? ` ×${w.count}` : ""}`).join(" · ");
