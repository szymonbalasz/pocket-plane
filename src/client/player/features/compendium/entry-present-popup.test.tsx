// Player entry popup (FR-CMP-80, -83; DM #458): which row it shows (own row only, after a
// presented handout, not while paused, not after a local close in this snapshot generation) and
// its title. The Dialog itself, Close and "Open in Compendium": e2e/cmp-item-present.e2e.ts.
import { describe, expect, test } from "bun:test";
import type { EntryPresentRecord } from "@shared/compendium/present";
import type { HandoutPresentRecord } from "@shared/party-board/schemas";
import { entryPresentTitle, entryPresentToShow } from "./entry-present-popup";

const row = (id: string, playerId: string, at = "t1"): EntryPresentRecord => ({
  id,
  campaignId: "c1",
  entryId: "e-lantern",
  playerId,
  presentedAt: at,
});
const handout: HandoutPresentRecord = {
  id: "hp1",
  campaignId: "c1",
  handoutId: "h2",
  playerId: "p1",
  presentedAt: "t0",
};
const P1 = { role: "player", playerId: "p1" };

describe("FR-CMP-80 entry popup", () => {
  test("FR-CMP-80 shows the viewer's own row; nothing for the DM or another player's row", () => {
    expect(entryPresentToShow([row("a", "p1")], [], P1, {}, 1, false)?.id).toBe("a");
    expect(entryPresentToShow([row("b", "p2")], [], P1, {}, 1, false)).toBeNull();
    expect(
      entryPresentToShow([row("a", "p1")], [], { role: "dm", playerId: null }, {}, 1, false),
    ).toBeNull();
    expect(entryPresentToShow([row("a", "p1")], [], null, {}, 1, false)).toBeNull();
  });

  test("FR-CMP-80 waits while a presented handout shows, and while paused", () => {
    expect(entryPresentToShow([row("a", "p1")], [handout], P1, {}, 1, false)).toBeNull();
    // The handout closed on this page → the entry shows.
    expect(entryPresentToShow([row("a", "p1")], [handout], P1, { hp1: 1 }, 1, false)?.id).toBe("a");
    expect(entryPresentToShow([row("a", "p1")], [], P1, {}, 1, true)).toBeNull();
  });

  test("FR-CMP-81 a local close hides it until the next snapshot generation", () => {
    expect(entryPresentToShow([row("a", "p1")], [], P1, { a: 1 }, 1, false)).toBeNull();
    expect(entryPresentToShow([row("a", "p1")], [], P1, { a: 1 }, 2, false)?.id).toBe("a");
  });

  test("FR-CMP-80 title: an award for items, else From the DM", () => {
    expect(entryPresentTitle("item")).toBe("The party receives");
    expect(entryPresentTitle("spell")).toBe("From the DM");
  });
});
