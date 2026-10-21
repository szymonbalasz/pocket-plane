// Stats window client logic (STATS §7, FR-STATS-17–25), pure: which live frames re-query, the
// overkill callout toast (FR-STATS-22), the live awards open (FR-SHELL-94), picker labels. The
// numbers are always the server's (`stats.query`'s ack): nothing here aggregates a fact.
import {
  AttackLogDmPayload,
  AttackLogPayload,
  HpLogDmPayload,
  HpLogPayload,
} from "@shared/combat-tracker/log-kinds";
import { LOG_KIND_ATTACK, LOG_KIND_HP } from "@shared/combat-tracker/schemas";
import { GAME_LOG_ENTRY_TYPE, type GameLogEntryView } from "@shared/dice-roll-log/schemas";
import { NotificationCreated } from "@shared/events/notifications";
import type { NotificationRecord } from "@shared/notifications/schemas";
import type { EventFrame } from "@shared/protocol/frames";
import { dayLabel } from "@shared/stats/rules";
import {
  type Award,
  type AwardKey,
  type DmFightRow,
  type PlayerFightRow,
  type SessionSummary,
  STATS_AWARDS_KIND,
  StatsAwardsPayload,
} from "@shared/stats/schemas";
import { NOTIFICATION_TYPE } from "../notifications/logic";

export const STATS_WINDOW_KIND = "stats.board";
export const STATS_TABS = ["fight", "session"] as const;
export type StatsTab = (typeof STATS_TABS)[number];

/** FR-STATS-17: trailing re-query delay after a live log upsert. */
export const REFRESH_MS = 1000;
/** FR-STATS-22: the callout toast's life. */
export const OVERKILL_TOAST_MS = 4000;
/** FR-NOTE-49: one callout toast at a time (a new one replaces it). */
export const OVERKILL_TOAST_ID = "stats-overkill";

type Frame = Pick<EventFrame, "cause" | "changes">;

const logUpserts = (frame: Frame) =>
  frame.changes
    .filter((c) => c.type === GAME_LOG_ENTRY_TYPE && c.op === "upsert" && c.data)
    .map((c) => c.data as GameLogEntryView);

/**
 * FR-STATS-17: does this live frame re-query? Fight tab: a log upsert in the shown fight; with no
 * fight picked, any fight's (the default may move to a fight just started). Session tab: any.
 */
export function refreshes(
  frame: Frame,
  view: { tab: StatsTab; pickedFight: string | null },
): boolean {
  const entries = logUpserts(frame);
  if (view.tab === "session") return entries.length > 0;
  return entries.some((e) =>
    view.pickedFight === null ? e.encounterId !== null : e.encounterId === view.pickedFight,
  );
}

/** A callout line's public damage and DM-only overkill (`dmPayload`, absent for players). */
function calloutOf(
  e: GameLogEntryView,
): { target: string; damage: number; overkill?: number } | null {
  if (e.kind === LOG_KIND_ATTACK) {
    const p = AttackLogPayload.safeParse(e.payload);
    if (!p.success || p.data.callout !== "overkill") return null;
    const dm = AttackLogDmPayload.safeParse(e.dmPayload);
    return { target: p.data.targetName, damage: p.data.damage, overkill: dm.data?.overkill };
  }
  if (e.kind === LOG_KIND_HP) {
    const p = HpLogPayload.safeParse(e.payload);
    if (!p.success || p.data.callout !== "overkill" || p.data.kind !== "damage") return null;
    const dm = HpLogDmPayload.safeParse(e.dmPayload);
    return { target: p.data.targetName, damage: p.data.amount, overkill: dm.data?.overkill };
  }
  return null;
}

/**
 * FR-STATS-22 (FR-NOTE-49): the callout toast a live frame starts: the first outcome line upsert
 * with `callout`, not undone: `cbt.attack`, and `cbt.hp` direct damage (FR-CBT-137 stamps both;
 * the DM's "Thorn applies 40" in the Damage / heal dialog is a `cbt.hp` line). Players:
 * "Overkill! Thorn → Goblin 1: 30 damage"; the DM adds " (+23 over 7 HP)" from `dmPayload`
 * (players never have it). Null = no toast.
 */
export function overkillToast(
  frame: Frame,
  role: "dm" | "player",
): { entryId: string; text: string } | null {
  for (const e of logUpserts(frame)) {
    if (e.undone) continue;
    const c = calloutOf(e);
    if (!c) continue;
    let text = `Overkill! ${e.actorName} → ${c.target}: ${c.damage} damage`;
    if (role === "dm" && c.overkill !== undefined) {
      text += ` (+${c.overkill} over ${c.damage - c.overkill} HP)`;
    }
    return { entryId: e.id, text };
  }
  return null;
}

/** FR-SHELL-94: the session a live frame's new `stats-awards` notification shows; else null. */
export function awardsOpenOf(frame: Frame): StatsAwardsPayload | null {
  if (frame.cause.name !== NotificationCreated.type) return null;
  for (const c of frame.changes) {
    if (c.type !== NOTIFICATION_TYPE || c.op !== "upsert") continue;
    const n = c.data as NotificationRecord | undefined;
    if (n?.kind !== STATS_AWARDS_KIND) continue;
    const p = StatsAwardsPayload.safeParse(n.payload);
    if (p.success) return p.data;
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

/** FR-STATS-24: a fight none of whose rows has a number yet. */
export const noDamageYet = (rows: readonly (PlayerFightRow | DmFightRow)[]) =>
  rows.every((r) => r.dealt === 0 && r.taken === 0 && r.healed === 0 && r.kills === 0);

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
export const awardValueText = (a: Award) =>
  a.value === null ? "—" : UNIT[a.key] ? `${a.value} ${UNIT[a.key]}` : String(a.value);
