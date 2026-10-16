// PARTY §13 unit: zod rules, visibility fns, gainers, split math, merge rules, texts.
import { describe, expect, test } from "bun:test";
import type { Coins } from "@shared/party-loot/schemas";
import {
  dmShareLabel,
  handoutSharedText,
  itemAddedText,
  itemRowText,
  playerShareLabel,
  splitPreview,
} from "./format";
import {
  canMoveItem,
  editKeyClash,
  itemKey,
  mergeConflictMessage,
  planMerge,
  planTake,
  rowCapOf,
  takeConflictMessage,
} from "./items";
import {
  AddItemIntent,
  CreateHandoutIntent,
  cleanBody,
  EditItemIntent,
  type HandoutBodyRecord,
  HandoutBodyView,
  type HandoutRecord,
  HandoutView,
  LootSplitIntent,
  MoveItemIntent,
  NOT_SHARED,
  PlayerHandoutBodyRecord,
  PlayerHandoutRecord,
  RemoveItemIntent,
  type SharedWith,
  ShareHandoutIntent,
  UpdateHandoutIntent,
} from "./schemas";
import { nothingToSplit, splitCoins } from "./split";
import {
  audienceOf,
  handoutVisibility,
  redactHandout,
  redactHandoutBody,
  sameShare,
  shareGainers,
  shareLosers,
  shareNotifications,
} from "./visibility";

const asset = (n: number) => `asset${String(n).padStart(17, "0")}`; // 22 chars
const c = (x: Partial<Coins>): Coins => ({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, ...x });
const party = { kind: "party" } as const;
const mira = { kind: "character", characterId: "m" } as const;
const thorn = { kind: "character", characterId: "t" } as const;

const none: SharedWith = NOT_SHARED;
const all: SharedWith = { mode: "all", playerIds: [] };
const only = (...playerIds: string[]): SharedWith => ({ mode: "players", playerIds });
const PLAYERS = ["p1", "p2", "p3"];

const dm = { role: "dm", playerId: null } as const;
const player = (id: string) => ({ role: "player", playerId: id }) as const;

const header = (sharedWith: SharedWith): HandoutRecord => ({
  id: "h1",
  campaignId: "c1",
  seq: 1,
  title: "Mayor's Letter",
  imageAssetIds: [asset(1)],
  sharedWith,
  rev: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  sharedAt: null,
});
const body = (sharedWith: SharedWith): HandoutBodyRecord => ({
  id: "h1",
  campaignId: "c1",
  body: "Dear adventurers",
  rev: 1,
  sharedWith,
});

describe("FR-PARTY-02 handout input", () => {
  const ok = { title: "Letter", body: "", imageAssetIds: [] };

  test("FR-PARTY-02 title cleaned, 1–80", () => {
    expect(CreateHandoutIntent.parse({ ...ok, title: "  Le\u0007tter\t " }).title).toBe("Letter");
    expect(CreateHandoutIntent.safeParse({ ...ok, title: "x".repeat(80) }).success).toBe(true);
    expect(CreateHandoutIntent.safeParse({ ...ok, title: "x".repeat(81) }).success).toBe(false);
    expect(CreateHandoutIntent.safeParse({ ...ok, title: " \u0000 " }).success).toBe(false);
  });

  test("FR-PARTY-02 body keeps \\n and \\t, \\r\\n → \\n, other controls removed, 0–10 000", () => {
    expect(cleanBody("  a\r\nb\tc\u0000d\re\u0085 \n")).toBe("a\nb\tcde");
    expect(CreateHandoutIntent.parse({ ...ok, body: " \n " }).body).toBe("");
    expect(CreateHandoutIntent.safeParse({ ...ok, body: "x".repeat(10_000) }).success).toBe(true);
    expect(CreateHandoutIntent.safeParse({ ...ok, body: "x".repeat(10_001) }).success).toBe(false);
    // Bounds apply after cleaning: 10 000 chars plus stripped controls still pass.
    const padded = `${"x".repeat(10_000)}\u0000\u0000`;
    expect(CreateHandoutIntent.safeParse({ ...ok, body: padded }).success).toBe(true);
  });

  test("FR-PARTY-02 images: 0–10 unique asset ids", () => {
    const ten = Array.from({ length: 10 }, (_, i) => asset(i));
    expect(CreateHandoutIntent.safeParse({ ...ok, imageAssetIds: ten }).success).toBe(true);
    const eleven = [...ten, asset(10)];
    expect(CreateHandoutIntent.safeParse({ ...ok, imageAssetIds: eleven }).success).toBe(false);
    const dup = [asset(1), asset(1)];
    expect(CreateHandoutIntent.safeParse({ ...ok, imageAssetIds: dup }).success).toBe(false);
    expect(CreateHandoutIntent.safeParse({ ...ok, imageAssetIds: ["short"] }).success).toBe(false);
  });

  test("FR-PARTY-02 strict keys; update needs every field + handoutId", () => {
    expect(CreateHandoutIntent.safeParse({ ...ok, sharedWith: all }).success).toBe(false);
    expect(UpdateHandoutIntent.safeParse({ handoutId: "h1", ...ok }).success).toBe(true);
    expect(UpdateHandoutIntent.safeParse({ handoutId: "h1", title: "x" }).success).toBe(false);
  });
});

