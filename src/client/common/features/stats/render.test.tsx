// The Stats window's tabs as static renders over a fake sync store, per role: fight rows
// (FR-STATS-18), award cards and Show awards (FR-STATS-19), states (FR-STATS-24), tie limits
// (FR-STATS-25); sprint 8: Highlights (FR-STATS-36, -48), Luck (FR-STATS-39, -41, -50). The data
// is an ack as the server sends it; the view renders it as is.
import { describe, expect, test } from "bun:test";
import type { You } from "@shared/protocol/frames";
import { emptyStore } from "@shared/protocol/store";
import {
  AWARD_KEYS,
  type Award,
  type DmFightResult,
  type DmLuckResult,
  type PlayerFightResult,
  type PlayerLuckResult,
  type SessionResult,
  type SessionsResult,
} from "@shared/stats/schemas";
import { TooltipProvider } from "@ui/components/ui/overlays";
import { SyncContext, type SyncState } from "@ui/sync/store";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { LuckView } from "./Luck";
import type { QueryStatus } from "./refresh";
import { FightView, SessionView, StatsWindow } from "./StatsWindow";
import {
  DM_HIGHLIGHTS,
  EMPTY_DM_HIGHLIGHTS,
  EMPTY_PLAYER_HIGHLIGHTS,
  PLAYER_HIGHLIGHTS,
} from "./test-acks";
import { statsViews, viewKey } from "./view";

const DM: You = { campaignId: "c1", role: "dm", playerId: null };
const PLAYER: You = { campaignId: "c1", role: "player", playerId: "p1" };

function wrap(you: You, node: ReactNode) {
  const store = createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store: {
          ...emptyStore(),
          you,
          records: {
            player: { p1: { id: "p1", color: "#e11d48" }, p2: { id: "p2", color: "#2563eb" } },
          },
        },
        lazy: { generation: 1 },
        connection: { sendIntent: () => new Promise(() => {}), onEvent: () => () => {} },
      }) as unknown as SyncState,
  );
  return renderToStaticMarkup(
    <SyncContext.Provider value={store}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        {node}
      </TooltipProvider>
    </SyncContext.Provider>,
  );
}

const rowsOf = (html: string) =>
  [...html.matchAll(/<tr[^>]*data-testid="stats-fight-row"[^>]*>/g)].map((m) => ({
    id: /data-record-id="([^"]+)"/.exec(m[0])?.[1],
    hidden: m[0].includes("data-hidden"),
  }));
const count = (html: string, id: string) => html.split(`data-testid="${id}"`).length - 1;
/** Whether the element with this test ID is disabled. */
const disabled = (html: string, id: string) =>
  new RegExp(`<[^>]*data-testid="${id}"[^>]*>`).exec(html)?.[0].includes('disabled=""') ?? false;

const counts = { dealt: 0, taken: 0, healed: 0, kills: 0 };
const PLAYER_FIGHT: PlayerFightResult = {
  fight: {
    key: "enc-1",
    label: "Fight 2 · Tue 20 Oct",
    round: 3,
    status: "started",
    highlights: EMPTY_PLAYER_HIGHLIGHTS,
    rows: [
      { key: "thorn", name: "Thorn", kind: "pc", ...counts, dealt: 30, taken: 0, kills: 1 },
      { key: "mira", name: "Mira", kind: "pc", ...counts, taken: 11 },
      { key: "owl", name: "Owlbear", kind: "companion", ownerKey: "mira", ...counts, dealt: 7 },
    ],
  },
  fights: [
    { key: "enc-1", label: "Fight 2 · Tue 20 Oct", status: "started" },
    { key: "enc-0", label: "Fight 1 · Mon 19 Oct", status: "ended" },
  ],
};
const dmExtra = { hidden: false, downs: 0, effective: { dealt: 0, taken: 0, healed: 0 } };
const DM_FIGHT: DmFightResult = {
  fight: {
    key: "enc-1",
    label: "Goblin Ambush",
    round: 3,
    status: "started",
    highlights: EMPTY_DM_HIGHLIGHTS,
    rows: [
      {
        key: "thorn",
        name: "Thorn",
        kind: "pc",
        ...counts,
        dealt: 30,
        kills: 1,
        ...dmExtra,
        effective: { dealt: 7, taken: 9, healed: 0 },
      },
      {
        key: "elite",
        name: "Goblin Elite",
        kind: "monster",
        ...counts,
        dealt: 9,
        ...dmExtra,
        hidden: true,
      },
      { key: "dm-direct", name: "DM (direct)", kind: "special", ...counts, dealt: 3, ...dmExtra },
    ],
  },
  fights: [{ key: "enc-1", label: "Goblin Ambush", status: "started" }],
};

