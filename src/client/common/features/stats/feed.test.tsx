// The kill feed (pure, FR-STATS-26–29, FR-NOTE-69): which lines of a live frame toast, their words
// per role, and the batcher (one apply = one toast, ≤ 3 lines, a line once). The toast itself is a
// callout in the one stack, never a notification row.
import { describe, expect, test } from "bun:test";
import { LOG_KIND_ATTACK, LOG_KIND_HP } from "@shared/combat-tracker/schemas";
import { GAME_LOG_ENTRY_TYPE } from "@shared/dice-roll-log/schemas";
import type { EventFrame } from "@shared/protocol/frames";
import { renderToStaticMarkup } from "react-dom/server";
import { createToastMemory, registerToastMemory } from "../notifications/toasts";
import {
  createFeed,
  FEED_BATCH_MS,
  FEED_TOAST_ID,
  FEED_TOAST_MS,
  type FeedLine,
  feedLinesOf,
  feedToastText,
} from "./feed";
import type { Timers } from "./refresh";
import { firstOpen, showFeedToast, summaryWaits } from "./runtime";

type Frame = Pick<EventFrame, "cause" | "changes">;

const attack = (over: Record<string, unknown> = {}, payload: Record<string, unknown> = {}) => ({
  id: "e1",
  campaignId: "c1",
  n: 10,
  at: "2026-10-20T19:00:00.000Z",
  kind: LOG_KIND_ATTACK,
  category: "attack",
  public: true,
  undone: false,
  rollerRole: "dm",
  rollerPlayerId: null,
  actorName: "Thorn",
  payload: {
    targetName: "Goblin 1",
    attackName: "Longsword",
    damageType: "slashing",
    toHit: null,
    hit: true,
    damage: 30,
    multiplier: "normal",
    crit: false,
    callout: "overkill",
    fell: "kill",
    ...payload,
  },
  dmPayload: {
    targetAc: 15,
    hitComputed: null,
    toHitRolled: null,
    damageRolled: 30,
    damageTotal: 30,
    applied: 7,
    overkill: 23,
    overrides: { toHit: false, hit: false, damage: false },
  },
  rollIds: [],
  encounterId: "enc-1",
  supersededBy: null,
  ...over,
});

const hp = (payload: Record<string, unknown>, over: Record<string, unknown> = {}) =>
  attack({ kind: LOG_KIND_HP, actorName: "DM", payload, dmPayload: null, ...over });

/** A player's copy: the hub never sends `dmPayload` (FR-DICE-15). */
const redacted = (e: ReturnType<typeof attack>) => {
  const { dmPayload: _, ...rest } = e;
  return rest;
};

const frame = (data: unknown[], cause = "AttackApplied"): Frame => ({
  cause: { name: cause },
  changes: data.map((d, i) => ({
    type: GAME_LOG_ENTRY_TYPE,
    id: `e${i}`,
    op: "upsert" as const,
    data: d,
  })),
});

const texts = (f: Frame, role: "dm" | "player") => feedLinesOf(f, role).map((l) => l.text);

