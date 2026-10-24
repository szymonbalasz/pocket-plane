// Stats Campaign tab (STATS §13.4 client, sprint 10 T3) as static renders over a fake sync store,
// per role: header, party table, records, awards won (FR-STATS-81–84), states (FR-STATS-87, -88),
// plus the pure tab rules: Campaign first and back to it on close (FR-STATS-85), live refresh.
import { describe, expect, test } from "bun:test";
import { GAME_LOG_ENTRY_TYPE } from "@shared/dice-roll-log/schemas";
import type { You } from "@shared/protocol/frames";
import { emptyStore } from "@shared/protocol/store";
import { type CampaignResult, CampaignResult as CampaignSchema } from "@shared/stats/schemas";
import { SyncContext, type SyncState } from "@ui/sync/store";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { CampaignView } from "./Campaign";
import {
  awardsWonText,
  campaignHeaderText,
  closedNow,
  DEFAULT_TAB,
  refreshes,
  STATS_TABS,
} from "./logic";
import type { QueryStatus } from "./refresh";
import { DEFAULT_VIEW } from "./view";

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
  return renderToStaticMarkup(<SyncContext.Provider value={store}>{node}</SyncContext.Provider>);
}

const row = (key: string, name: string, playerId: string, n: number[]) => {
  const [dealt, taken, healed, kills, downed, nat20, nat1, fights] = n as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  return { key, name, playerId, dealt, taken, healed, kills, downed, nat20, nat1, fights };
};
const who = (characterId: string, name: string, playerId: string) => ({
  characterId,
  name,
  playerId,
});

/** The DM's ack: the hidden Wolf's 30 and overkill amount count; names on fight labels. */
const DM_ACK: CampaignResult = CampaignSchema.parse({
  campaign: {
    sessions: 2,
    fights: 2,
    slain: 4,
    rows: [
      row("ch-mira", "Mira", "p1", [47, 40, 12, 3, 1, 0, 1, 2]),
      row("ch-thorn", "Thorn", "p2", [30, 4, 5, 1, 0, 2, 0, 2]),
    ],
    records: {
      "biggest-hit": {
        value: 30,
        ...who("ch-thorn", "Thorn", "p2"),
        to: "Goblin",
        fight: "Ambush at the Ford · Tue 20 Oct",
      },
      "biggest-overkill": {
        value: 23,
        ...who("ch-thorn", "Thorn", "p2"),
        to: "Goblin",
        fight: "Ambush at the Ford · Tue 20 Oct",
      },
      "best-fight-damage": {
        value: 30,
        ...who("ch-thorn", "Thorn", "p2"),
        fight: "Ambush at the Ford · Tue 20 Oct",
      },
      "best-fight-kills": {
        value: 2,
        ...who("ch-mira", "Mira", "p1"),
        fight: "Ford II · Wed 21 Oct",
      },
      "best-fight-healing": null,
    },
    awards: [
      {
        key: "ch-mira",
        name: "Mira",
        playerId: "p1",
        total: 11,
        won: [
          { key: "biggest-hit", count: 2 },
          { key: "most-kills", count: 2 },
          { key: "most-downed", count: 1 },
        ],
      },
    ],
  },
});

/** A player's: no hidden numbers; Biggest overkill = the callout line's damage. */
const PLAYER_ACK: CampaignResult = CampaignSchema.parse({
  campaign: {
    sessions: 2,
    fights: 2,
    slain: 3,
    rows: [
      row("ch-thorn", "Thorn", "p2", [30, 0, 5, 1, 0, 1, 0, 2]),
      row("ch-mira", "Mira", "p1", [17, 40, 12, 2, 1, 0, 1, 2]),
    ],
    records: {
      "biggest-hit": {
        value: 30,
        ...who("ch-thorn", "Thorn", "p2"),
        to: "Goblin",
        fight: "Fight 1 · Tue 20 Oct",
      },
      "biggest-overkill": {
        value: 30,
        ...who("ch-thorn", "Thorn", "p2"),
        to: "Goblin",
        fight: "Fight 1 · Tue 20 Oct",
      },
      "best-fight-damage": null,
      "best-fight-kills": null,
      "best-fight-healing": null,
    },
    awards: [],
  },
});