const ok = <R,>(result: R, status: QueryStatus = "ok") => ({ status, result });
const fightHtml = (
  you: You,
  state: { status: QueryStatus; result: DmFightResult | PlayerFightResult | null },
  live = true,
  highlightsOpen: boolean | null = null,
) =>
  wrap(
    you,
    <FightView
      role={you.role === "dm" ? "dm" : "player"}
      state={state}
      live={live}
      highlightsOpen={highlightsOpen}
      onPick={() => {}}
      retry={() => {}}
    />,
  );

describe("FR-STATS-18 fight rows", () => {
  test("FR-STATS-18 fight rows (player): one stats-fight-row per ack row, data-record-id = combatant key, ack order, companion under its owner; Name, Dealt, Taken, Healed, Kills; no Effective, no hidden mark", () => {
    const html = fightHtml(PLAYER, ok(PLAYER_FIGHT));
    expect(rowsOf(html)).toEqual([
      { id: "thorn", hidden: false },
      { id: "mira", hidden: false },
      { id: "owl", hidden: false },
    ]);
    expect(html).toContain('data-testid="stats-fight-table"');
    expect(html).toContain('data-testid="stats-fight-picker"');
    for (const h of [">Name<", ">Dealt<", ">Taken<", ">Healed<", ">Kills<"])
      expect(html).toContain(h);
    expect(html).not.toContain(">Eff.<");
    expect(count(html, "stats-fight-effective")).toBe(0);
    expect(count(html, "stats-fight-hidden")).toBe(0);
    expect(html).toContain("↳ Owlbear");
    expect(html).toContain("Round 3");
  });

  test("FR-STATS-18 fight rows (DM): monster and special rows, the hidden row marked eye-off, the Effective column with its Tooltip", () => {
    const html = fightHtml(DM, ok(DM_FIGHT));
    expect(rowsOf(html)).toEqual([
      { id: "thorn", hidden: false },
      { id: "elite", hidden: true },
      { id: "dm-direct", hidden: false },
    ]);
    expect(html).toContain(">Eff.<");
    expect(count(html, "stats-fight-effective")).toBe(3);
    expect(count(html, "stats-fight-hidden")).toBe(1);
    expect(html).toContain("DM (direct)");
  });
});

