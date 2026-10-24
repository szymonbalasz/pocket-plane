// `stats.board`'s companion (always mounted while the kind is available; one per client page,
// BL-71), both clients, live event frames only (never a snapshot, reload or resync):
// - FR-STATS-28 / FR-NOTE-69: the kill feed `stats-feed-toast`, 4 s, in the callout class of the
//   one stack (FR-NOTE-50, -52: `showCallout`; no notification row; one at a time; a line once;
//   lines of one apply in one toast). It replaces the overkill toast (FR-STATS-22). Off with the
//   "Kill feed" preference (FR-STATS-30);
// - FR-SHELL-94 / FR-STATS-53: a new `stats-awards` notification opens Stats on that session, once;
// - FR-STATS-34: a new `stats-fight-summary` notification opens Stats on that fight with
//   Highlights (preference "Open the fight summary at End"); the DM's own End first minimises
//   Initiative (FR-CBT-60, on the ack after this frame), so its open waits for that (≤ 2 s).
// *(Sprint 10 T3)* FR-STATS-85: closing the window sends its tab back to Campaign, so the next user
// open (launcher, palette, S key) lands there; a feature open sets its own tab first.
// *(Sprint 8, TT4)* Under the pause card (players, seams S10, FR-SHELL-127): no kill feed (dropped,
// not replayed); the awards and fight-summary opens wait for resume (`pauseGate`).
import type { EventFrame } from "@shared/protocol/frames";
import { useEffect, useRef, useState } from "react";
import { useEventFrame, useSync } from "../../sync/store";
import { showCallout } from "../notifications/toasts";
import { type PauseGate, pauseGate } from "../pause/gate";
import { useShellState } from "../play-shell/ShellContext";
import {
  createFeed,
  FEED_TOAST_ID,
  FEED_TOAST_MS,
  type Feed,
  type FeedLine,
  feedLinesOf,
  feedToastText,
} from "./feed";
import { awardsOpenOf, closedNow, DEFAULT_TAB, STATS_WINDOW_KIND, summaryOpenOf } from "./logic";
import { useOpenStatsAwards, useOpenStatsFight } from "./open";
import { type StatsPrefs, statsPrefs } from "./prefs";
import { statsViews, viewKey } from "./view";

const INITIATIVE_KIND = "cbt.initiative";
/** FR-STATS-34: the longest the DM's open waits for its own End's Initiative minimise. */
export const SUMMARY_WAIT_MS = 2000;

/** FR-STATS-28: one toast for one apply's lines. */
export function showFeedToast(lines: FeedLine[]): void {
  const t = feedToastText(lines);
  showCallout({
    id: FEED_TOAST_ID,
    content: (
      <span data-testid="stats-feed-toast" className="flex flex-col">
        {t.lines.map((text, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a toast's fixed lines, never reordered.
          <span key={i} data-testid="stats-feed-line">
            {text}
          </span>
        ))}
        {t.more > 0 ? <span className="text-muted-foreground">and {t.more} more</span> : null}
      </span>
    ),
    ms: FEED_TOAST_MS,
  });
}

/** Page memory: the feed, and the notifications already opened (a row opens once, FR-STATS-53). */
let feed: Feed | null = null;
const pageFeed = () => {
  feed ??= createFeed({ show: showFeedToast });
  return feed;
};
const opened = new Set<string>();
/** True the first time a notification id is seen on this page. */
export function firstOpen(notificationId: string, seen: Set<string> = opened): boolean {
  if (seen.has(notificationId)) return false;
  seen.add(notificationId);
  return true;
}

/**
 * FR-STATS-34 (DM, after FR-CBT-60): this tab's own End (the frame carries its intent id) while
 * Initiative is open waits for Initiative to minimise; anything else opens at once.
 */
export function summaryWaits(
  role: "dm" | "player",
  frame: Pick<EventFrame, "cause">,
  initiative: string | undefined,
): boolean {
  return role === "dm" && frame.cause.intentId !== undefined && initiative === "open";
}

export interface StatsFrameDeps {
  role: "dm" | "player";
  prefs: Pick<StatsPrefs, "feed" | "openSummary">;
  feed: Pick<Feed, "push">;
  openAwards(fromN: number): void;
  openFight(encounterId: string): void;
  /** The DM's own End: the open waits for Initiative to minimise. */
  wait(encounterId: string): void;
  initiative: string | undefined;
  gate?: Pick<PauseGate, "paused" | "deferUntilResume">;
  seen?: Set<string>;
}

/** One live frame: the kill feed, the awards open, the fight-summary open. */
export function onStatsFrame(frame: EventFrame, d: StatsFrameDeps): void {
  const gate = d.gate ?? pauseGate;
  // FR-SHELL-127: the kill feed is dropped under the pause card, not replayed.
  if (d.prefs.feed && !gate.paused()) d.feed.push(feedLinesOf(frame, d.role));
  const awards = awardsOpenOf(frame);
  if (awards && firstOpen(awards.notificationId, d.seen)) {
    gate.deferUntilResume("stats.awards", () => d.openAwards(awards.fromN));
  }
  const summary = summaryOpenOf(frame);
  if (summary && firstOpen(summary.notificationId, d.seen) && d.prefs.openSummary) {
    if (summaryWaits(d.role, frame, d.initiative)) d.wait(summary.encounterId);
    else gate.deferUntilResume("stats.summary", () => d.openFight(summary.encounterId));
  }
}

export function StatsRuntime() {
  const role = useSync((s) => (s.store.you?.role === "dm" ? "dm" : "player"));
  const openAwards = useOpenStatsAwards();
  const openFight = useOpenStatsFight();
  const initiative = useShellState((s) => s.windows.find((w) => w.kind === INITIATIVE_KIND)?.state);
  const you = useSync((s) => s.store.you);
  const board = useShellState((s) => s.windows.find((w) => w.kind === STATS_WINDOW_KIND)?.state);
  const lastBoard = useRef(board);
  useEffect(() => {
    if (closedNow(lastBoard.current, board) && you) {
      statsViews().set(viewKey(you), { tab: DEFAULT_TAB });
    }
    lastBoard.current = board;
  }, [board, you]);
  const [waiting, setWaiting] = useState<{ encounterId: string; since: number } | null>(null);
  const openFightRef = useRef(openFight);
  openFightRef.current = openFight;

  useEventFrame((frame) =>
    onStatsFrame(frame, {
      role,
      prefs: statsPrefs().read(),
      feed: pageFeed(),
      openAwards,
      openFight,
      wait: (encounterId) => setWaiting({ encounterId, since: Date.now() }),
      initiative,
    }),
  );

  useEffect(() => {
    if (!waiting) return;
    if (initiative !== "open") {
      setWaiting(null);
      openFightRef.current(waiting.encounterId);
      return;
    }
    const t = setTimeout(
      () => {
        setWaiting(null);
        openFightRef.current(waiting.encounterId);
      },
      Math.max(0, waiting.since + SUMMARY_WAIT_MS - Date.now()),
    );
    return () => clearTimeout(t);
  }, [waiting, initiative]);

  return null;
}