const ok = (result: CampaignResult | null, status: QueryStatus = "ok") => ({ status, result });
const render = (you: You, state: ReturnType<typeof ok>, live = true) =>
  wrap(
    you,
    <CampaignView
      role={you.role === "dm" ? "dm" : "player"}
      state={state}
      live={live}
      retry={() => {}}
    />,
  );
const attr = (html: string, id: string, name: string) =>
  new RegExp(`<[^>]*data-testid="${id}"[^>]*>`)
    .exec(html)?.[0]
    .match(new RegExp(`${name}="([^"]*)"`))?.[1];
const cells = (html: string, field: string) =>
  [...html.matchAll(new RegExp(`data-testid="stats-campaign-${field}"[^>]*>(\\d+)<`, "g"))].map(
    (m) => Number(m[1]),
  );
const recordValue = (html: string, key: string) =>
  new RegExp(
    `data-record-id="${key}"[\\s\\S]*?data-testid="stats-campaign-record-value"[^>]*>([^<]*)<`,
  ).exec(html)?.[1];
const text = (html: string) => html.replace(/<[^>]+>/g, "");

describe("FR-STATS-81 header", () => {
  test("FR-STATS-81 header line: sessions, fights, monsters slain (data attributes for the walkthrough)", () => {
    const html = render(DM, ok(DM_ACK));
    expect(attr(html, "stats-campaign-header", "data-slain")).toBe("4");
    expect(text(html)).toContain("2 sessions · 2 fights · 4 monsters slain");
    expect(campaignHeaderText({ sessions: 1, fights: 1, slain: 1 })).toBe(
      "1 session · 1 fight · 1 monster slain",
    );
  });
});

describe("FR-STATS-82 party table", () => {
  test("FR-STATS-82 rows in the ack's order (by Dealt), every column, names in the player colour; the table scrolls in its own box", () => {
    const html = render(DM, ok(DM_ACK));
    expect(
      [...html.matchAll(/data-testid="stats-campaign-row" data-record-id="([^"]+)"/g)].map(
        (m) => m[1],
      ),
    ).toEqual(["ch-mira", "ch-thorn"]);
    expect(cells(html, "dealt")).toEqual([47, 30]);
    expect(cells(html, "taken")).toEqual([40, 4]);
    expect(cells(html, "healed")).toEqual([12, 5]);
    expect(cells(html, "kills")).toEqual([3, 1]);
    expect(cells(html, "downed")).toEqual([1, 0]);
    expect(cells(html, "nat20")).toEqual([0, 2]);
    expect(cells(html, "nat1")).toEqual([1, 0]);
    expect(cells(html, "fights")).toEqual([2, 2]);
    expect(html).toContain("color:#e11d48");
    expect(attr(html, "stats-campaign-scroll", "class")).toContain("overflow-x-auto");
  });

  test("FR-STATS-82 a player's rows are the player ack's (no hidden numbers on the client)", () => {
    const html = render(PLAYER, ok(PLAYER_ACK));
    expect(cells(html, "dealt")).toEqual([30, 17]);
    expect(cells(html, "taken")).toEqual([0, 40]);
  });
});

describe("FR-STATS-83 records", () => {
  test("FR-STATS-83 five records in order with who and where; none = —; Biggest overkill per role (BL-103)", () => {
    const dm = render(DM, ok(DM_ACK));
    expect(
      [...dm.matchAll(/data-testid="stats-campaign-record" data-record-id="([^"]+)"/g)].map(
        (m) => m[1],
      ),
    ).toEqual([
      "biggest-hit",
      "biggest-overkill",
      "best-fight-damage",
      "best-fight-kills",
      "best-fight-healing",
    ]);
    expect(recordValue(dm, "biggest-hit")).toBe("30 damage");
    expect(recordValue(dm, "biggest-overkill")).toBe("23");
    expect(recordValue(dm, "best-fight-kills")).toBe("2 kills");
    expect(recordValue(dm, "best-fight-healing")).toBe("—");
    expect(text(dm)).toContain("Thorn → Goblin · Ambush at the Ford · Tue 20 Oct");
    expect(text(dm)).toContain("Mira Ford II · Wed 21 Oct");
    const player = render(PLAYER, ok(PLAYER_ACK));
    expect(recordValue(player, "biggest-overkill")).toBe("30 damage");
    expect(text(player)).toContain("Thorn → Goblin · Fight 1 · Tue 20 Oct");
  });
});