describe("FR-STATS-24 states", () => {
  test("FR-STATS-24 states: skeleton rows while the first answer loads; 'Couldn't load stats' + Retry on an error; 'No fight yet'; 'No damage yet this fight'", () => {
    const loading = fightHtml(PLAYER, { status: "loading", result: null });
    expect(loading).toContain('data-testid="stats-loading"');
    const error = fightHtml(PLAYER, { status: "error", result: null });
    expect(error).toContain("Couldn&#x27;t load stats");
    expect(error).toContain('data-testid="stats-retry"');
    expect(error).not.toContain('data-testid="stats-loading"');
    const none = fightHtml(PLAYER, ok({ fight: null, fights: [] }));
    expect(none).toContain("No fight yet");
    const zero = fightHtml(
      PLAYER,
      ok({
        ...PLAYER_FIGHT,
        fight: {
          ...PLAYER_FIGHT.fight!,
          rows: [{ key: "t", name: "Thorn", kind: "pc", ...counts }],
        },
      }),
    );
    expect(zero).toContain("No damage yet this fight");
    expect(rowsOf(zero)).toHaveLength(1);
  });

  test("FR-STATS-70 no 'No damage yet' beside a kill: a players' fight whose only kill was the DM's damage shows the kill in Highlights and no copy", () => {
    const zeroRows = [{ key: "t", name: "Thorn", kind: "pc" as const, ...counts }];
    const kill = { fell: "kill" as const, from: null, to: "Goblin 1", callout: false };
    const ended = {
      ...PLAYER_FIGHT.fight!,
      status: "ended" as const,
      rows: zeroRows,
      highlights: { ...EMPTY_PLAYER_HIGHLIGHTS, kills: { events: [kill] } },
    };
    const html = fightHtml(PLAYER, ok({ ...PLAYER_FIGHT, fight: ended }));
    expect(html).not.toContain("No damage yet this fight");
    expect(html).toContain("Goblin 1 falls");
    // No event either: the copy.
    const empty = fightHtml(
      PLAYER,
      ok({ ...PLAYER_FIGHT, fight: { ...ended, highlights: EMPTY_PLAYER_HIGHLIGHTS } }),
    );
    expect(empty).toContain("No damage yet this fight");
  });

  test("FR-STATS-24 offline: the last result muted, the picker off, no error", () => {
    const html = fightHtml(PLAYER, { status: "error", result: PLAYER_FIGHT }, false);
    expect(html).toContain('data-state="offline"');
    expect(html).toContain("opacity-60");
    expect(html).not.toContain("Couldn&#x27;t load stats");
    expect(disabled(html, "stats-fight-picker")).toBe(true);
    expect(rowsOf(html)).toHaveLength(3);
  });
});

const award = (key: Award["key"], over: Partial<Award> = {}): Award => ({
  key,
  value: null,
  winners: [],
  ...over,
});
const SESSIONS: SessionsResult = {
  sessions: [
    {
      fromN: 50,
      toN: 60,
      from: "2026-10-21T18:00:00.000Z",
      to: "2026-10-21T19:00:00.000Z",
      fights: 1,
    },
    {
      fromN: 1,
      toN: 40,
      from: "2026-10-20T18:02:00.000Z",
      to: "2026-10-20T22:41:00.000Z",
      fights: 3,
    },
  ],
};
const SESSION: SessionResult = {
  session: {
    ...SESSIONS.sessions[1]!,
    awards: AWARD_KEYS.map((k) =>
      k === "biggest-hit"
        ? award(k, {
            value: 30,
            winners: [{ characterId: "thorn", name: "Thorn", playerId: "p2" }],
            detail: { from: "Thorn", to: "Goblin 1", raw: 30, fight: "Fight 2 · Tue 20 Oct" },
          })
        : k === "most-dealt"
          ? award(k, {
              value: 37,
              winners: [{ characterId: "mira", name: "Mira", playerId: "p1", with: ["Owlbear"] }],
            })
          : award(k),
    ),
  },
};
const sessionHtml = (
  you: You,
  session: { status: QueryStatus; result: SessionResult | null } = ok(SESSION),
  list: { status: QueryStatus; result: SessionsResult | null } = ok(SESSIONS),
  live = true,
) =>
  wrap(
    you,
    <SessionView
      role={you.role === "dm" ? "dm" : "player"}
      list={list}
      session={session}
      live={live}
      onPick={() => {}}
      onShowAwards={() => {}}
      retry={() => {}}
      now={new Date("2026-10-21T19:30:00.000Z")}
    />,
  );

