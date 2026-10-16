// LOOT §13 + PARTY §13 client unit: order, wallets, form drafts, Move options per role, locks,
// outcomes, item rows (FR-PARTY-25), the Split… dialog (FR-PARTY-27).
import { describe, expect, test } from "bun:test";
import type { LootEntryRecord, WalletRecord } from "@shared/party-loot/schemas";
import { IntentRejected } from "../../sync/connection";
import {
  type CharacterRef,
  canMove,
  draftOf,
  EMPTY_DRAFT,
  editedSuffix,
  editPayload,
  endpointLabel,
  fromOptions,
  intentFailure,
  itemLine,
  LOST_ADD,
  LOST_SPLIT,
  lootPayload,
  movePayload,
  newestFirst,
  parseCoin,
  splitCharacters,
  splitPayload,
  splitPrefill,
  submitEnabled,
  toOptions,
  walletRows,
} from "./logic";

const chars: CharacterRef[] = [
  { id: "t", name: "Thorn", ownerPlayerId: "p2" },
  { id: "m", name: "Mira", ownerPlayerId: "p1" },
  { id: "a", name: "Aria", ownerPlayerId: "p2" },
];
const dm = { role: "dm" as const, playerId: null };
const p1 = { role: "player" as const, playerId: "p1" };
const p2 = { role: "player" as const, playerId: "p2" };
const keys = (o: { key: string }[]) => o.map((x) => x.key);

const entry = (over: Partial<LootEntryRecord>): LootEntryRecord => ({
  id: "e",
  campaignId: "c",
  seq: 1,
  kind: "loot",
  from: { kind: "world" },
  to: { kind: "party" },
  text: "",
  cp: 0,
  sp: 0,
  ep: 0,
  gp: 0,
  pp: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  editedAt: null,
  ...over,
});

describe("FR-LOOT-15 display", () => {
  test("FR-LOOT-15 log newest first", () => {
    const list = [
      entry({ id: "a", seq: 2 }),
      entry({ id: "b", seq: 9 }),
      entry({ id: "c", seq: 5 }),
    ];
    expect(newestFirst(list).map((e) => e.id)).toEqual(["b", "c", "a"]);
  });

  test("FR-LOOT-15 wallets: one per character by name, own first, missing wallet = 0, negatives kept", () => {
    const wallets: WalletRecord[] = [
      { id: "t", campaignId: "c", characterId: "t", cp: 0, sp: -5, ep: 0, gp: 8, pp: 0 },
    ];
    const rows = walletRows(chars, wallets, "p2");
    expect(rows.map((r) => [r.character.name, r.own])).toEqual([
      ["Aria", true],
      ["Thorn", true],
      ["Mira", false],
    ]);
    expect(rows[1]?.coins).toEqual({ cp: 0, sp: -5, ep: 0, gp: 8, pp: 0 });
    expect(rows[2]?.coins).toEqual({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 });
    expect(walletRows(chars, [], null).map((r) => r.character.name)).toEqual([
      "Aria",
      "Mira",
      "Thorn",
    ]);
    expect(walletRows([], [], null)).toEqual([]);
  });

  test("FR-LOOT-15 move route labels", () => {
    const nameOf = (id: string) => (id === "m" ? "Mira" : undefined);
    expect(endpointLabel({ kind: "party" }, nameOf)).toBe("Party pot");
    expect(endpointLabel({ kind: "world" }, nameOf)).toBe("Outside the party");
    expect(endpointLabel({ kind: "character", characterId: "m" }, nameOf)).toBe("Mira");
  });

  test("FR-LOOT-14 the (edited) suffix only for an edited entry in the store", () => {
    const store = { e1: entry({ id: "e1", editedAt: "2026-01-01T00:01:00.000Z" }), e2: entry({}) };
    expect(editedSuffix({ entryId: "e1" }, store)).toBe(" (edited)");
    expect(editedSuffix({ entryId: "e2" }, store)).toBe("");
    expect(editedSuffix({ entryId: "gone" }, store)).toBe("");
    expect(editedSuffix({}, undefined)).toBe("");
  });
});