describe("FR-STATS-26 FR-STATS-27 feed lines", () => {
  test("FR-STATS-26 kill / down read from the line's fell: a monster kill, a PC down (the line's names)", () => {
    const down = attack({ actorName: "Goblin 2" }, { targetName: "Brakka", fell: "down" });
    delete (down.payload as { callout?: unknown }).callout;
    expect(texts(frame([redacted(down)]), "player")).toEqual(["Goblin 2 dropped Brakka"]);
    const kill = attack({}, { callout: undefined });
    expect(texts(frame([redacted(kill)]), "player")).toEqual(["Thorn finished Goblin 1"]);
  });

  test("FR-STATS-27 per role: players 'Overkill! Thorn finished Goblin 1' with no amount; the DM adds ', overkill 23' and '(hidden)' on a line players never got", () => {
    expect(texts(frame([redacted(attack())]), "player")).toEqual([
      "Overkill! Thorn finished Goblin 1",
    ]);
    expect(texts(frame([attack()]), "dm")).toEqual([
      "Overkill! Thorn finished Goblin 1, overkill 23",
    ]);
    const hidden = attack({ public: false }, { targetName: "Elite", callout: undefined });
    expect(texts(frame([hidden]), "dm")).toEqual(["Thorn finished Elite (hidden)"]);
    // A player's text never holds a number from dmPayload, even if one were present.
    expect(texts(frame([attack()]), "player")).toEqual(["Overkill! Thorn finished Goblin 1"]);
  });

  test("FR-STATS-27 the DM's direct damage (no From): 'Goblin 1 falls' / 'Brakka is down'; with From: the source's name", () => {
    const fall = hp({ targetName: "Goblin 1", kind: "damage", amount: 9, fell: "kill" });
    expect(texts(frame([fall], "HpApplied"), "player")).toEqual(["Goblin 1 falls"]);
    const down = hp({ targetName: "Brakka", kind: "damage", amount: 50, fell: "down" });
    expect(texts(frame([down], "HpApplied"), "player")).toEqual(["Brakka is down"]);
    const sourced = hp(
      {
        targetName: "Bandit 4",
        kind: "damage",
        amount: 25,
        sourced: true,
        callout: "overkill",
        fell: "kill",
      },
      { actorName: "Thorn", dmPayload: { applied: 11, hpBefore: 11, hpAfter: 0, overkill: 14 } },
    );
    expect(texts(frame([sourced], "HpApplied"), "dm")).toEqual([
      "Overkill! Thorn finished Bandit 4, overkill 14",
    ]);
  });

  test("FR-STATS-22 a callout on a target already down (no fell) keeps its text: 'Overkill! Thorn → Goblin 1: 30 damage'", () => {
    const corpse = attack({}, { fell: undefined });
    expect(texts(frame([redacted(corpse)]), "player")).toEqual([
      "Overkill! Thorn → Goblin 1: 30 damage",
    ]);
    expect(texts(frame([corpse]), "dm")).toEqual([
      "Overkill! Thorn → Goblin 1: 30 damage, overkill 23",
    ]);
  });
});

describe("FR-STATS-29 visibility and live only", () => {
  test("FR-STATS-29 undo and supersede upserts never toast; nor a line without fell or callout, a heal or another kind", () => {
    expect(texts(frame([attack({ undone: true })]), "dm")).toEqual([]);
    expect(texts(frame([attack({ supersededBy: "e9" })]), "dm")).toEqual([]);
    expect(texts(frame([attack({}, { fell: undefined, callout: undefined })]), "dm")).toEqual([]);
    const heal = hp({ targetName: "Mira", kind: "heal", amount: 30, sourced: true });
    expect(texts(frame([heal]), "dm")).toEqual([]);
    expect(texts(frame([attack({ kind: "roll", payload: [] })]), "dm")).toEqual([]);
    // Other record types or a delete: nothing.
    const del: Frame = {
      cause: { name: "X" },
      changes: [{ type: GAME_LOG_ENTRY_TYPE, id: "e1", op: "delete" }],
    };
    expect(texts(del, "dm")).toEqual([]);
  });
});

/** Manual timers: `run()` fires every due callback. */
function fakeTimers() {
  let now = 0;
  const due: { at: number; fn: () => void; id: number }[] = [];
  let id = 0;
  const timers: Timers = {
    setTimeout: (fn, ms) => {
      id += 1;
      due.push({ at: now + ms, fn, id });
      return id;
    },
    clearTimeout: (h) => {
      const i = due.findIndex((d) => d.id === h);
      if (i >= 0) due.splice(i, 1);
    },
  };
  return {
    timers,
    advance(ms: number) {
      now += ms;
      for (const d of [...due].sort((a, b) => a.at - b.at)) {
        if (d.at > now) continue;
        due.splice(due.indexOf(d), 1);
        d.fn();
      }
    },
  };
}

const line = (id: string, text = id): FeedLine => ({ id, text });