describe("FR-STATS-19 session cards", () => {
  test("FR-STATS-19 session cards: 9 stats-award cards in award order (data-record-id = key) holding stats-award-value; winners in the player colour; companion roll-up; detail; empty line for nobody", () => {
    const html = sessionHtml(PLAYER);
    const keys = [...html.matchAll(/data-testid="stats-award" data-record-id="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(keys).toEqual([...AWARD_KEYS]);
    expect(count(html, "stats-award-value")).toBe(9);
    expect(html).toContain(">30 damage<");
    expect(html).toContain("Thorn → Goblin 1, 30, Fight 2 · Tue 20 Oct");
    expect(html).toContain("Mira + Owlbear");
    expect(html).toMatch(/data-record-id="thorn"[^>]*style="color:#2563eb"/);
    expect(html).toMatch(/data-record-id="mira"[^>]*style="color:#e11d48"/);
    expect(count(html, "stats-award-winner")).toBe(2);
    expect(html.split(">—<").length - 1).toBe(7);
    expect(html).toContain('data-testid="stats-session-picker"');
    // FR-STATS-67 (amends FR-STATS-19's columns): a container query on the board (the window
    // body less its 24 px padding): 3 ≥ 600 px of body, 2 ≥ 380, else 1; text wraps, never cut.
    expect(html).toContain("grid-cols-1");
    expect(html).toContain("@min-[356px]:grid-cols-2");
    expect(html).toContain("@min-[576px]:grid-cols-3");
    expect(html).not.toMatch(/data-testid="stats-award[a-z-]*"[^>]*class="[^"]*truncate/);
  });

  test("FR-STATS-19 DM-only button: Show awards for the DM (on when a session shows), never for a player", () => {
    expect(count(sessionHtml(DM), "stats-show-awards")).toBe(1);
    expect(disabled(sessionHtml(DM), "stats-show-awards")).toBe(false);
    expect(count(sessionHtml(PLAYER), "stats-show-awards")).toBe(0);
    const none = sessionHtml(DM, ok({ session: null }), ok({ sessions: [] }));
    expect(none).toContain("No sessions yet");
    expect(disabled(none, "stats-show-awards")).toBe(true);
  });

  test("FR-STATS-24 session states: skeleton while loading, error + Retry, offline muted with pickers off", () => {
    expect(sessionHtml(PLAYER, { status: "loading", result: null })).toContain(
      'data-testid="stats-loading"',
    );
    const err = sessionHtml(PLAYER, { status: "error", result: null });
    expect(err).toContain("Couldn&#x27;t load stats");
    const off = sessionHtml(DM, { status: "error", result: SESSION }, ok(SESSIONS), false);
    expect(off).toContain("opacity-60");
    expect(off).not.toContain("Couldn&#x27;t load stats");
    expect(disabled(off, "stats-session-picker")).toBe(true);
    expect(disabled(off, "stats-show-awards")).toBe(true);
  });

  test("FR-STATS-25 limits: ≤ 8 tied winners shown as sent, the rest as '+N more'", () => {
    const winners = Array.from({ length: 8 }, (_, i) => ({
      characterId: `c${i}`,
      name: `Hero ${i}`,
      playerId: null,
    }));
    const tied: SessionResult = {
      session: {
        ...SESSION.session!,
        awards: AWARD_KEYS.map((k) =>
          k === "most-kills" ? award(k, { value: 1, winners, more: 3 }) : award(k),
        ),
      },
    };
    const html = sessionHtml(PLAYER, ok(tied));
    expect(count(html, "stats-award-winner")).toBe(8);
    expect(html).toContain("+3 more");
  });
});

describe("Stats window", () => {
  test("FR-STATS-18 FR-STATS-19 tabs Fight, Session; the stored view picks the tab (FR-SHELL-94 writes it)", () => {
    const html = wrap(PLAYER, <StatsWindow />);
    expect(
      [...html.matchAll(/data-testid="stats-tab" data-value="(\w+)"/g)].map((m) => m[1]),
    ).toEqual(["fight", "session", "luck"]);
    expect(html).toContain('data-testid="stats-fight"');
    statsViews().set(viewKey(PLAYER), { tab: "session", sessionFromN: 1 });
    const after = wrap(PLAYER, <StatsWindow />);
    expect(after).toContain('data-testid="stats-session"');
    expect(after).not.toContain('data-testid="stats-fight"');
    statsViews().set(viewKey(PLAYER), { tab: "fight", sessionFromN: null });
  });
});

// ---------- sprint 8 (tier B) ----------

const ended = <F extends DmFightResult | PlayerFightResult>(f: F, highlights: unknown): F =>
  ({ ...f, fight: f.fight && { ...f.fight, status: "ended", highlights } }) as F;
const items = (html: string) =>
  [...html.matchAll(/data-testid="stats-highlight" data-record-id="([^"]+)"/g)].map((m) => m[1]);
const stateOf = (html: string, id: string) =>
  new RegExp(`<[^>]*data-testid="${id}"[^>]*>`).exec(html)?.[0].match(/data-state="(\w+)"/)?.[1];

describe("FR-STATS-36 Highlights", () => {
  test("FR-STATS-36 player: stats-highlights above the Fight table, open on an ended fight; items by key in order; Kills / Downs worded as the feed; no Still standing, no hidden mark", () => {
    const html = fightHtml(PLAYER, ok(ended(PLAYER_FIGHT, PLAYER_HIGHLIGHTS)));
    expect(stateOf(html, "stats-highlights")).toBe("open");
    expect(html.indexOf('data-testid="stats-highlights"')).toBeLessThan(
      html.indexOf('data-testid="stats-fight-table"'),
    );
    expect(items(html)).toEqual([
      "mvp",
      "biggest-hit",
      "biggest-overkill",
      "most-healing",
      "kills",
      "downed",
      "nat20",
      "rounds",
      "duration",
    ]);
    expect(html).toContain("Overkill! Thorn finished Goblin 1");
    expect(html).toContain("Goblin 2 dropped Brakka");
    expect(html).toContain("Mira + Owlbear");
    expect(html).toContain("12 min");
    expect(count(html, "stats-highlight-hidden")).toBe(0);
    expect(count(html, "stats-highlight-side")).toBe(0);
    expect(html).not.toContain("Still standing");
  });

  test("FR-STATS-36 DM: + Still standing with the hidden mark, the hidden kill marked, the overkill amount in the feed words", () => {
    const html = fightHtml(DM, ok(ended(DM_FIGHT, DM_HIGHLIGHTS)));
    expect(items(html)).toContain("standing");
    expect(count(html, "stats-highlight-side")).toBe(2);
    expect(html).toContain("Overkill! Thorn finished Goblin 1, overkill 23");
    expect(html).toContain("Thorn finished Elite (hidden)");
    expect(count(html, "stats-highlight-hidden")).toBe(1); // the Wolf still standing
  });

  test("FR-STATS-36 closed on a started fight (the summary opens it); the stored choice wins; nothing scored → no block", () => {
    const fight = PLAYER_FIGHT.fight;
    if (!fight) throw new Error("fixture");
    const started = { ...PLAYER_FIGHT, fight: { ...fight, highlights: PLAYER_HIGHLIGHTS } };
    expect(stateOf(fightHtml(PLAYER, ok(started)), "stats-highlights")).toBe("closed");
    expect(stateOf(fightHtml(PLAYER, ok(started), true, true), "stats-highlights")).toBe("open");
    expect(fightHtml(PLAYER, ok(PLAYER_FIGHT))).not.toContain('data-testid="stats-highlights"');
  });

  test("FR-STATS-48 limits: kills listed as sent (≤ 20), then '+N'; tied winners then '+N more'", () => {
    const events = Array.from({ length: 20 }, (_, i) => ({
      fell: "kill" as const,
      from: "Thorn",
      to: `Goblin ${i + 1}`,
      callout: false,
    }));
    const winners = Array.from({ length: 8 }, (_, i) => ({
      key: `c${i}`,
      name: `C${i}`,
      playerId: null,
    }));
    const many = {
      ...PLAYER_HIGHLIGHTS,
      kills: { events, more: 4 },
      mvp: { value: 10, winners, more: 2 },
    };
    const html = fightHtml(PLAYER, ok(ended(PLAYER_FIGHT, many)));
    expect(count(html, "stats-highlight-event")).toBe(21); // 20 kills + Brakka's down
    expect(html).toContain(">+4<");
    expect(html).toContain("+2 more");
  });
});

const luckRow = (key: string, name: string, over: Record<string, unknown> = {}) => ({
  key,
  name,
  playerId: null,
  rolls: 3,
  d20s: 4,
  avg: 10.5,
  nat20: 1,
  nat1: 0,
  ...over,
});
const PLAYER_LUCK: PlayerLuckResult = {
  luck: {
    scope: "campaign",
    rows: [luckRow("mira", "Mira", { playerId: "p1" }), luckRow("thorn", "Thorn", { avg: null })],
  },
};
const DM_LUCK: DmLuckResult = {
  luck: {
    scope: "session",
    fromN: 1,
    rows: [...PLAYER_LUCK.luck.rows, luckRow("dm-dice", "DM dice")],
  },
};
const luckHtml = (
  you: You,
  luck: { status: QueryStatus; result: DmLuckResult | PlayerLuckResult | null },
  live = true,
) =>
  wrap(
    you,
    <LuckView
      list={ok(SESSIONS)}
      luck={luck}
      live={live}
      onPick={() => {}}
      retry={() => {}}
      now={new Date("2026-10-22T12:00:00")}
    />,
  );
const luckRows = (html: string) =>
  [...html.matchAll(/data-testid="stats-luck-row" data-record-id="([^"]+)"/g)].map((m) => m[1]);

describe("FR-STATS-41 Luck tab", () => {
  test("FR-STATS-41 stats-luck: the scope picker, a stats-luck-table of stats-luck-row (data-record-id = character id) in ack order: Name, Rolls, d20s, Avg ('—' with none), Nat 20, Nat 1", () => {
    const html = luckHtml(PLAYER, ok(PLAYER_LUCK));
    expect(html).toContain('data-testid="stats-luck-scope"');
    expect(luckRows(html)).toEqual(["mira", "thorn"]);
    for (const h of ["Name", "Rolls", "d20s", "Avg", "Nat 20", "Nat 1"]) {
      expect(html).toContain(`>${h}<`);
    }
    expect(html).toContain(">10.5<");
    expect(html).toContain(">—<");
  });

  test("FR-STATS-39 DM dice: the DM's ack holds the dm-dice row, shown as sent; a player's never does", () => {
    expect(luckRows(luckHtml(DM, ok(DM_LUCK)))).toEqual(["mira", "thorn", "dm-dice"]);
    expect(luckHtml(PLAYER, ok(PLAYER_LUCK))).not.toContain("dm-dice");
  });

  test("FR-STATS-50 Luck states: skeleton while loading and while pending (FR-STATS-46), 'No rolls yet', error + Retry, offline muted with the picker off", () => {
    expect(luckHtml(PLAYER, { status: "loading", result: null })).toContain(
      'data-testid="stats-loading"',
    );
    const pending = luckHtml(
      PLAYER,
      ok<PlayerLuckResult>({ luck: { scope: "campaign", pending: true, rows: [] } }),
    );
    expect(pending).toContain('data-testid="stats-loading"');
    expect(stateOf(pending, "stats-luck")).toBe("pending");
    expect(
      luckHtml(PLAYER, ok<PlayerLuckResult>({ luck: { scope: "session", rows: [] } })),
    ).toContain("No rolls yet");
    expect(luckHtml(PLAYER, { status: "error", result: null })).toContain(
      'data-testid="stats-retry"',
    );
    const offline = luckHtml(PLAYER, ok(PLAYER_LUCK), false);
    expect(stateOf(offline, "stats-luck")).toBe("offline");
    expect(disabled(offline, "stats-luck-scope")).toBe(true);
    expect(offline).toContain("opacity-60");
  });
});
