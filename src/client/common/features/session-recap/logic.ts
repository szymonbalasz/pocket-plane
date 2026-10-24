// Recap window client logic (RECAP §7, FR-RECAP-06, -17, -19, -21, -22), pure: which live frames
// re-query, the live share open, section states, labels and the Markdown copy. The numbers are
// always the server's (`recap.query`'s ack): nothing here aggregates a fact.
import { GAME_LOG_ENTRY_TYPE } from "@shared/dice-roll-log/schemas";
import { NotificationCreated } from "@shared/events/notifications";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { COINS_DISPLAY, LOOT_ENTRY_TYPE } from "@shared/party-loot/schemas";
import type { EventFrame } from "@shared/protocol/frames";
import {
  type DmRecap,
  type OmittableSection,
  type PlayerRecap,
  RECAP_SECTIONS,
  type RecapCoins,
  type RecapLootRow,
  type RecapSection,
  SECTION_TITLE,
  SESSION_RECAP_KIND,
  SessionRecapPayload,
} from "@shared/session-recap/schemas";
import { feedText } from "@shared/stats/feed";
import { AWARD_TITLE, type SessionSummary } from "@shared/stats/schemas";
import { NOTIFICATION_TYPE } from "../notifications/logic";
import { awardDetailText, awardValueText, durationText, winnerText } from "../stats/logic";

export { RECAP_WINDOW_KIND } from "@shared/session-recap/schemas";

/**
 * FR-RECAP-06: trailing re-query delay after a live log / loot upsert (coalesces the burst); 1 s
 * leaves the answer 1 s so the refresh lands ≤ 2 s (BL-104: 2 s + the round trip was 2.1 s).
 */
export const RECAP_REFRESH_MS = 1000;
/** FR-RECAP-05: a `conflict` (rate limit) is asked again once, this much later. */
export const CONFLICT_RETRY_MS = 1000;

export type Recap = DmRecap | PlayerRecap;
type Frame = Pick<EventFrame, "cause" | "changes">;

/**
 * FR-RECAP-06: a live `game-log-entry` or `loot-entry` upsert re-queries the window while it shows
 * the newest session (older sessions re-query only after a snapshot or a picker change).
 */
export const refreshes = (frame: Frame, newest: boolean): boolean =>
  newest &&
  frame.changes.some(
    (c) => (c.type === GAME_LOG_ENTRY_TYPE || c.type === LOOT_ENTRY_TYPE) && c.op === "upsert",
  );

/**
 * FR-RECAP-11: the picker's sessions, newest first: stats' list, plus the shown session while the
 * list predates it (a new derived session started while the window was open, RC5), so the picker
 * never goes blank and a pick is always a listed session.
 */
export function pickerSessions(
  list: readonly SessionSummary[],
  recap: Recap | null,
): SessionSummary[] {
  if (!recap || list.some((s) => s.fromN === recap.fromN)) return [...list];
  const shown: SessionSummary = {
    fromN: recap.fromN,
    toN: recap.toN,
    from: recap.from,
    to: recap.to,
    fights: recap.fights.length + (recap.fightsMore ?? 0),
  };
  return [...list, shown].sort((a, b) => b.fromN - a.fromN);
}

/**
 * RC5: stats' session list is behind the recap just answered: the shown session is missing from
 * it, or its span has grown (a new session starts, or the newest one gets a line). Ask it again.
 */
export function listBehind(list: readonly SessionSummary[] | null, recap: Recap | null): boolean {
  if (!list || !recap) return false;
  const s = list.find((x) => x.fromN === recap.fromN);
  return !s || s.toN !== recap.toN;
}

/** FR-RECAP-21: the session a live frame's new `session-recap` notification opens; else null. */
export function shareOpenOf(
  frame: Frame,
): (SessionRecapPayload & { notificationId: string }) | null {
  if (frame.cause.name !== NotificationCreated.type) return null;
  for (const c of frame.changes) {
    if (c.type !== NOTIFICATION_TYPE || c.op !== "upsert") continue;
    const n = c.data as NotificationRecord | undefined;
    if (n?.kind !== SESSION_RECAP_KIND) continue;
    const p = SessionRecapPayload.safeParse(n.payload);
    if (p.success) return { ...p.data, notificationId: n.id };
  }
  return null;
}

/** FR-RECAP-22: the DM sees every section, those players don't greyed "Hidden from players". */
export type SectionState = "shown" | "hidden-from-players";
export const sectionState = (recap: Recap, key: RecapSection): SectionState =>
  recap.shared?.omit.includes(key as OmittableSection) ? "hidden-from-players" : "shown";

/** FR-RECAP-11: the header's times line, "19:02–23:41 · 4 h 39 min · 3 fights" (local time). */
export function headerText(recap: Pick<Recap, "from" | "to" | "fights" | "fightsMore">): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const hhmm = (iso: string) => {
    const d = new Date(iso);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const n = recap.fights.length + (recap.fightsMore ?? 0);
  const span = Date.parse(recap.to) - Date.parse(recap.from);
  return `${hhmm(recap.from)}–${hhmm(recap.to)} · ${durationText(span)} · ${n} fight${n === 1 ? "" : "s"}`;
}

/** FR-RECAP-12: "3 rounds · 12 min" / "running". */
export const fightMeta = (f: Recap["fights"][number]): string =>
  f.duration === null
    ? `${f.rounds} round${f.rounds === 1 ? "" : "s"} · running`
    : `${f.rounds} round${f.rounds === 1 ? "" : "s"} · ${durationText(f.duration)}`;