describe("FR-STATS-28 feed toast", () => {
  test("FR-STATS-28 one apply = one toast: two targets' frames within the batch wait show once, naming both; a later apply toasts again", () => {
    const t = fakeTimers();
    const shown: string[][] = [];
    const feed = createFeed({ show: (ls) => shown.push(ls.map((l) => l.text)), timers: t.timers });
    feed.push([line("a", "Overkill! Mira finished Bandit 2")]);
    t.advance(20);
    feed.push([line("b", "Overkill! Mira finished Bandit 4")]);
    expect(shown).toEqual([]);
    t.advance(FEED_BATCH_MS);
    expect(shown).toEqual([
      ["Overkill! Mira finished Bandit 2", "Overkill! Mira finished Bandit 4"],
    ]);
    feed.push([line("c")]);
    t.advance(FEED_BATCH_MS);
    expect(shown).toHaveLength(2);
  });

  test("FR-STATS-28 a line toasts once: the same line upserted again (an edit) never toasts; a frame with no feed line starts nothing", () => {
    const t = fakeTimers();
    const shown: FeedLine[][] = [];
    const feed = createFeed({ show: (ls) => shown.push(ls), timers: t.timers });
    feed.push([line("a")]);
    t.advance(FEED_BATCH_MS);
    feed.push([line("a")]);
    feed.push([]);
    t.advance(FEED_BATCH_MS);
    expect(shown).toHaveLength(1);
    feed.push([line("b")]);
    feed.dispose();
    t.advance(FEED_BATCH_MS);
    expect(shown).toHaveLength(1);
  });

  test("FR-STATS-28 ≤ 3 lines, then 'and N more'", () => {
    const ls = ["a", "b", "c", "d", "e"].map((x) => line(x));
    expect(feedToastText(ls)).toEqual({ lines: ["a", "b", "c"], more: 2 });
    expect(feedToastText(ls.slice(0, 2))).toEqual({ lines: ["a", "b"], more: 0 });
  });

  test("FR-NOTE-69 feed toast is not a notification: a callout `stats-feed` (4 s) in the one stack, no row; a newer one replaces it", () => {
    const m = createToastMemory(Date.now());
    const off = registerToastMemory(m);
    try {
      showFeedToast([line("a", "Thorn finished Goblin 1")]);
      const first = m.getState().toasts.callout;
      expect(first?.id).toBe(FEED_TOAST_ID);
      expect(m.getState().toasts.toasts).toHaveLength(0);
      showFeedToast(["a", "b", "c", "d"].map((x) => line(x, `L${x}`)));
      const c = m.getState().toasts.callout;
      expect(c?.id).toBe(FEED_TOAST_ID);
      const html = renderToStaticMarkup(<div>{c?.content}</div>);
      expect(html).toContain('data-testid="stats-feed-toast"');
      expect(html.split('data-testid="stats-feed-line"').length - 1).toBe(3);
      expect(html).toContain("and 1 more");
      expect(html).not.toContain("Thorn finished");
      expect(FEED_TOAST_MS).toBe(4000);
    } finally {
      off();
    }
  });
});

describe("FR-STATS-34 FR-STATS-53 opens", () => {
  test("FR-STATS-53 Show awards opens Stats once per client: a notification id opens the first time only", () => {
    const seen = new Set<string>();
    expect(firstOpen("n1", seen)).toBe(true);
    expect(firstOpen("n1", seen)).toBe(false);
    expect(firstOpen("n2", seen)).toBe(true);
  });

  test("FR-STATS-34 the DM's own End waits for Initiative to minimise (FR-CBT-60); another tab, Initiative closed or a player: at once", () => {
    const own = { cause: { name: "NotificationCreated", intentId: "i1" } };
    const other = { cause: { name: "NotificationCreated" } };
    expect(summaryWaits("dm", own, "open")).toBe(true);
    expect(summaryWaits("dm", own, "minimised")).toBe(false);
    expect(summaryWaits("dm", other, "open")).toBe(false);
    expect(summaryWaits("player", own, "open")).toBe(false);
  });
});
