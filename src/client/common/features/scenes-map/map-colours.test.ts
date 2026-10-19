// FR-MAP-68–70, -72, -73 (sprint 5, K3): pings, laser trails, drag paths and trails resolve their
// person's colour at draw time with CAMP's `colorOf` (no DOM: `read` is injected, so every key
// falls back to the palette hex). Store over `player-colours`' shape: Player 1 jade, Player 2
// blue, the DM amber.
import { describe, expect, test } from "bun:test";
import { PLAYER_COLORS } from "@shared/campaign-management/colors";
import { applySnapshot, type RecordStore } from "@shared/protocol/store";
import type { TokenView } from "@shared/scenes-map/schemas";
import { ROLE_ACCENT_FALLBACK } from "../campaign-management/colors";
import { pathPaint } from "./drag-path";
import { LASER_FADE_MS } from "./laser";
import { CASING_COLOR, CASING_EXTRA_PX, casingWidth, markColor } from "./mark-colors";
import {
  addPing,
  addTrailPoints,
  createPointerStore,
  PING_MS,
  pingMark,
  SELF_KEY,
  senderKey,
  trailMark,
} from "./pointers";

const none = () => "";

function store(colors: { p1: string; p2: string; dm: string }, role: "dm" | "player" = "dm") {
  return applySnapshot({
    type: "snapshot",
    seq: 0,
    you: { campaignId: "c1", role, playerId: role === "dm" ? null : "p1" },
    records: {
      campaign: [{ id: "c1", name: "Fixture Campaign", dmColor: colors.dm }],
      player: [
        { id: "p1", campaignId: "c1", name: "Player 1", color: colors.p1 },
        { id: "p2", campaignId: "c1", name: "Player 2", color: colors.p2 },
      ],
    },
  } as never) as RecordStore;
}

const S = store({ p1: "jade", p2: "blue", dm: "amber" });
const P1 = { role: "player" as const, playerId: "p1" };
const DM = { role: "dm" as const };

const tok = (id: string, ownerPlayerId: string | null) => ({ id, ownerPlayerId }) as TokenView;

describe("FR-MAP-68 laser colour", () => {
  test("FR-MAP-68 laser colour: received trail → sender's hex via colorOf, chip = sender's name; own → own colour, no chip; fades with the trail", () => {
    const ptr = createPointerStore();
    addTrailPoints(ptr, senderKey(P1), P1, [[10, 10]], false, 0);
    addTrailPoints(ptr, senderKey(DM), DM, [[20, 20]], false, 0);
    addTrailPoints(ptr, SELF_KEY, P1, [[30, 30]], false, 0);
    const { trails } = ptr.getState();
    const m = (k: string, now = 0) => trailMark(trails[k] as never, S, now, none);
    expect(m("player:p1")).toMatchObject({
      id: "player:p1",
      color: PLAYER_COLORS.jade,
      by: "p1",
      chip: "Player 1",
      opacity: 1,
    });
    expect(m("dm")).toMatchObject({ color: PLAYER_COLORS.amber, by: "dm", chip: "DM" });
    // Own trail: own colour, `by` = own id (no `self`), no chip.
    expect(m(SELF_KEY)).toMatchObject({
      id: "player:p1",
      color: PLAYER_COLORS.jade,
      by: "p1",
      chip: null,
    });
    // Chip and trail share one opacity: half-way through the fade, then gone.
    expect(m("player:p1", LASER_FADE_MS / 2).opacity).toBeCloseTo(0.5);
    expect(m("player:p1", LASER_FADE_MS).opacity).toBe(0);
  });
});

