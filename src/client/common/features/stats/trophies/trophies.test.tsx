// The sheet's Trophies tab (FR-CHARX-97–99, FR-STATS-42, -44, -50): the registry line (last tab,
// order 100, characters only), the layout as a static render of the ack per role, "—" for 0, the
// refresh rule and the states. The data is an ack as the server sends it.
import { describe, expect, test } from "bun:test";
import { LOG_KIND_ATTACK } from "@shared/combat-tracker/schemas";
import { GAME_LOG_ENTRY_TYPE } from "@shared/dice-roll-log/schemas";
import { emptyStore } from "@shared/protocol/store";
import type { TrophiesResult } from "@shared/stats/schemas";
import { renderToStaticMarkup } from "react-dom/server";
import { sectionsFor } from "../../character-sheet/sections";
import { sheetSections } from "../../character-sheet/sheet-sections";
import type { QueryStatus } from "../refresh";
import { lifetimeText, recordText, trophiesRefresh } from "./logic";
import { statsTrophiesSection, TrophiesView } from "./TrophiesTab";

const TROPHIES: TrophiesResult = {
  trophies: {
    characterId: "mira",
    lifetime: {
      avgD20: 11.25,
      nat20: 2,
      nat1: 0,
      fights: 3,
      dealt: 61,
      taken: 14,
      healing: 0,
      kills: 3,
      downed: 0,
    },
    records: {
      "biggest-hit": { value: 25, to: "Bandit", fight: "Fight 2 · Thu 1 Jan" },
      "biggest-overkill": { value: 25, to: "Bandit", fight: "Fight 2 · Thu 1 Jan" },
      "best-fight-damage": { value: 36, fight: "Fight 2 · Thu 1 Jan" },
      "best-fight-kills": null,
    },
  },
};

const html = (
  client: "dm" | "player",
  state: { status: QueryStatus; result: TrophiesResult | null },
  live = true,
) =>
  renderToStaticMarkup(
    <TrophiesView client={client} characterId="mira" state={state} live={live} retry={() => {}} />,
  );
const trophy = (h: string, key: string) =>
  new RegExp(`data-testid="stats-trophy" data-record-id="${key}" data-value="([^"]*)"`).exec(
    h,
  )?.[1];
const count = (h: string, id: string) => h.split(`data-testid="${id}"`).length - 1;

describe("FR-CHARX-97 trophies tab", () => {
  test("FR-CHARX-97 trophies tab: stats.trophies is the last tab on a character's full sheet for the DM and the owner ('Trophies', order 100); never on a monster", () => {
    expect(statsTrophiesSection).toMatchObject({
      id: "stats.trophies",
      slot: "tab",
      order: 100,
      title: "Trophies",
      kinds: ["character"],
    });
    expect(statsTrophiesSection.clients).toBeUndefined(); // both clients
    expect(statsTrophiesSection.available).toBeUndefined(); // always
    for (const client of ["dm", "player"] as const) {
      const tabs = sectionsFor(sheetSections, {
        slot: "tab",
        client,
        kind: "character",
        store: emptyStore(),
        creatureId: "mira",
      });
      expect(tabs.at(-1)?.id).toBe("stats.trophies");
      const monster = sectionsFor(sheetSections, {
        slot: "tab",
        client,
        kind: "monster",
        store: emptyStore(),
        creatureId: "goblin",
      });
      expect(monster.map((s) => s.id)).not.toContain("stats.trophies");
    }
  });
});