describe("FR-LOOT-16 FR-LOOT-17 add / edit drafts", () => {
  test("FR-LOOT-16 coin drafts: integers only, '-' only when signed", () => {
    expect(parseCoin("", true)).toBe(0);
    expect(parseCoin(" 50 ", true)).toBe(50);
    expect(parseCoin("-40", true)).toBe(-40);
    expect(parseCoin("-40", false)).toBeNull();
    expect(parseCoin("1.5", true)).toBeNull();
    expect(parseCoin("-", true)).toBeNull();
    expect(parseCoin("abc", false)).toBeNull();
  });

  test("FR-LOOT-16 add payload mirrors FR-LOOT-02", () => {
    expect(lootPayload("", EMPTY_DRAFT).ok).toBe(false);
    expect(lootPayload("", { ...EMPTY_DRAFT, gp: "1.5" })).toEqual({
      ok: false,
      message: "Coins must be whole numbers",
    });
    expect(lootPayload("x".repeat(201), EMPTY_DRAFT).ok).toBe(false);
    expect(lootPayload("", { ...EMPTY_DRAFT, gp: "1000000" }).ok).toBe(false);
    expect(lootPayload(" Silver dagger ", { ...EMPTY_DRAFT, gp: "50" })).toEqual({
      ok: true,
      value: { text: "Silver dagger", cp: 0, sp: 0, ep: 0, gp: 50, pp: 0 },
    });
    expect(lootPayload("Paid", { ...EMPTY_DRAFT, gp: "-40" }).ok).toBe(true);
  });

  test("FR-LOOT-17 edit: prefilled draft; unchanged detected after cleaning", () => {
    const e = entry({ text: "Silver dagger", gp: 50 });
    const d = draftOf(e);
    expect(d).toEqual({ ...EMPTY_DRAFT, gp: "50" });
    expect(editPayload(e, " Silver dagger", d)).toMatchObject({ ok: true, unchanged: true });
    const changed = editPayload(e, "Silver dagger", { ...d, gp: "5" });
    expect(changed).toMatchObject({ ok: true, unchanged: false });
    expect(changed.ok && changed.value).toEqual({
      entryId: "e",
      text: "Silver dagger",
      cp: 0,
      sp: 0,
      ep: 0,
      gp: 5,
      pp: 0,
    });
    expect(editPayload(e, "", EMPTY_DRAFT).ok).toBe(false);
  });

  test("FR-LOOT-16 FR-LOOT-17 FR-LOOT-18 locks: invalid / not live / in flight / unchanged", () => {
    expect(submitEnabled({ valid: true, live: true, busy: false })).toBe(true);
    expect(submitEnabled({ valid: false, live: true, busy: false })).toBe(false);
    expect(submitEnabled({ valid: true, live: false, busy: false })).toBe(false);
    expect(submitEnabled({ valid: true, live: true, busy: true })).toBe(false);
    expect(submitEnabled({ valid: true, live: true, busy: false, unchanged: true })).toBe(false);
  });

  test("FR-LOOT-16 outcomes: reject → inline; lost to a disconnect → toast", () => {
    expect(intentFailure(new IntentRejected("invalid", "Bad coins"), LOST_ADD)).toEqual({
      kind: "inline",
      message: "Bad coins",
    });
    for (const code of ["disconnected", "offline"]) {
      expect(intentFailure(new IntentRejected(code, "Connection lost"), LOST_ADD)).toEqual({
        kind: "toast",
        message: "Connection lost — check the loot log before adding again",
      });
    }
  });
});

describe("FR-LOOT-18 Move form options", () => {
  test("FR-LOOT-18 DM: pot, every character, outside; outside only opposite a character", () => {
    expect(keys(fromOptions(chars, dm))).toEqual(["party", "char:a", "char:m", "char:t", "world"]);
    expect(keys(toOptions(chars, dm, "party"))).toEqual(["char:a", "char:m", "char:t"]);
    expect(keys(toOptions(chars, dm, "char:m"))).toEqual(["party", "char:a", "char:t", "world"]);
    expect(keys(toOptions(chars, dm, "world"))).toEqual(["char:a", "char:m", "char:t"]);
  });

  test("FR-LOOT-18 player: From = own + pot; To = pot + others, or own only from the pot", () => {
    expect(keys(fromOptions(chars, p1))).toEqual(["char:m", "party"]);
    expect(keys(toOptions(chars, p1, "char:m"))).toEqual(["party", "char:a", "char:t"]);
    expect(keys(toOptions(chars, p1, "party"))).toEqual(["char:m"]);
    expect(keys(fromOptions(chars, p2))).toEqual(["char:a", "char:t", "party"]);
    expect(keys(toOptions(chars, p2, "party"))).toEqual(["char:a", "char:t"]);
    expect(fromOptions([], p1).map((o) => o.label)).toEqual(["Party pot"]);
  });

  test("FR-LOOT-18 no characters: no From → To pair (empty state, no Move)", () => {
    expect(canMove([], dm)).toBe(false);
    expect(canMove([], p1)).toBe(false);
    expect(canMove(chars, dm)).toBe(true);
    expect(canMove(chars, p1)).toBe(true);
    expect(canMove([{ id: "x", name: "Xan", ownerPlayerId: "p9" }], dm)).toBe(true);
  });

  test("FR-LOOT-18 payload mirrors FR-LOOT-06/07", () => {
    const gp = (v: string) => ({ ...EMPTY_DRAFT, gp: v });
    expect(movePayload(chars, p1, "char:m", "char:t", "Thanks", gp("3"))).toEqual({
      ok: true,
      value: {
        from: { kind: "character", characterId: "m" },
        to: { kind: "character", characterId: "t" },
        text: "Thanks",
        cp: 0,
        sp: 0,
        ep: 0,
        gp: 3,
        pp: 0,
      },
    });
    expect(movePayload(chars, p1, "char:t", "char:m", "", gp("3")).ok).toBe(false);
    expect(movePayload(chars, p1, "party", "char:t", "", gp("3")).ok).toBe(false);
    expect(movePayload(chars, p1, "char:m", "world", "", gp("3")).ok).toBe(false);
    expect(movePayload(chars, dm, "char:m", "world", "", gp("3")).ok).toBe(true);
    expect(movePayload(chars, dm, "party", "char:m", "", EMPTY_DRAFT).ok).toBe(false);
    expect(movePayload(chars, dm, "party", "char:m", "", gp("-1")).ok).toBe(false);
    expect(movePayload(chars, dm, "party", "char:m", "x".repeat(101), gp("1")).ok).toBe(false);
  });
});