describe("FR-PARTY-05 sharedWith shapes", () => {
  const share = (sharedWith: unknown) =>
    ShareHandoutIntent.safeParse({ handoutId: "h1", sharedWith }).success;

  test("FR-PARTY-05 none / all need []; players 1–20 unique", () => {
    expect(share(none)).toBe(true);
    expect(share(all)).toBe(true);
    expect(share(only("p1"))).toBe(true);
    expect(share({ mode: "none", playerIds: ["p1"] })).toBe(false);
    expect(share({ mode: "all", playerIds: ["p1"] })).toBe(false);
    expect(share({ mode: "players", playerIds: [] })).toBe(false);
    expect(share(only("p1", "p1"))).toBe(false);
    const twenty = Array.from({ length: 20 }, (_, i) => `p${i}`);
    expect(share(only(...twenty))).toBe(true);
    expect(share(only(...twenty, "p20"))).toBe(false);
    expect(share({ mode: "some", playerIds: [] })).toBe(false);
    expect(share({ mode: "all" })).toBe(false);
  });

  test("FR-PARTY-05 same share ignores player order", () => {
    expect(sameShare(only("p1", "p2"), only("p2", "p1"))).toBe(true);
    expect(sameShare(only("p1"), only("p1", "p2"))).toBe(false);
    expect(sameShare(all, none)).toBe(false);
    expect(sameShare(none, NOT_SHARED)).toBe(true);
  });
});

describe("FR-PARTY-07 visibility", () => {
  test("FR-PARTY-07 DM full for both types, any share", () => {
    for (const s of [none, all, only("p1")]) {
      expect(handoutVisibility(header(s), dm)).toBe("full");
      expect(handoutVisibility(body(s), dm)).toBe("full");
    }
  });

  test("FR-PARTY-07 not shared → hidden for both types", () => {
    expect(handoutVisibility(header(none), player("p1"))).toBe("hidden");
    expect(handoutVisibility(body(none), player("p1"))).toBe("hidden");
    expect(handoutVisibility(header(only("p1")), player("p2"))).toBe("hidden");
    expect(handoutVisibility(body(only("p1")), player("p2"))).toBe("hidden");
    expect(handoutVisibility(header(all), { role: "player", playerId: null })).toBe("hidden");
  });

  test("FR-PARTY-07 gainer gets redacted rows: no other recipients' ids (OQ-PARTY-10)", () => {
    const s = only("p1", "p2");
    expect(handoutVisibility(header(s), player("p1"))).toBe("redacted");
    const h = redactHandout(header(s));
    expect(h.sharedWith).toEqual({ mode: "players" });
    expect(JSON.stringify(h)).not.toContain("p2");
    expect(PlayerHandoutRecord.safeParse(h).success).toBe(true);
    expect(HandoutView.safeParse(h).success).toBe(true);

    const b = redactHandoutBody(body(s));
    expect("sharedWith" in b).toBe(false);
    expect(b).toEqual({ id: "h1", campaignId: "c1", body: "Dear adventurers", rev: 1 });
    expect(PlayerHandoutBodyRecord.safeParse(b).success).toBe(true);
    expect(HandoutBodyView.safeParse(b).success).toBe(true);
    // A player view never parses as the DM shape with ids.
    expect(PlayerHandoutRecord.safeParse(header(s)).success).toBe(false);
  });

  test("FR-PARTY-07 all covers a player added later", () => {
    expect(handoutVisibility(header(all), player("p-new"))).toBe("redacted");
    expect(redactHandout(header(all)).sharedWith).toEqual({ mode: "all" });
    expect(audienceOf(all, [...PLAYERS, "p-new"])).toEqual([...PLAYERS, "p-new"]);
    // players listing every current player is still `players`: a later one is not in it.
    expect(handoutVisibility(header(only(...PLAYERS)), player("p-new"))).toBe("hidden");
  });

  test("FR-PARTY-07 redacting an unshared header is a bug", () => {
    expect(() => redactHandout(header(none))).toThrow();
  });
});

