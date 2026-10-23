// PARTY §13 client unit tests (handouts): list order per role, New / Updated marks from seen
// revs (bad storage → memory), share drafts and locks, editor drafts, activity, window geometry.
import { describe, expect, test } from "bun:test";
import {
  HANDOUT_IMAGES_MAX,
  HANDOUT_TYPE,
  type HandoutRecord,
  type SharedWith,
} from "@shared/party-board/schemas";
import { emptyStore } from "@shared/protocol/store";
import { IntentRejected } from "../../sync/connection";
import {
  addImage,
  bodyCounter,
  choseEveryone,
  dmOrder,
  draftUnchanged,
  handoutActivity,
  handoutIdOf,
  handoutPayload,
  intentFailure,
  LOST_SAVE,
  markOf,
  moveImage,
  playerOrder,
  removeImage,
  shareEnabled,
  sharePayload,
  togglePlayer,
} from "./logic";
import { PARTY_TAB_ENTRIES, partyTabs, shownTab } from "./party-tabs";
import {
  createPartyMemory,
  createSeenState,
  createTabState,
  SEEN_MAX,
  seenKey,
  tabKey,
  withSeen,
} from "./seen";
import { partyBoardWindowBase, partyHandoutWindowBase } from "./window";

const NONE: SharedWith = { mode: "none", playerIds: [] };
const ALL: SharedWith = { mode: "all", playerIds: [] };

function header(id: string, seq: number, over: Partial<HandoutRecord> = {}): HandoutRecord {
  return {
    id,
    campaignId: "c",
    seq,
    title: id,
    imageAssetIds: [],
    sharedWith: NONE,
    rev: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    sharedAt: null,
    ...over,
  };
}

describe("FR-PARTY-12 / FR-PARTY-13 list order", () => {
  test("FR-PARTY-12 DM: newest seq first", () => {
    expect(dmOrder([header("a", 1), header("c", 3), header("b", 2)]).map((h) => h.id)).toEqual([
      "c",
      "b",
      "a",
    ]);
  });

  test("FR-PARTY-13 player: newest sharedAt first, then newest seq", () => {
    const rows = [
      header("old", 5, { sharedAt: "2026-01-01T00:00:01.000Z" }),
      header("new", 1, { sharedAt: "2026-01-01T00:00:09.000Z" }),
      header("tie-a", 2, { sharedAt: "2026-01-01T00:00:05.000Z" }),
      header("tie-b", 3, { sharedAt: "2026-01-01T00:00:05.000Z" }),
    ];
    expect(playerOrder(rows).map((h) => h.id)).toEqual(["new", "tie-b", "tie-a", "old"]);
  });
});

