// PARTY §13.1 unit (S5, P0): zod for `party.presentHandout` / `party.closePresent` / the share
// `present` flag, and the `handout-present` visibility fn (FR-PARTY-31).
import { describe, expect, test } from "bun:test";
import {
  ClosePresentIntent,
  HandoutPresentRecord,
  PresentHandoutIntent,
  SHARE_PLAYERS_MAX,
  ShareHandoutIntent,
} from "./schemas";
import { presentVisibility } from "./visibility";

const ok = (schema: { safeParse(v: unknown): { success: boolean } }, v: unknown) =>
  schema.safeParse(v).success;
const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);

describe("present intents (FR-PARTY-32, -33, -34)", () => {
  test("FR-PARTY-32 presentHandout: all, or 1–20 unique players; strict", () => {
    expect(ok(PresentHandoutIntent, { handoutId: "h", to: { mode: "all" } })).toBe(true);
    expect(
      ok(PresentHandoutIntent, { handoutId: "h", to: { mode: "players", playerIds: ["a"] } }),
    ).toBe(true);
    const players = (playerIds: string[]) => ({
      handoutId: "h",
      to: { mode: "players", playerIds },
    });
    expect(ok(PresentHandoutIntent, players(ids(SHARE_PLAYERS_MAX)))).toBe(true);
    for (const bad of [
      players([]),
      players(ids(SHARE_PLAYERS_MAX + 1)),
      players(["a", "a"]),
      { handoutId: "h", to: { mode: "all", playerIds: [] } },
      { handoutId: "h", to: { mode: "none" } },
      { handoutId: "h", to: { mode: "all" }, extra: 1 },
      { handoutId: "", to: { mode: "all" } },
      { to: { mode: "all" } },
    ])
      expect([bad, ok(PresentHandoutIntent, bad)]).toEqual([bad, false]);
  });

  test("FR-PARTY-33 share `present` flag: optional boolean; `none` + present → invalid", () => {
    const share = (mode: string, present?: unknown) => ({
      handoutId: "h",
      sharedWith: { mode, playerIds: mode === "players" ? ["a"] : [] },
      ...(present === undefined ? {} : { present }),
    });
    expect(ok(ShareHandoutIntent, share("all"))).toBe(true);
    expect(ok(ShareHandoutIntent, share("all", true))).toBe(true);
    expect(ok(ShareHandoutIntent, share("players", true))).toBe(true);
    expect(ok(ShareHandoutIntent, share("none", false))).toBe(true);
    expect(ok(ShareHandoutIntent, share("none"))).toBe(true);
    expect(ok(ShareHandoutIntent, share("none", true))).toBe(false);
    expect(ok(ShareHandoutIntent, share("all", "yes"))).toBe(false);
  });

  test("FR-PARTY-34 closePresent: exactly one of presentId / handoutId", () => {
    expect(ok(ClosePresentIntent, { presentId: "x" })).toBe(true);
    expect(ok(ClosePresentIntent, { handoutId: "h" })).toBe(true);
    for (const bad of [{}, { presentId: "x", handoutId: "h" }, { presentId: "" }, { id: "x" }])
      expect([bad, ok(ClosePresentIntent, bad)]).toEqual([bad, false]);
  });
});

describe("handout-present visibility (FR-PARTY-31)", () => {
  const row = HandoutPresentRecord.parse({
    id: "x",
    campaignId: "c",
    handoutId: "h",
    playerId: "p1",
    presentedAt: "2026-01-01T00:00:00.000Z",
  });
  test("FR-PARTY-31 DM full; the target player full; every other viewer hidden", () => {
    expect(presentVisibility(row, { role: "dm", playerId: null })).toBe("full");
    expect(presentVisibility(row, { role: "player", playerId: "p1" })).toBe("full");
    expect(presentVisibility(row, { role: "player", playerId: "p2" })).toBe("hidden");
    expect(presentVisibility(row, { role: "player", playerId: null })).toBe("hidden");
  });
});