describe("FR-CHARX-98 trophies layout", () => {
  test("FR-CHARX-98 trophies layout: stats-trophies (data-record-id = character), Lifetime grid (2 columns, 1 under 360 px), Records with detail lines, the footnote; the DM's adds 'Includes hidden rolls and fights'", () => {
    const p = html("player", { status: "ok", result: TROPHIES });
    expect(p).toContain('data-testid="stats-trophies" data-record-id="mira"');
    expect(p).toMatch(/grid-cols-1 [^"]*@min-\[360px\]:grid-cols-2/);
    expect(count(p, "stats-trophy")).toBe(13);
    expect(trophy(p, "avgD20")).toBe("11.3");
    expect(trophy(p, "nat20")).toBe("2");
    expect(trophy(p, "biggest-hit")).toBe("25");
    expect(p).toContain("→ Bandit · Fight 2 · Thu 1 Jan");
    expect(count(p, "stats-trophy-detail")).toBe(3);
    expect(p).toContain("Whole campaign, counted from the game log");
    expect(p).not.toContain("Includes hidden rolls and fights");
    expect(html("dm", { status: "ok", result: TROPHIES })).toContain(
      "Includes hidden rolls and fights",
    );
  });

  test("FR-STATS-42 '—' for 0 or none, Avg d20 with 1 decimal; a record without a target shows its fight only", () => {
    const p = html("player", { status: "ok", result: TROPHIES });
    expect(trophy(p, "nat1")).toBe("—");
    expect(trophy(p, "healing")).toBe("—");
    expect(trophy(p, "best-fight-kills")).toBe("—");
    const l = TROPHIES.trophies.lifetime;
    if (!l) throw new Error("fixture");
    expect(lifetimeText("avgD20", { ...l, avgD20: null })).toBe("—");
    expect(recordText({ value: 36, fight: "Fight 2" })).toEqual({ value: "36", detail: "Fight 2" });
    expect(recordText(null)).toEqual({ value: "—", detail: null });
  });

  test("FR-CHARX-98 BL-103 Biggest overkill trophy: a player's reads 'N damage' (the callout line's), the DM's the bare amount", () => {
    expect(trophy(html("player", { status: "ok", result: TROPHIES }), "biggest-overkill")).toBe(
      "25 damage",
    );
    expect(trophy(html("dm", { status: "ok", result: TROPHIES }), "biggest-overkill")).toBe("25");
    expect(trophy(html("player", { status: "ok", result: TROPHIES }), "biggest-hit")).not.toContain(
      "damage",
    );
    expect(recordText(null, "biggest-overkill", "player")).toEqual({ value: "—", detail: null });
  });

  test("FR-STATS-50 trophies states: skeleton while loading and pending, error + Retry, 'No fights yet' at 0 fights, offline muted", () => {
    expect(html("player", { status: "loading", result: null })).toContain(
      'data-testid="stats-loading"',
    );
    const pending = html("player", {
      status: "ok",
      result: { trophies: { characterId: "mira", pending: true } },
    });
    expect(pending).toContain('data-testid="stats-loading"');
    expect(pending).toContain('data-state="pending"');
    expect(html("player", { status: "error", result: null })).toContain(
      'data-testid="stats-retry"',
    );
    const l = TROPHIES.trophies.lifetime;
    if (!l) throw new Error("fixture");
    const none = {
      trophies: { ...TROPHIES.trophies, lifetime: { ...l, fights: 0 } },
    };
    expect(html("player", { status: "ok", result: none })).toContain("No fights yet");
    const offline = html("player", { status: "ok", result: TROPHIES }, false);
    expect(offline).toContain('data-state="offline"');
    expect(offline).toContain("opacity-60");
  });
});

describe("FR-STATS-42 BL-121 withheld records", () => {
  test("FR-STATS-42 BL-121 records the player ack leaves out have no row; none left → no Records section; Lifetime stays", () => {
    const some: TrophiesResult = {
      trophies: { ...TROPHIES.trophies, records: { "best-fight-kills": null } },
    };
    const h = html("player", { status: "ok", result: some });
    expect(trophy(h, "best-fight-kills")).toBe("—");
    expect(trophy(h, "biggest-hit")).toBeUndefined();
    const none: TrophiesResult = { trophies: { ...TROPHIES.trophies, records: {} } };
    const n = html("player", { status: "ok", result: none });
    expect(n).not.toContain(">Records<");
    expect(count(n, "stats-trophy")).toBe(9);
    expect(n).not.toMatch(/withheld|hidden/i);
  });
});

describe("FR-STATS-44 trophies refresh", () => {
  const frame = (actorName: string, targetName: string) => ({
    cause: { name: "AttackApplied" },
    changes: [
      {
        type: GAME_LOG_ENTRY_TYPE,
        id: "e1",
        op: "upsert" as const,
        data: { id: "e1", kind: LOG_KIND_ATTACK, actorName, payload: { targetName }, rollIds: [] },
      },
    ],
  });
  test("FR-STATS-44 a live line of the character or its companions refreshes (as actor or target); anyone else's doesn't", () => {
    const names = new Set(["Mira", "Owlbear"]);
    expect(trophiesRefresh(frame("Mira", "Goblin 1"), names)).toBe(true);
    expect(trophiesRefresh(frame("Owlbear", "Bandit 3"), names)).toBe(true);
    expect(trophiesRefresh(frame("Goblin 2", "Mira"), names)).toBe(true);
    expect(trophiesRefresh(frame("Thorn", "Goblin 1"), names)).toBe(false);
    expect(trophiesRefresh(frame("Mira", "Goblin 1"), new Set())).toBe(false);
  });
});
