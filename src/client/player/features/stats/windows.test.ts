// Stats window on the player registry: registered per FR-SHELL-86 (FR-SHELL-93), fits at 1280×720
// and overlaps no open product window at 1600×900; the awards open (FR-SHELL-94); the
// `stats-awards` notification view (FR-NOTE-48). Sprint 8: the End summary open (FR-STATS-34), the
// `stats-fight-summary` view (FR-NOTE-68), the Stats preferences section (FR-STATS-30).
import { expect, test } from "bun:test";
import type { You } from "@shared/protocol/frames";
import { STATS_AWARDS_KIND, STATS_FIGHT_SUMMARY_KIND } from "@shared/stats/schemas";
import { clampRect, type Rect, TOP_BAR_H, workArea } from "@ui/features/play-shell/geometry";
import { defaultLayout, reduce } from "@ui/features/play-shell/manager";
import { STATS_WINDOW_KIND } from "@ui/features/stats/logic";
import {
  openStatsAwardsRuns,
  openStatsFightRuns,
  statsDefFacts,
} from "@ui/features/stats/window-checks";
import { playerNotificationViews } from "../../notification-views";
import { playerPrefSections } from "../../pref-sections";

import { playerWindows } from "../../windows";

const YOU: You = { campaignId: "c1", role: "player", playerId: "p1" };
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function openOnDefaults(viewport: { w: number; h: number }) {
  const ctx = {
    registry: playerWindows,
    viewport,
    available: new Set(playerWindows.defs.map((d) => d.kind)),
  };
  const ws = reduce(
    defaultLayout(playerWindows, viewport),
    { type: "open", kind: STATS_WINDOW_KIND },
    ctx,
  );
  return ws
    .filter((w) => w.state === "open")
    .map((w) => ({ kind: w.kind, ...clampRect(w, viewport) }));
}

test("FR-SHELL-93 stats window registered (player): stats.board 'Stats', 400 × 412, min 320 × 280, top-left dx 56, closed by default, launcher 'Stats' right after Party, the toast / awards runtime as companion, no activity", () => {
  const facts = statsDefFacts(playerWindows);
  expect(facts).toEqual({
    title: "Stats",
    defaultSize: { w: 400, h: 412 },
    minSize: { w: 320, h: 280 },
    defaultPosition: { anchor: "top-left", dx: 56 },
    defaultOpen: false,
    launcher: { label: "Stats", order: 59 },
    companion: true,
    activity: false,
    partyOrder: 58,
  });
  const next = playerWindows.defs
    .flatMap((d) => (d.launcher && d.launcher.order > 58 ? [d.launcher.order] : []))
    .sort((a, b) => a - b)[0];
  expect(next).toBe(59);
});

test("FR-SHELL-93 stats window fits at 1280×720 and covers no open product window at 1600×900", () => {
  for (const vp of [
    { w: 1280, h: 720 },
    { w: 1600, h: 900 },
  ]) {
    const rects = openOnDefaults(vp);
    const stats = rects.find((r) => r.kind === STATS_WINDOW_KIND) as Rect;
    const area = workArea(vp);
    expect(stats.x >= 0 && stats.y >= TOP_BAR_H).toBe(true);
    expect(stats.x + stats.w <= area.w && stats.y + stats.h <= TOP_BAR_H + area.h).toBe(true);
    expect(stats.w >= 320 && stats.h >= 280).toBe(true);
    if (vp.w === 1600) {
      const others = rects.filter((r) => r.kind !== STATS_WINDOW_KIND);
      expect(others.filter((o) => overlaps(o, stats)).map((o) => o.kind)).toEqual([]);
    }
  }
});

test("FR-SHELL-94 awards open the window (player): a closed window opens (by feature), a minimised one is restored, an open one is fronted; each switched to the Session tab on that session", () => {
  const view = {
    tab: "session" as const,
    fightKey: "enc-1",
    sessionFromN: 7,
    highlightsOpen: null,
    luckScope: null,
  };
  const feature = [{ kind: STATS_WINDOW_KIND, by: "feature" }];
  expect(openStatsAwardsRuns(playerWindows, YOU)).toEqual([
    { before: "closed", calls: feature, state: "open", onTop: true, view },
    { before: "minimised", calls: feature, state: "open", onTop: true, view },
    { before: "open", calls: feature, state: "open", onTop: true, view },
  ]);
});

test("FR-NOTE-48 awards notification view (player): stats-awards registered with an icon and a renderer (its Open button)", () => {
  const v = playerNotificationViews.get(STATS_AWARDS_KIND);
  expect(v?.icon).toBeDefined();
  expect(v?.render).toBeDefined();
  expect(v?.onAction).toBeUndefined();
});

test("FR-STATS-34 summary opens Stats (player): a closed window opens (by feature), a minimised one is restored, an open one is fronted; each on the Fight tab, that fight, Highlights open", () => {
  const view = {
    tab: "fight" as const,
    fightKey: "enc-9",
    sessionFromN: null,
    highlightsOpen: true,
    luckScope: null,
  };
  const feature = [{ kind: STATS_WINDOW_KIND, by: "feature" }];
  expect(openStatsFightRuns(playerWindows, YOU)).toEqual([
    { before: "closed", calls: feature, state: "open", onTop: true, view },
    { before: "minimised", calls: feature, state: "open", onTop: true, view },
    { before: "open", calls: feature, state: "open", onTop: true, view },
  ]);
});

test("FR-NOTE-68 fight summary notification view (player): stats-fight-summary registered, info class, with an icon and a renderer (its Open), no action", () => {
  const v = playerNotificationViews.get(STATS_FIGHT_SUMMARY_KIND);
  expect(v?.icon).toBeDefined();
  expect(v?.render).toBeDefined();
  expect(v?.onAction).toBeUndefined();
  expect((v as { toastClass?: string } | undefined)?.toastClass).toBe("info");
});

test("FR-STATS-30 FR-STATS-34 preferences (player): the Stats section stats.prefs registered once", () => {
  expect(playerPrefSections.filter((s) => s.id === "stats.prefs").map((s) => s.title)).toEqual([
    "Stats",
  ]);
});
