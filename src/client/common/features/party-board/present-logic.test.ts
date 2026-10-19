// Handout present client rules (PARTY §13.1 unit): popup logic (row → load → show, row replaced →
// swap, row deleted → close, load without the id → close, local hide until the next snapshot,
// `hideToast` targets, layer), DM controls (Share tick gainers, Open on screens… payload,
// On screen rows).
import { describe, expect, test } from "bun:test";
import type { NotificationRecord } from "@shared/notifications/schemas";
import type { HandoutPresentRecord, SharedWith } from "@shared/party-board/schemas";
import { DICE_LAYER_Z } from "../dice-extras/DiceLayer";
import { sharePayload } from "./logic";
import {
  contentState,
  draftGainers,
  EMPTY_PRESENT_DRAFT,
  hiddenLocally,
  hidePresent,
  NOBODY_NEW,
  onScreenNames,
  onScreenText,
  opensOnText,
  ownPresent,
  PRESENT_POPUP_Z,
  pageText,
  presentCandidates,
  presentEnabled,
  presentFlag,
  presentHides,
  presentPayload,
  presentsOf,
  sharedNoteIds,
  shownPresent,
  stepPage,
  withHide,
} from "./present-logic";

const row = (
  id: string,
  handoutId: string,
  playerId: string,
  presentedAt = "2026-10-19T10:00:00.000Z",
): HandoutPresentRecord => ({ id, campaignId: "c1", handoutId, playerId, presentedAt });

const note = (id: string, kind: string, payload: unknown) =>
  ({ id, kind, payload }) as NotificationRecord;

const PLAYERS = [
  { id: "p1", name: "Mira" },
  { id: "p2", name: "Thorn" },
  { id: "p3", name: "Ash" },
];
const NONE: SharedWith = { mode: "none", playerIds: [] };
const ALL: SharedWith = { mode: "all", playerIds: [] };
const P1: SharedWith = { mode: "players", playerIds: ["p1"] };
const ORDER = PLAYERS.map((p) => p.id);

describe("FR-PARTY-36 popup logic", () => {
  test("FR-PARTY-36 row → load → show; own row only", () => {
    const r = row("pr1", "h2", "p1");
    expect(shownPresent([r], "p1", {}, 1)).toEqual(r);
    expect(shownPresent([r], "p2", {}, 1)).toBeNull();
    expect(shownPresent([r], null, {}, 1)).toBeNull();
    expect(contentState({ state: "loading", loaded: false })).toBe("loading");
    expect(contentState({ state: "ready", loaded: true })).toBe("show");
    expect(contentState({ state: "error", loaded: false })).toBe("error");
  });

  test("FR-PARTY-36 row replaced → swap (newest wins); row deleted → close", () => {
    const old = row("pr1", "h2", "p1", "2026-10-19T10:00:00.000Z");
    const next = row("pr2", "h1", "p1", "2026-10-19T10:05:00.000Z");
    expect(ownPresent([old, next], "p1")?.id).toBe("pr2");
    expect(ownPresent([next, old], "p1")?.id).toBe("pr2");
    expect(shownPresent([next], "p1", {}, 1)?.handoutId).toBe("h1");
    expect(shownPresent([], "p1", {}, 1)).toBeNull();
  });

  test("FR-PARTY-36 load without the id → gone (close silently + intent)", () => {
    expect(contentState({ state: "ready", loaded: false })).toBe("gone");
  });

  test("FR-PARTY-37 local hide until the next snapshot; a re-present shows again", () => {
    const r = row("pr1", "h2", "p1");
    const hides = withHide({}, "pr1", 3);
    expect(hiddenLocally(hides, "pr1", 3)).toBe(true);
    expect(shownPresent([r], "p1", hides, 3)).toBeNull();
    // Next snapshot (generation 4): the close never reached the server → shows again.
    expect(shownPresent([r], "p1", hides, 4)).toEqual(r);
    // A new present has a new id → not hidden.
    expect(shownPresent([row("pr9", "h2", "p1")], "p1", hides, 3)?.id).toBe("pr9");
    // Older generations are dropped on the next hide.
    expect(withHide(hides, "pr2", 4)).toEqual({ pr2: 4 });
    expect(withHide(hides, "pr2", 3)).toEqual({ pr1: 3, pr2: 3 });
    // The page store.
    presentHides.setState({ hides: {} });
    hidePresent("pr1", 7);
    expect(presentHides.getState().hides).toEqual({ pr1: 7 });
  });

  test("FR-PARTY-36 hideToast targets the handout-shared notifications of the same handout", () => {
    const notes = [
      note("n1", "handout-shared", { handoutId: "h2" }),
      note("n2", "handout-shared", { handoutId: "h1" }),
      note("n3", "loot-received", { handoutId: "h2" }),
      note("n4", "handout-shared", { handoutId: "h2" }),
      note("n5", "handout-shared", null),
    ];
    expect(sharedNoteIds(notes, "h2")).toEqual(["n1", "n4"]);
  });

  test("FR-PARTY-36 dialog layer: over every toast (sonner 999 999 999), under the dice layer", () => {
    expect(PRESENT_POPUP_Z).toBeGreaterThan(999_999_999);
    expect(PRESENT_POPUP_Z).toBeLessThan(DICE_LAYER_Z);
  });

  test("FR-PARTY-36 image pager: ‹n› / ‹N›, clamped", () => {
    expect(pageText(0, 3)).toBe("1 / 3");
    expect(stepPage(0, -1, 3)).toBe(0);
    expect(stepPage(0, 1, 3)).toBe(1);
    expect(stepPage(2, 1, 3)).toBe(2);
  });
});