describe("FR-PARTY-06 gainers and notifications", () => {
  test("FR-PARTY-06 none → all: everyone gains, one notification to all", () => {
    expect(shareGainers(none, all, PLAYERS)).toEqual(PLAYERS);
    expect(shareNotifications(none, all, PLAYERS)).toEqual([{ audience: "all" }]);
  });

  test("FR-PARTY-06 none → players: one per listed player", () => {
    expect(shareGainers(none, only("p2"), PLAYERS)).toEqual(["p2"]);
    expect(shareNotifications(none, only("p2", "p1"), PLAYERS)).toEqual([
      { audience: "player", playerId: "p1" },
      { audience: "player", playerId: "p2" },
    ]);
  });

  test("FR-PARTY-06 players → all notifies only the new gainers", () => {
    expect(shareGainers(only("p1"), all, PLAYERS)).toEqual(["p2", "p3"]);
    expect(shareNotifications(only("p1"), all, PLAYERS)).toEqual([
      { audience: "player", playerId: "p2" },
      { audience: "player", playerId: "p3" },
    ]);
  });

  test("FR-PARTY-06 all → players: no gainers, losers get deletes", () => {
    expect(shareGainers(all, only("p1"), PLAYERS)).toEqual([]);
    expect(shareNotifications(all, only("p1"), PLAYERS)).toEqual([]);
    expect(shareLosers(all, only("p1"), PLAYERS)).toEqual(["p2", "p3"]);
  });

  test("FR-PARTY-06 → none (unshare) never notifies; all former viewers lose", () => {
    expect(shareNotifications(all, none, PLAYERS)).toEqual([]);
    expect(shareNotifications(only("p1"), none, PLAYERS)).toEqual([]);
    expect(shareLosers(only("p1", "p3"), none, PLAYERS)).toEqual(["p1", "p3"]);
  });

  test("FR-PARTY-06 players → players: swap notifies the newcomer only", () => {
    expect(shareGainers(only("p1"), only("p1", "p2"), PLAYERS)).toEqual(["p2"]);
    expect(shareLosers(only("p1"), only("p2"), PLAYERS)).toEqual(["p1"]);
  });

  test("FR-PARTY-06 listed ids that left the campaign never gain", () => {
    expect(shareGainers(none, only("gone", "p1"), PLAYERS)).toEqual(["p1"]);
    expect(shareGainers(none, only("gone"), PLAYERS)).toEqual([]);
    expect(shareNotifications(none, only("gone"), PLAYERS)).toEqual([]);
  });

  test("FR-PARTY-06 none → all with no players: G empty → none", () => {
    expect(shareNotifications(none, all, [])).toEqual([]);
  });

  test("FR-PARTY-06 notification text cut to 280", () => {
    expect(handoutSharedText("Mayor's Letter")).toBe("New handout: Mayor's Letter");
    const long = handoutSharedText("x".repeat(400));
    expect(long.length).toBe(280);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("FR-PARTY-18 item input", () => {
  test("FR-PARTY-18 name 1–60, qty 1–9 999 int, notes 0–120, cleaned, strict", () => {
    const ok = { name: "Torch", qty: 10, notes: "" };
    expect(AddItemIntent.parse({ ...ok, name: " To\u0000rch " }).name).toBe("Torch");
    expect(AddItemIntent.safeParse({ ...ok, name: "x".repeat(60) }).success).toBe(true);
    expect(AddItemIntent.safeParse({ ...ok, name: "x".repeat(61) }).success).toBe(false);
    expect(AddItemIntent.safeParse({ ...ok, name: "  " }).success).toBe(false);
    expect(AddItemIntent.safeParse({ ...ok, notes: "x".repeat(120) }).success).toBe(true);
    expect(AddItemIntent.safeParse({ ...ok, notes: "x".repeat(121) }).success).toBe(false);
    expect(AddItemIntent.safeParse({ ...ok, qty: 9_999 }).success).toBe(true);
    for (const qty of [0, -1, 1.5, 10_000, "2"])
      expect(AddItemIntent.safeParse({ ...ok, qty }).success).toBe(false);
    expect(AddItemIntent.safeParse({ ...ok, weight: 1 }).success).toBe(false);
    expect(EditItemIntent.safeParse({ itemId: "i1", ...ok }).success).toBe(true);
    expect(EditItemIntent.safeParse({ itemId: "i1", name: "Torch" }).success).toBe(false);
    expect(RemoveItemIntent.safeParse({ itemId: "i1", qty: 0 }).success).toBe(false);
  });

  test("FR-PARTY-18 merge key: name trimmed + case-insensitive, notes exact", () => {
    expect(itemKey({ name: " Torch ", notes: "" })).toBe(itemKey({ name: "TORCH", notes: "" }));
    expect(itemKey({ name: "Torch", notes: "lit" })).not.toBe(
      itemKey({ name: "Torch", notes: "Lit" }),
    );
    expect(itemKey({ name: "Torch", notes: "" })).not.toBe(itemKey({ name: "Torch", notes: " " }));
    // No ambiguous concatenation.
    expect(itemKey({ name: "a", notes: "bc" })).not.toBe(itemKey({ name: "ab", notes: "c" }));
  });
});

describe("FR-PARTY-19/22 merge and caps", () => {
  const row = (id: string, name: string, qty: number, notes = "") => ({ id, name, qty, notes });

  test("FR-PARTY-19 merges by key, else appends", () => {
    const rows = [row("a", "Torch", 8), row("b", "Potion of healing", 2)];
    expect(planMerge(rows, { name: "torch", notes: "", qty: 2 }, 60)).toEqual({
      kind: "merge",
      row: rows[0]!,
      qty: 10,
    });
    expect(planMerge(rows, { name: "Torch", notes: "wet", qty: 2 }, 60)).toEqual({
      kind: "append",
    });
  });

  test("FR-PARTY-19 qty sum > 9 999 → conflict; exactly 9 999 merges", () => {
    const rows = [row("a", "Arrow", 9_990)];
    expect(planMerge(rows, { name: "Arrow", notes: "", qty: 9 }, 60)).toMatchObject({
      kind: "merge",
    });
    expect(planMerge(rows, { name: "Arrow", notes: "", qty: 10 }, 60)).toEqual({
      kind: "conflict",
      reason: "qty",
    });
  });

  test("FR-PARTY-19 61st party row → conflict; a merge into a full party still works", () => {
    const full = Array.from({ length: 60 }, (_, i) => row(`r${i}`, `Item ${i}`, 1));
    expect(planMerge(full, { name: "New", notes: "", qty: 1 }, rowCapOf(party))).toEqual({
      kind: "conflict",
      reason: "rows",
    });
    expect(planMerge(full, { name: "item 3", notes: "", qty: 1 }, 60)).toMatchObject({
      kind: "merge",
      qty: 2,
    });
    expect(mergeConflictMessage("rows", party, "Party")).toBe("Party inventory is full (60)");
  });

  test("FR-PARTY-22 sheet cap 80 rows; conflict names the full side", () => {
    expect(rowCapOf(mira)).toBe(80);
    const sheet = Array.from({ length: 80 }, (_, i) => row(`s${i}`, `Thing ${i}`, 1));
    expect(planMerge(sheet, { name: "New", notes: "", qty: 1 }, rowCapOf(mira))).toEqual({
      kind: "conflict",
      reason: "rows",
    });
    expect(planMerge(sheet.slice(1), { name: "New", notes: "", qty: 1 }, 80)).toEqual({
      kind: "append",
    });
    expect(mergeConflictMessage("rows", mira, "Mira")).toBe("Mira's inventory is full (80)");
    expect(mergeConflictMessage("qty", mira, "Mira")).toContain("Mira");
    expect(mergeConflictMessage("qty", party, "Party")).toContain("Party");
  });

  test("FR-PARTY-21/22 take: reduce, delete at 0, more than held → Only n left", () => {
    expect(planTake(2, 1)).toEqual({ kind: "ok", remaining: 1, deleted: false });
    expect(planTake(2, 2)).toEqual({ kind: "ok", remaining: 0, deleted: true });
    expect(planTake(2, 3)).toEqual({ kind: "conflict" });
    expect(planTake(0, 1)).toEqual({ kind: "conflict" });
    expect(takeConflictMessage(2)).toBe("Only 2 left");
  });

  test("FR-PARTY-20 edit key clash with another row only", () => {
    const rows = [row("a", "Torch", 8), row("b", "Rope", 1, "50 ft")];
    expect(editKeyClash(rows, "a", { name: "TORCH", notes: "" })).toBeUndefined();
    expect(editKeyClash(rows, "a", { name: "rope", notes: "50 ft" })?.id).toBe("b");
    expect(editKeyClash(rows, "a", { name: "rope", notes: "" })).toBeUndefined();
  });
});

describe("FR-PARTY-22 move input", () => {
  const move = (v: Record<string, unknown>) => MoveItemIntent.safeParse({ qty: 1, ...v }).success;

  test("FR-PARTY-22 from party needs itemId; from a character needs rowId", () => {
    expect(move({ from: party, to: mira, itemId: "i1" })).toBe(true);
    expect(move({ from: party, to: mira })).toBe(false);
    expect(move({ from: party, to: mira, itemId: "i1", rowId: "r1" })).toBe(false);
    expect(move({ from: mira, to: party, rowId: "r1" })).toBe(true);
    expect(move({ from: mira, to: thorn, rowId: "r1" })).toBe(true);
    expect(move({ from: mira, to: party })).toBe(false);
    expect(move({ from: mira, to: party, rowId: "r1", itemId: "i1" })).toBe(false);
  });

  test("FR-PARTY-22 from ≠ to; no world end; qty ≥ 1 int; strict", () => {
    expect(move({ from: party, to: party, itemId: "i1" })).toBe(false);
    expect(move({ from: mira, to: { ...mira }, rowId: "r1" })).toBe(false);
    expect(move({ from: { kind: "world" }, to: mira, itemId: "i1" })).toBe(false);
    expect(move({ from: { kind: "character" }, to: party, rowId: "r1" })).toBe(false);
    for (const qty of [0, -1, 1.5, 10_000])
      expect(move({ from: party, to: mira, itemId: "i1", qty })).toBe(false);
    expect(move({ from: party, to: mira, itemId: "i1", note: "x" })).toBe(false);
  });
});

describe("FR-PARTY-23 move authorization", () => {
  const own = ["m"];

  test("FR-PARTY-23 DM any move", () => {
    expect(canMoveItem("dm", party, mira, [])).toBe(true);
    expect(canMoveItem("dm", thorn, mira, [])).toBe(true);
  });

  test("FR-PARTY-23 player: own → party / other character; party → own; else forbidden", () => {
    expect(canMoveItem("player", mira, party, own)).toBe(true);
    expect(canMoveItem("player", mira, thorn, own)).toBe(true);
    expect(canMoveItem("player", party, mira, own)).toBe(true);
    expect(canMoveItem("player", party, thorn, own)).toBe(false);
    expect(canMoveItem("player", thorn, party, own)).toBe(false);
    expect(canMoveItem("player", thorn, mira, own)).toBe(false);
    expect(canMoveItem("player", party, mira, [])).toBe(false);
  });
});

describe("FR-PARTY-26 split", () => {
  test("FR-PARTY-26 ⌊coin / n⌋ per denomination, remainder stays in the pot", () => {
    expect(splitCoins(c({ pp: 5, gp: 30 }), 2)).toEqual({
      share: c({ pp: 2, gp: 15 }),
      remainder: c({ pp: 1 }),
    });
    expect(splitCoins(c({ cp: 10, sp: 7, ep: 1, gp: 999_999 }), 3)).toEqual({
      share: c({ cp: 3, sp: 2, gp: 333_333 }),
      remainder: c({ cp: 1, sp: 1, ep: 1 }),
    });
    expect(splitCoins(c({ gp: 30 }), 1)).toEqual({ share: c({ gp: 30 }), remainder: c({}) });
  });

  test("FR-PARTY-26 zero PCs → no split; all shares 0 → Nothing to split", () => {
    expect(splitCoins(c({ gp: 30 }), 0)).toBeNull();
    expect(splitCoins(c({ gp: 30 }), -1)).toBeNull();
    expect(splitCoins(c({ gp: 30 }), 1.5)).toBeNull();
    expect(nothingToSplit(c({ gp: 30 }), 0)).toBe(true);
    expect(nothingToSplit(c({ gp: 3, sp: 2 }), 4)).toBe(true);
    expect(nothingToSplit(c({}), 1)).toBe(true);
    expect(nothingToSplit(c({ gp: 4 }), 4)).toBe(false);
  });

  test("FR-PARTY-26 intent: 1–10 unique characters, coins 0…999 999, Nothing to split", () => {
    const ok = (v: Record<string, unknown>) => LootSplitIntent.safeParse(v).success;
    expect(LootSplitIntent.parse({ characterIds: ["m", "t"], gp: 30 })).toEqual({
      characterIds: ["m", "t"],
      ...c({ gp: 30 }),
    });
    expect(ok({ characterIds: [], gp: 30 })).toBe(false);
    expect(ok({ characterIds: ["m", "m"], gp: 30 })).toBe(false);
    const ten = Array.from({ length: 10 }, (_, i) => `c${i}`);
    expect(ok({ characterIds: ten, gp: 10 })).toBe(true);
    expect(ok({ characterIds: [...ten, "c10"], gp: 11 })).toBe(false);
    expect(ok({ characterIds: ["m"], gp: 999_999 })).toBe(true);
    expect(ok({ characterIds: ["m"], gp: 1_000_000 })).toBe(false);
    expect(ok({ characterIds: ["m"], gp: -1 })).toBe(false);
    expect(ok({ characterIds: ["m"], gp: 1.5 })).toBe(false);
    expect(ok({ characterIds: ["m", "t"], gp: 1 })).toBe(false);
    expect(
      LootSplitIntent.safeParse({ characterIds: ["m", "t"], gp: 1 }).error?.issues[0]?.message,
    ).toBe("Nothing to split");
    expect(ok({ characterIds: ["m"], gp: 1, gems: 2 })).toBe(false);
  });

  test("FR-PARTY-27 split preview", () => {
    expect(splitPreview(splitCoins(c({ pp: 5, gp: 30 }), 2)!)).toBe(
      "Each gets 2 pp, 15 gp; 1 pp stays in the pot",
    );
    expect(splitPreview(splitCoins(c({ gp: 30 }), 2)!)).toBe("Each gets 15 gp");
  });
});

describe("PARTY derived texts", () => {
  const names: Record<string, string> = { m: "Mira", p1: "Player 1", p2: "Player 2" };

  test("FR-PARTY-19 loot-received text, cut to 280", () => {
    expect(itemAddedText("Healer's kit", 1)).toBe("Party loot: Healer's kit ×1");
    expect(itemAddedText("x".repeat(400), 1).length).toBe(280);
  });

  test("FR-PARTY-25 item row text", () => {
    const name = (id: string) => names[id] ?? "?";
    const world = { kind: "world" } as const;
    expect(itemRowText({ from: world, to: party, text: "Healer's kit", qty: 1 }, name)).toBe(
      "Outside the party → Party: Healer's kit ×1",
    );
    expect(itemRowText({ from: party, to: mira, text: "Potion of healing", qty: 1 }, name)).toBe(
      "Party → Mira: Potion of healing ×1",
    );
  });

  test("FR-PARTY-12/13 share labels; players see no names", () => {
    const name = (id: string) => names[id];
    expect(dmShareLabel(none, name)).toBe("Not shared");
    expect(dmShareLabel(all, name)).toBe("Everyone");
    expect(dmShareLabel(only("p1", "gone", "p2"), name)).toBe("Player 1, Player 2");
    expect(playerShareLabel({ mode: "all" })).toBe("Everyone");
    expect(playerShareLabel({ mode: "players" })).toBe("Shared with you");
  });
});