describe("FR-MAP-69 ping colour", () => {
  test("FR-MAP-69 ping colour: pulse + chip in the sender's colour; pull = the DM colour; the store keeps {role, playerId}; own: no chip", () => {
    const ptr = createPointerStore();
    addPing(ptr, 1, 2, P1, 0);
    addPing(ptr, 3, 4, DM, 0); // a pull draws the same pulse from the DM
    addPing(ptr, 5, 6, { role: "player", playerId: "p2" }, 0, true);
    const [a, b, c] = ptr.getState().pings;
    expect(a?.from).toEqual(P1);
    expect(pingMark(a as never, S, 0, none)).toMatchObject({
      id: expect.stringMatching(/^player:p1:\d+$/),
      color: PLAYER_COLORS.jade,
      by: "p1",
      chip: "Player 1",
      t: 0,
    });
    expect(pingMark(b as never, S, PING_MS / 2, none)).toMatchObject({
      color: PLAYER_COLORS.amber,
      by: "dm",
      chip: "DM",
      t: 0.5,
    });
    expect(pingMark(c as never, S, 0, none)).toMatchObject({
      color: PLAYER_COLORS.blue,
      chip: null,
    });
  });
});

describe("FR-MAP-70 path colour", () => {
  test("FR-MAP-70 path colour: Mira = player-1's whoever drags; Thorn = player-2's; unowned Goblin Sneak = the DM's; the same on a player client", () => {
    const mira = tok("mira", "p1");
    const thorn = tok("thorn", "p2");
    const goblin = tok("goblin-sneak", null);
    // No dragger in the input: the DM dragging Mira paints it as player-1 dragging it would.
    expect(pathPaint(S, mira, none)).toEqual({ color: PLAYER_COLORS.jade, by: "p1" });
    expect(pathPaint(S, thorn, none)).toEqual({ color: PLAYER_COLORS.blue, by: "p2" });
    expect(pathPaint(S, goblin, none)).toEqual({ color: PLAYER_COLORS.amber, by: "dm" });
    const asPlayer = store({ p1: "jade", p2: "blue", dm: "amber" }, "player");
    expect(pathPaint(asPlayer, mira, none)).toEqual(pathPaint(S, mira, none));
    // A token the store lost (mid-drag) → the DM colour, never a throw.
    expect(pathPaint(S, undefined, none).by).toBe("dm");
  });
});

describe("FR-MAP-72 casing", () => {
  test("FR-MAP-72 casing: opaque black, 2 screen px wider than the stroke at any zoom; unknown colour → role accent", () => {
    expect(CASING_COLOR).toBe("#000");
    for (const scale of [0.5, 1, 2.5]) {
      for (const stroke of [1.5, 2, 3, 4]) {
        expect(casingWidth(stroke, scale) * scale).toBeCloseTo(stroke + CASING_EXTRA_PX);
      }
    }
    // A sender with no `player` record yet (added since the snapshot) or an unknown key.
    const odd = store({ p1: "magenta", p2: "blue", dm: "teal" });
    expect(markColor(odd, P1, none)).toBe(ROLE_ACCENT_FALLBACK.player);
    expect(markColor(odd, DM, none)).toBe(ROLE_ACCENT_FALLBACK.dm);
    expect(markColor(S, { role: "player", playerId: "p9" }, none)).toBe(
      ROLE_ACCENT_FALLBACK.player,
    );
  });
});

describe("FR-MAP-73 recolour", () => {
  test("FR-MAP-73 recolour: a `player` / `campaign` upsert changes the drawn colour of live pings, trails and paths with no new signal", () => {
    const ptr = createPointerStore();
    addPing(ptr, 1, 2, P1, 0);
    addTrailPoints(ptr, senderKey(DM), DM, [[1, 1]], false, 0);
    const before = ptr.getState();
    const after = store({ p1: "rose", p2: "blue", dm: "yellow" });
    const ping = before.pings[0] as never;
    const trail = before.trails.dm as never;
    expect(pingMark(ping, S, 0, none).color).toBe(PLAYER_COLORS.jade);
    expect(pingMark(ping, after, 0, none).color).toBe(PLAYER_COLORS.rose);
    expect(trailMark(trail, after, 0, none).color).toBe(PLAYER_COLORS.yellow);
    expect(pathPaint(after, tok("mira", "p1"), none).color).toBe(PLAYER_COLORS.rose);
    // The pointer store itself never changed: nothing colour-shaped is kept per mark.
    expect(ptr.getState()).toBe(before);
    expect(JSON.stringify(before)).not.toContain("color");
  });
});