describe("FR-PARTY-13 New / Updated marks and the seen map", () => {
  test("FR-PARTY-13 never seen → New; seen at an older rev → Updated (FR-PARTY-04); current → none", () => {
    expect(markOf(1, undefined)).toBe("new");
    expect(markOf(3, 2)).toBe("updated");
    expect(markOf(3, 3)).toBeNull();
  });

  test("FR-PARTY-13 keys per campaign + player; tab per campaign + viewer", () => {
    expect(seenKey("c1", "p1")).toBe("pp.party.v1.c1.p1");
    expect(tabKey("c1", "dm", null)).toBe("pp.party.tab.v1.c1.dm");
    expect(tabKey("c1", "player", "p2")).toBe("pp.party.tab.v1.c1.p2");
  });

  test("FR-PARTY-13 ≤ 500 entries, oldest dropped; re-marking moves an id to the newest end", () => {
    let seen: Record<string, number> = {};
    for (let i = 0; i < SEEN_MAX; i++) seen = withSeen(seen, `h${i}`, 1);
    seen = withSeen(seen, "h0", 2); // h0 now newest
    seen = withSeen(seen, "extra", 1);
    expect(Object.keys(seen)).toHaveLength(SEEN_MAX);
    expect(seen.h1).toBeUndefined(); // the oldest dropped
    expect(seen.h0).toBe(2);
    expect(Object.keys(seen).at(-1)).toBe("extra");
  });

  test("FR-PARTY-13 opening marks seen and persists `{seen: {id: rev}}`; reload reads it back", () => {
    const data = new Map<string, string>();
    const backend = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    };
    const mem = createPartyMemory(
      () => backend,
      () => {},
    );
    const s = createSeenState(mem);
    s.bind("pp.party.v1.c.p1");
    s.markSeen("h1", 2);
    expect(JSON.parse(data.get("pp.party.v1.c.p1") as string)).toEqual({ seen: { h1: 2 } });
    const again = createSeenState(
      createPartyMemory(
        () => backend,
        () => {},
      ),
    );
    again.bind("pp.party.v1.c.p1");
    expect(again.state.getState().seen).toEqual({ h1: 2 });
  });

  test("FR-PARTY-13 invalid entry → default + warning, the next mark overwrites it", () => {
    const data = new Map<string, string>([["k", '{"seen":{"h1":0}}']]);
    const warnings: string[] = [];
    const mem = createPartyMemory(
      () => ({
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => void data.set(k, v),
      }),
      (m) => void warnings.push(m),
    );
    const s = createSeenState(mem);
    s.bind("k");
    expect(s.state.getState().seen).toEqual({});
    expect(warnings).toHaveLength(1);
    s.markSeen("h2", 1);
    expect(JSON.parse(data.get("k") as string)).toEqual({ seen: { h2: 1 } });
  });

  test("FR-PARTY-13 storage unavailable → memory only, one warning, no throw", () => {
    const warnings: string[] = [];
    const mem = createPartyMemory(
      () => {
        throw new Error("SecurityError");
      },
      (m) => void warnings.push(m),
    );
    const s = createSeenState(mem);
    s.bind("k");
    s.markSeen("h1", 1);
    s.markSeen("h2", 1);
    expect(s.state.getState().seen).toEqual({ h1: 1, h2: 1 });
    expect(mem.readSeen("k")).toEqual({ h1: 1, h2: 1 });
    expect(mem.readTab("t")).toBeNull();
    mem.writeTab("t", "inventory");
    expect(mem.readTab("t")).toBe("inventory");
    expect(warnings).toHaveLength(1);
  });
});

describe("FR-PARTY-60 tab memory", () => {
  const backend = (init: Record<string, string> = {}) => {
    const m = new Map(Object.entries(init));
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    };
  };

  test("FR-PARTY-60 tabs order and memory: Party status, Handouts, Inventory, Loot; no entry, `companions`, unknown → status; a stored tab restores", () => {
    expect(partyTabs().map((t) => [t.id, t.label])).toEqual([
      ["status", "Party status"],
      ["handouts", "Handouts"],
      ["inventory", "Inventory"],
      ["loot", "Loot"],
    ]);
    const ids = partyTabs().map((t) => t.id);
    const warnings: string[] = [];
    const store = backend({
      a: JSON.stringify({ tab: "loot" }),
      b: JSON.stringify({ tab: "companions" }),
      c: JSON.stringify({ tab: 7 }),
    });
    const mem = createPartyMemory(
      () => store,
      (m) => void warnings.push(m),
    );
    // The stored value is kept as is; what shows is `shownTab` (Board).
    expect(mem.readTab("a")).toBe("loot");
    expect(mem.readTab("b")).toBe("companions");
    expect(mem.readTab("none")).toBeNull();
    expect(mem.readTab("c")).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(shownTab(mem.readTab("a"), ids)).toBe("loot");
    expect(shownTab(mem.readTab("b"), ids)).toBe("status");
    expect(shownTab(mem.readTab("none"), ids)).toBe("status");
    expect(shownTab("log", ids)).toBe("status");

    const tabs = createTabState(mem);
    tabs.bind("a");
    expect(tabs.state.getState()).toEqual({ key: "a", tab: "loot" });
    tabs.bind("none");
    expect(tabs.state.getState().tab).toBeNull();
    tabs.choose("none", "status"); // a click: shown at once and stored
    expect(tabs.state.getState()).toEqual({ key: "none", tab: "status" });
    expect(store.getItem("none")).toBe(JSON.stringify({ tab: "status" }));
    tabs.bind("none"); // same key: the chosen tab stays
    expect(tabs.state.getState().tab).toBe("status");
  });

  test("FR-PARTY-67 tab registry: ids unique, orders unique, PM's entries at 10–40", () => {
    const ids = PARTY_TAB_ENTRIES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    const orders = PARTY_TAB_ENTRIES.map((t) => t.order);
    expect(new Set(orders).size).toBe(orders.length);
    expect(PARTY_TAB_ENTRIES.filter((t) => t.order <= 40).map((t) => [t.id, t.order])).toEqual([
      ["status", 10],
      ["handouts", 20],
      ["inventory", 30],
      ["loot", 40],
    ]);
  });
});