describe("FR-STATS-84 awards won", () => {
  test("FR-STATS-84 one compact line per character: total, then the awards in card order (×N above 1); none → No awards yet", () => {
    const html = render(DM, ok(DM_ACK));
    expect(text(html)).toContain("Mira 11: Biggest hit ×2 · Most kills ×2 · Most times downed");
    expect(awardsWonText({ won: [{ key: "most-nat20", count: 1 }] })).toBe("Most nat 20s");
    expect(render(PLAYER, ok(PLAYER_ACK))).toContain("No awards yet");
  });
});

describe("FR-STATS-87 FR-STATS-88 states", () => {
  test("FR-STATS-87 loading, pending (skeleton), error + Retry, offline muted, no fights yet", () => {
    expect(render(DM, ok(null, "loading"))).toContain('data-testid="stats-loading"');
    const pending = render(DM, ok({ campaign: { pending: true } }));
    expect(attr(pending, "stats-campaign", "data-state")).toBe("pending");
    expect(pending).toContain('data-testid="stats-loading"');
    const failed = render(DM, ok(null, "error"));
    expect(failed).toContain('data-testid="stats-error"');
    expect(failed).toContain('data-testid="stats-retry"');
    const offline = render(DM, ok(DM_ACK), false);
    expect(attr(offline, "stats-campaign", "data-state")).toBe("offline");
    expect(offline).toContain("opacity-60");
    const empty = CampaignSchema.parse({
      campaign: {
        ...(PLAYER_ACK.campaign as object),
        fights: 0,
        slain: 0,
        rows: [],
        records: Object.fromEntries(
          Object.keys((PLAYER_ACK.campaign as { records: object }).records).map((k) => [k, null]),
        ),
      },
    });
    const none = render(PLAYER, ok(empty));
    expect(none).toContain("No fights yet");
    expect(none).not.toContain('data-testid="stats-campaign-table"');
  });
});

describe("FR-STATS-85 tab order and default", () => {
  test("FR-STATS-85 Campaign first and the default view's tab", () => {
    expect(STATS_TABS[0]).toBe("campaign");
    expect(DEFAULT_TAB).toBe("campaign");
    expect(DEFAULT_VIEW.tab).toBe("campaign");
  });

  test("FR-STATS-85 a close (not a minimise or put-away) sends the tab back to Campaign", () => {
    expect(closedNow("open", "closed")).toBe(true);
    expect(closedNow("minimised", "closed")).toBe(true);
    expect(closedNow("open", undefined)).toBe(true);
    expect(closedNow("open", "minimised")).toBe(false);
    expect(closedNow("minimised", "open")).toBe(false);
    expect(closedNow("closed", "open")).toBe(false);
    expect(closedNow(undefined, "open")).toBe(false);
  });

  test("FR-STATS-87 live refresh: any game-log upsert re-queries the Campaign tab; other frames don't", () => {
    const frame = (type: string) => ({
      cause: { name: "X" },
      changes: [
        {
          type,
          op: "upsert" as const,
          id: "e1",
          data: { id: "e1", rollIds: [], encounterId: null },
        },
      ],
    });
    const view = { tab: "campaign" as const, pickedFight: null };
    expect(refreshes(frame(GAME_LOG_ENTRY_TYPE) as never, view)).toBe(true);
    expect(refreshes(frame("token") as never, view)).toBe(false);
  });
});