describe("FR-PARTY-38 DM controls", () => {
  test("FR-PARTY-38 (a) Share tick: gainers named; Nobody new; counts only when shown and enabled", () => {
    const toP1 = draftGainers(
      NONE,
      sharePayload({ mode: "players", playerIds: ["p1"] }, ORDER),
      PLAYERS,
    );
    expect(opensOnText(toP1)).toBe("Opens on: Mira");
    // players [p1] → all: Thorn and Ash are new; Mira already had it (review #23).
    const toAll = draftGainers(P1, sharePayload({ mode: "all", playerIds: [] }, ORDER), PLAYERS);
    expect(toAll.map((p) => p.id)).toEqual(["p2", "p3"]);
    expect(opensOnText(toAll)).toBe("Opens on: Thorn, Ash");
    // Unchanged / narrowing → nobody new.
    expect(
      opensOnText(
        draftGainers(ALL, sharePayload({ mode: "players", playerIds: ["p1"] }, ORDER), PLAYERS),
      ),
    ).toBe(NOBODY_NEW);
    // Invalid draft (Chosen, none ticked) → nobody.
    expect(
      draftGainers(NONE, sharePayload({ mode: "players", playerIds: [] }, ORDER), PLAYERS),
    ).toEqual([]);
    expect(presentFlag(true, "players", 1)).toBe(true);
    expect(presentFlag(false, "players", 1)).toBe(false);
    expect(presentFlag(true, "none", 1)).toBe(false);
    expect(presentFlag(true, "all", 0)).toBe(false);
  });

  test("FR-PARTY-38 (b) Open on screens…: candidates who can see it; payload; Open disabled", () => {
    expect(presentCandidates(P1, PLAYERS).map((p) => p.id)).toEqual(["p1"]);
    expect(presentCandidates(ALL, PLAYERS)).toHaveLength(3);
    expect(presentCandidates(NONE, PLAYERS)).toEqual([]);
    const live = { live: true, busy: false };
    expect(presentPayload(EMPTY_PRESENT_DRAFT, PLAYERS)).toEqual({
      ok: true,
      value: { mode: "all" },
    });
    expect(presentEnabled(EMPTY_PRESENT_DRAFT, PLAYERS, live)).toBe(true);
    // Chosen with none ticked → disabled.
    const chosen = { mode: "players" as const, playerIds: [] };
    expect(presentEnabled(chosen, PLAYERS, live)).toBe(false);
    // Ticks count in candidate order; a non-candidate tick is ignored.
    const ticked = { mode: "players" as const, playerIds: ["p3", "p1", "gone"] };
    expect(presentPayload(ticked, PLAYERS)).toEqual({
      ok: true,
      value: { mode: "players", playerIds: ["p1", "p3"] },
    });
    expect(presentEnabled(ticked, PLAYERS, live)).toBe(true);
    expect(presentEnabled(ticked, PLAYERS, { live: false, busy: false })).toBe(false);
    expect(presentEnabled(ticked, PLAYERS, { live: true, busy: true })).toBe(false);
    expect(presentEnabled(EMPTY_PRESENT_DRAFT, [], live)).toBe(false);
  });

  test("FR-PARTY-38 (c) On screen: the handout's rows in present order, names in the Tooltip", () => {
    const rows = [
      row("a", "h2", "p2", "2026-10-19T10:05:00.000Z"),
      row("b", "h1", "p3"),
      row("c", "h2", "p1", "2026-10-19T10:01:00.000Z"),
    ];
    const of = presentsOf(rows, "h2");
    expect(of.map((r) => r.id)).toEqual(["c", "a"]);
    expect(onScreenText(of.length)).toBe("On screen: 2");
    const names = new Map(PLAYERS.map((p) => [p.id, p.name]));
    expect(onScreenNames(of, (id) => names.get(id))).toBe("Mira, Thorn");
    expect(presentsOf(rows, "h9")).toEqual([]);
  });
});