describe("item rows (FR-PARTY-25)", () => {
  test("FR-PARTY-25 item row text: ‹from› → ‹to›: ‹name› ×‹qty›", () => {
    const names = new Map(chars.map((c) => [c.id, c.name]));
    const nameOf = (id: string) => names.get(id);
    const item = (from: LootEntryRecord["from"], to: LootEntryRecord["to"]) => ({
      ...entry({ kind: "item", text: "Healer's kit", from, to }),
      qty: 1,
    });
    expect(itemLine(item({ kind: "world" }, { kind: "party" }), nameOf)).toBe(
      "Outside the party → Party: Healer's kit ×1",
    );
    expect(itemLine(item({ kind: "party" }, { kind: "character", characterId: "m" }), nameOf)).toBe(
      "Party → Mira: Healer's kit ×1",
    );
    expect(
      itemLine(item({ kind: "character", characterId: "gone" }, { kind: "party" }), nameOf),
    ).toBe("Unknown character → Party: Healer's kit ×1");
  });
});

describe("Split… dialog (FR-PARTY-27)", () => {
  const coins = (c: Partial<Record<"cp" | "sp" | "ep" | "gp" | "pp", number>>) => ({
    cp: 0,
    sp: 0,
    ep: 0,
    gp: 0,
    pp: 0,
    ...c,
  });

  test("FR-PARTY-27 coins prefilled with the pot's positive coins", () => {
    expect(splitPrefill(coins({ pp: 5, gp: 30, sp: -4, cp: 0 }))).toEqual({
      ...EMPTY_DRAFT,
      pp: "5",
      gp: "30",
    });
    expect(splitPrefill(coins({}))).toEqual(EMPTY_DRAFT);
  });

  test("FR-PARTY-27 a checkbox per character by name; approved (not draft, no sheet = ready) ticked", () => {
    const status: Record<string, "draft" | "ready"> = { a: "draft", t: "ready" };
    expect(
      splitCharacters(chars, (id) => status[id]).map((x) => [x.character.id, x.ticked]),
    ).toEqual([
      ["a", false],
      ["m", true],
      ["t", true],
    ]);
  });

  test("FR-PARTY-27 preview 'Each gets …; … stays in the pot'; invalid → message, Split disabled", () => {
    const order = ["a", "m", "t"];
    const ok = splitPayload(order, new Set(["t", "m"]), { ...EMPTY_DRAFT, pp: "5", gp: "30" });
    expect(ok).toEqual({
      ok: true,
      value: { characterIds: ["m", "t"], ...coins({ pp: 5, gp: 30 }) },
      preview: "Each gets 2 pp, 15 gp; 1 pp stays in the pot",
    });
    expect(splitPayload(order, new Set(["m"]), { ...EMPTY_DRAFT, gp: "30" })).toMatchObject({
      ok: true,
      preview: "Each gets 30 gp",
    });
    const bad = (ticked: string[], draft: Partial<typeof EMPTY_DRAFT>) =>
      splitPayload(order, new Set(ticked), { ...EMPTY_DRAFT, ...draft });
    expect(bad(["m", "t"], { gp: "1" })).toEqual({ ok: false, message: "Nothing to split" });
    expect(bad(["m"], {})).toEqual({ ok: false, message: "Nothing to split" });
    expect(bad([], { gp: "30" })).toEqual({ ok: false, message: "Choose at least one character" });
    expect(bad(["m"], { gp: "-3" }).ok).toBe(false);
    expect(bad(["m"], { gp: "1.5" }).ok).toBe(false);
    expect(bad(["m"], { gp: "1000000" }).ok).toBe(false);
    for (const p of [ok, bad(["m", "t"], { gp: "1" })]) {
      expect(submitEnabled({ valid: p.ok, live: true, busy: false })).toBe(p.ok);
    }
    expect(submitEnabled({ valid: ok.ok, live: false, busy: false })).toBe(false);
    expect(submitEnabled({ valid: ok.ok, live: true, busy: true })).toBe(false);
  });

  test("FR-PARTY-27 lost split → toast; reject → inline", () => {
    expect(intentFailure(new IntentRejected("disconnected", "x"), LOST_SPLIT)).toEqual({
      kind: "toast",
      message: "Connection lost — check the loot log before splitting again",
    });
    expect(
      intentFailure(new IntentRejected("not_found", "Character not found"), LOST_SPLIT),
    ).toEqual({ kind: "inline", message: "Character not found" });
  });
});