describe("FR-PARTY-15 editor drafts", () => {
  test("FR-PARTY-15 Save disabled while invalid (FR-PARTY-02 mirrored) or unchanged", () => {
    expect(handoutPayload({ title: "  ", body: "", imageAssetIds: [] }).ok).toBe(false);
    expect(handoutPayload({ title: "x".repeat(81), body: "", imageAssetIds: [] }).ok).toBe(false);
    expect(handoutPayload({ title: "T", body: "x".repeat(10_001), imageAssetIds: [] }).ok).toBe(
      false,
    );
    const ok = handoutPayload({ title: " Letter ", body: "a\r\nb ", imageAssetIds: [] });
    expect(ok).toEqual({ ok: true, value: { title: "Letter", body: "a\nb", imageAssetIds: [] } });
    const stored = { title: "Letter", body: "a\nb", imageAssetIds: [] };
    expect(draftUnchanged({ title: "Letter ", body: "a\r\nb", imageAssetIds: [] }, stored)).toBe(
      true,
    );
    expect(draftUnchanged({ title: "Letter 2", body: "a\nb", imageAssetIds: [] }, stored)).toBe(
      false,
    );
    expect(draftUnchanged({ title: "Letter", body: "", imageAssetIds: [] }, null)).toBe(false);
    expect(bodyCounter("abc")).toBe("3 / 10,000");
  });

  test("FR-PARTY-15 images strip: add once, ≤ 10; remove; move left / right", () => {
    expect(addImage(["a"], "a")).toEqual(["a"]);
    const ten = Array.from({ length: HANDOUT_IMAGES_MAX }, (_, i) => `i${i}`);
    expect(addImage(ten, "x")).toHaveLength(HANDOUT_IMAGES_MAX);
    expect(addImage(["a"], "b")).toEqual(["a", "b"]);
    expect(removeImage(["a", "b", "c"], 1)).toEqual(["a", "c"]);
    expect(moveImage(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveImage(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
    expect(moveImage(["a", "b"], 0, -1)).toEqual(["a", "b"]);
  });

  test("FR-PARTY-15 a reject → inline; a lost intent → the toast text", () => {
    expect(intentFailure(new IntentRejected("not_found", "Handout not found"), LOST_SAVE)).toEqual({
      kind: "inline",
      message: "Handout not found",
    });
    expect(intentFailure(new IntentRejected("disconnected", "x"), LOST_SAVE)).toEqual({
      kind: "toast",
      message: "Connection lost — check the handout before saving again",
    });
  });
});

describe("FR-PARTY-16 Share dialog", () => {
  const order = ["p1", "p2"];
  const ready = { live: true, busy: false };

  test("FR-PARTY-16 Share disabled while Chosen has none ticked, unchanged, not live or in flight", () => {
    expect(shareEnabled({ mode: "players", playerIds: [] }, NONE, order, ready)).toBe(false);
    expect(shareEnabled({ mode: "none", playerIds: [] }, NONE, order, ready)).toBe(false);
    expect(shareEnabled({ mode: "all", playerIds: [] }, NONE, order, ready)).toBe(true);
    expect(
      shareEnabled({ mode: "all", playerIds: [] }, NONE, order, { ...ready, live: false }),
    ).toBe(false);
    expect(
      shareEnabled({ mode: "all", playerIds: [] }, NONE, order, { ...ready, busy: true }),
    ).toBe(false);
    // Same players in another order = unchanged.
    const stored: SharedWith = { mode: "players", playerIds: ["p1", "p2"] };
    expect(shareEnabled({ mode: "players", playerIds: ["p2", "p1"] }, stored, order, ready)).toBe(
      false,
    );
  });

  test("FR-PARTY-16 payload: ticks count only under Chosen, in player order; Not shared = unshare", () => {
    expect(sharePayload({ mode: "all", playerIds: ["p1"] }, order)).toEqual({
      ok: true,
      value: ALL,
    });
    expect(sharePayload({ mode: "players", playerIds: ["p2", "p1", "gone"] }, order)).toEqual({
      ok: true,
      value: { mode: "players", playerIds: ["p1", "p2"] },
    });
    expect(sharePayload({ mode: "none", playerIds: ["p2"] }, order)).toEqual({
      ok: true,
      value: NONE,
    });
    expect(togglePlayer(["p1"], "p2", true)).toEqual(["p1", "p2"]);
    expect(togglePlayer(["p1", "p2"], "p1", false)).toEqual(["p2"]);
  });

  test("PARTY §11 Chosen with every current player still `players`; the dialog notes it", () => {
    expect(choseEveryone({ mode: "players", playerIds: ["p1", "p2"] }, order)).toBe(true);
    expect(choseEveryone({ mode: "players", playerIds: ["p1"] }, order)).toBe(false);
    expect(choseEveryone({ mode: "all", playerIds: [] }, order)).toBe(false);
  });
});

describe("FR-PARTY-11 / FR-PARTY-14 windows", () => {
  test("FR-PARTY-11 party.board: Party Manager (FR-PARTY-59), closed, top-left dx 56, 550×560 (FR-SHELL-156), min 340×360, minOpenH 400, launcher", () => {
    expect(partyBoardWindowBase).toMatchObject({
      kind: "party.board",
      title: "Party Manager",
      defaultOpen: false,
      defaultPosition: { anchor: "top-left", dx: 56 },
      defaultSize: { w: 550, h: 560 },
      minSize: { w: 340, h: 360 },
      minOpenH: 400,
      launcher: { label: "Party Manager" },
    });
  });

  test("FR-PARTY-14 party.handout: Handout, closed, top-right, 640×560, min 360×320, minOpenH 400, no launcher", () => {
    expect(partyHandoutWindowBase).toMatchObject({
      kind: "party.handout",
      title: "Handout",
      defaultOpen: false,
      defaultPosition: { anchor: "top-right" },
      defaultSize: { w: 640, h: 560 },
      minSize: { w: 360, h: 320 },
      minOpenH: 400,
    });
    expect("launcher" in partyHandoutWindowBase).toBe(false);
  });

  test("FR-PARTY-11 activity changes when a handout arrives or is updated; null without handouts", () => {
    const store = (...rows: HandoutRecord[]) => ({
      ...emptyStore(),
      records: { [HANDOUT_TYPE]: Object.fromEntries(rows.map((r) => [r.id, r])) },
    });
    expect(handoutActivity(emptyStore())).toBeNull();
    const a = header("a", 1, { sharedAt: "2026-01-01T00:00:01.000Z" });
    const base = handoutActivity(store(a));
    const arrived = handoutActivity(
      store(a, header("b", 2, { sharedAt: "2026-01-01T00:00:02.000Z" })),
    );
    expect(arrived).not.toBe(base);
    const updated = handoutActivity(store({ ...a, rev: 2, updatedAt: "2026-01-01T00:00:03.000Z" }));
    expect(updated).not.toBe(base);
    expect(handoutActivity(store(a))).toBe(base);
  });

  test("FR-PARTY-09 a notification's Open target: payload.handoutId", () => {
    expect(handoutIdOf({ handoutId: "h1" })).toBe("h1");
    expect(handoutIdOf({})).toBeNull();
    expect(handoutIdOf(null)).toBeNull();
  });
});