/** "Thorn (43)", ties "Mira, Thorn (12)"; null with no MVP. */
export function mvpText(f: Recap["fights"][number]): string | null {
  if (f.mvp.value === null || f.mvp.winners.length === 0) return null;
  const names = f.mvp.winners.map((w) => (w.with ? [w.name, ...w.with].join(" + ") : w.name));
  return `${names.join(", ")} (${f.mvp.value})`;
}

/** "+40 gp 25 sp", "−5 gp" (display order, zero coins left out); "" with none. */
export function coinsText(c: RecapCoins): string {
  return COINS_DISPLAY.filter((k) => c[k] !== 0)
    .map((k) => `${c[k] > 0 ? "+" : "−"}${Math.abs(c[k])} ${k}`)
    .join(" ");
}

/** A loot row's amount: coins, or "+1 ×" / "−2 ×" for an item. */
export const lootAmount = (r: RecapLootRow): string =>
  r.kind === "item"
    ? `${(r.qty ?? 0) > 0 ? "+" : "−"}${Math.abs(r.qty ?? 0)} ×`
    : coinsText(r.coins);

/** The party side of a loot row: "Party" or the character's name. */
export const holderText = (r: RecapLootRow): string =>
  r.holder.kind === "party" ? "Party" : r.holder.name;

/** FR-RECAP-15: "Mira · nat 20 · Longsword". */
export const rollText = (r: { name: string; natural: 20 | 1; label: string }) =>
  [r.name, `nat ${r.natural}`, r.label].filter((x) => x !== "").join(" · ");

/** FR-RECAP-17: nothing at all happened yet (no fight, row, loot, roll or award). */
export function isEmptyRecap(r: Recap): boolean {
  return (
    r.fights.length === 0 &&
    (r.party?.length ?? 0) === 0 &&
    (r.loot?.rows.length ?? 0) === 0 &&
    (r.rolls?.rows.length ?? 0) === 0 &&
    (r.awards ?? []).every((a) => a.value === null)
  );
}

/** FR-RECAP-17: the sections that show (an empty one is hidden, except Fights). */
export function visibleSections(r: Recap): RecapSection[] {
  return RECAP_SECTIONS.filter((k) => {
    if (k === "header" || k === "fights") return true;
    if (k === "party") return (r.party?.length ?? 0) > 0;
    if (k === "loot") return (r.loot?.rows.length ?? 0) > 0;
    if (k === "rolls") return (r.rolls?.rows.length ?? 0) > 0;
    return (r.awards ?? []).some((a) => a.value !== null);
  });
}

const hiddenMark = (x: object) => ("hidden" in x && x.hidden === true ? " (hidden)" : "");

/**
 * FR-RECAP-19: the visible recap as Markdown: a `##` heading, one `###` per shown section, bullets,
 * the note as a quote. A player's copy holds only their recap (their ack); the DM's marks the
 * sections players don't see and hidden items.
 */
export function recapMarkdown(r: Recap, role: "dm" | "player"): string {
  const out: string[] = [`## Session recap · ${r.label}`];
  if (r.shared?.note) out.push("", `> ${r.shared.note}`);
  out.push("", headerText(r));
  for (const k of visibleSections(r)) {
    if (k === "header") continue;
    const dmHidden = role === "dm" && sectionState(r, k) !== "shown";
    out.push("", `### ${SECTION_TITLE[k]}${dmHidden ? " (hidden from players)" : ""}`);
    if (k === "fights") {
      if (r.fights.length === 0) out.push("- No fights this session");
      for (const f of r.fights) {
        const mvp = mvpText(f);
        out.push(`- **${f.label}** · ${fightMeta(f)}${mvp ? ` · MVP ${mvp}` : ""}`);
        if (f.kills.events.length)
          out.push(`  - Kills: ${f.kills.events.map((e) => feedText(e)).join("; ")}`);
        if (f.downed.events.length)
          out.push(`  - Downs: ${f.downed.events.map((e) => feedText(e)).join("; ")}`);
        if ("standing" in f && f.standing.length)
          out.push(
            `  - Still standing: ${f.standing.map((s) => `${s.name}${hiddenMark(s)}`).join(", ")}`,
          );
      }
      if (r.fightsMore) out.push(`- +${r.fightsMore} more`);
    } else if (k === "party") {
      for (const p of r.party ?? []) {
        out.push(
          `- ${p.name}: dealt ${p.dealt}, kills ${p.kills}, downed ${p.downed}, healed ${p.healed}, nat 20 ×${p.nat20}, nat 1 ×${p.nat1}, avg d20 ${p.avg ?? "—"}`,
        );
      }
    } else if (k === "loot" && r.loot) {
      for (const row of r.loot.rows) {
        const amount = lootAmount(row);
        out.push(`- ${row.text || "Coins"}${amount ? `: ${amount}` : ""} (${holderText(row)})`);
      }
      if (r.loot.more) out.push(`- +${r.loot.more} more`);
      const totals = [
        coinsText(r.loot.totals.coins),
        ...r.loot.totals.items.map((i) => `${i.name} ${i.qty > 0 ? "+" : "−"}${Math.abs(i.qty)}`),
      ].filter((x) => x !== "");
      if (totals.length) out.push(`- Totals: ${totals.join("; ")}`);
    } else if (k === "rolls" && r.rolls) {
      for (const x of r.rolls.rows) out.push(`- ${rollText(x)}${hiddenMark(x)}`);
      if (r.rolls.more) out.push(`- +${r.rolls.more} more`);
    } else if (k === "awards") {
      for (const a of r.awards ?? []) {
        if (a.value === null) continue;
        const detail = awardDetailText(a);
        out.push(
          `- ${AWARD_TITLE[a.key]}: ${a.winners.map(winnerText).join(", ")} (${awardValueText(a, role)})${detail ? ` · ${detail}` : ""}`,
        );
      }
    }
  }
  return `${out.join("\n")}\n`;
}
