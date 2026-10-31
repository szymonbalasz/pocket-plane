// RS3 (HOLD §13 / LOOT §13 / PARTY §13 client tests; FR-HOLD-28, FR-LOOT-34–37, FR-PARTY-77): the
// Move form's Stores options and preset per viewer, log names from `stronghold-index`, the Stores
// item rules, and static renders of the Stronghold window's Stores tab, the Loot tab and the
// Inventory tab over a fake sync store with `hold-greystone-stores`' rows (DM full; player-1
// without the DM-only gem and the hidden tower). Clicks and live frames: `e2e/hold-stores.e2e.ts`
// and walkthrough RS-H H7, H10, H13. Server rules (rights, redaction, conservation):
// `src/server/features/strongholds/stores.test.ts`.
import { afterEach, describe, expect, test } from "bun:test";
import { PARTY_ITEM_TYPE, type PartyItemRecord } from "@shared/party-board/schemas";
import {
  LOOT_ENTRY_TYPE,
  type LootEntryRecord,
  PARTY_POT_TYPE,
  STORES_COIN_TYPE,
  type StoresCoinRecord,
  WALLET_TYPE,
} from "@shared/party-loot/schemas";
import type { You } from "@shared/protocol/frames";
import { lazyAfterSnapshot, markLoaded } from "@shared/protocol/lazy";
import { emptyStore } from "@shared/protocol/store";
import {
  indexOf,
  redactIndex,
  STRONGHOLD_INDEX_TYPE,
  type StrongholdRecord,
} from "@shared/strongholds/schemas";
import { TooltipProvider } from "@ui/components/ui/overlays";
import { SyncContext, type SyncState } from "@ui/sync/store";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { InventoryTab } from "../party-board/Inventory";
import {
  addPayload,
  editDraftOf,
  editPayload,
  holderCopy,
  holderGiveTargets,
  holderRows,
  holderTakePayload,
  holderTakeTargets,
  STORES_EMPTY,
  storesItemKey,
} from "../party-board/inventory-logic";
import { LootLog } from "../party-loot/LootLog";
import {
  type CharacterRef,
  canMove,
  endpointLabel,
  fromOptions,
  itemLine,
  MOVE_TO_PARTY,
  type MoveScope,
  movePayload,
  storesKey,
  storesRefs,
  toOptions,
} from "../party-loot/logic";
import { createWindowRegistry } from "../play-shell/registry";
import { ShellProvider } from "../play-shell/ShellContext";
import { HOLD_TABS, visibleTabs } from "./logic";
import { holdMemory } from "./memory";
import { StoresTab } from "./StoresTab";
import { strongholdWindow } from "./window";

const DM: You = { campaignId: "c", role: "dm", playerId: null };
const P1: You = { campaignId: "c", role: "player", playerId: "p1" };
const dmV = { role: "dm" as const, playerId: null };
const p1V = { role: "player" as const, playerId: "p1" };

const chars: CharacterRef[] = [
  { id: "mira", name: "Mira", ownerPlayerId: "p1" },
  { id: "thorn", name: "Thorn", ownerPlayerId: "p2" },
];
const keys = (o: { key: string }[]) => o.map((x) => x.key);

const GREY = { id: "grey", campaignId: "c", name: "Greystone Keep", dmOnly: false };
const TOWER = { id: "tower", campaignId: "c", name: "HOLD-SECRET-TOWER", dmOnly: true };
const dmIndex = [indexOf(GREY), indexOf(TOWER)];
const p1Index = [redactIndex(indexOf(GREY))];
const dmScope: MoveScope = { stores: storesRefs(dmIndex) };
const p1Scope: MoveScope = { stores: storesRefs(p1Index) };

const item = (id: string, name: string, qty: number, more: Partial<PartyItemRecord> = {}) =>
  ({
    id,
    campaignId: "c",
    seq: 1,
    name,
    qty,
    notes: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...more,
  }) as PartyItemRecord;
const inGrey = { strongholdId: "grey" };
const ITEMS = [
  item("potion", "Potion of healing", 2, { seq: 1 }),
  item("rope", "Rope", 2, { seq: 2, ...inGrey }),
  item("arrows", "Arrows", 40, { seq: 3, ...inGrey, notes: "Silvered, kept in the vault." }),
  item("gem", "HOLD-SECRET-GEM", 1, { seq: 4, ...inGrey, dmOnly: true }),
  item("secret", "HOLD-SECRET-ITEM", 1, { seq: 5, strongholdId: "tower", storesHidden: true }),
];
const coin = (id: string, gp: number, hidden?: true): StoresCoinRecord => ({
  id,
  campaignId: "c",
  strongholdId: id,
  cp: 0,
  sp: 0,
  ep: 0,
  gp,
  pp: 0,
  ...(hidden ? { hidden } : {}),
});
const entry = (id: string, seq: number, o: Partial<LootEntryRecord>): LootEntryRecord => ({
  id,
  campaignId: "c",
  seq,
  kind: "move",
  from: { kind: "world" },
  to: { kind: "party" },
  text: "",
  cp: 0,
  sp: 0,
  ep: 0,
  gp: 0,
  pp: 0,
  createdAt: `2026-01-01T00:00:0${seq}.000Z`,
  editedAt: null,
  ...o,
});
const stores = (strongholdId: string) => ({ kind: "stores" as const, strongholdId });
const ENTRIES = [
  entry("e1", 1, { from: stores("grey"), to: { kind: "party" }, gp: 50 }),
  entry("e2", 2, {
    kind: "item",
    from: stores("grey"),
    to: { kind: "character", characterId: "mira" },
    text: "Arrows",
    qty: 20,
  }),
  entry("e3", 3, { from: stores("gone"), to: { kind: "party" }, gp: 5 }),
];
// Player-1's copy: the tower's end redacted to `outside`, no `seq` (FR-LOOT-32).
const P1_ENTRIES = [
  ...ENTRIES.slice(0, 2),
  entry("e4", 4, { from: { kind: "outside" }, to: { kind: "party" }, gp: 5 }),
].map(({ seq: _seq, ...e }) => e);

const byId = <T extends { id: string }>(rows: readonly T[]) =>
  Object.fromEntries(rows.map((r) => [r.id, r]));

/** The records a viewer holds: DM full; player-1 per FR-LOOT-31, -32, -36 / FR-HOLD-01. */
function recordsFor(you: You) {
  const dm = you.role === "dm";
  return {
    [STRONGHOLD_INDEX_TYPE]: byId(dm ? dmIndex : p1Index),
    [PARTY_ITEM_TYPE]: byId(dm ? ITEMS : ITEMS.filter((i) => !i.dmOnly && !i.storesHidden)),
    [STORES_COIN_TYPE]: byId(
      dm ? [coin("grey", 120), coin("tower", 10, true)] : [coin("grey", 120)],
    ),
    [LOOT_ENTRY_TYPE]: byId(dm ? ENTRIES : P1_ENTRIES),
    [PARTY_POT_TYPE]: {},
    [WALLET_TYPE]: {},
    entity: byId(chars.map((c) => ({ ...c, kind: "character" }))),
  };
}

function render(node: ReactNode, you: You, o: { live?: boolean; loaded?: boolean } = {}) {
  let lazy = lazyAfterSnapshot(1);
  if (o.loaded !== false) lazy = { ...lazy, loaded: markLoaded(lazy.loaded, PARTY_ITEM_TYPE) };
  const store = createStore<SyncState>()(
    () =>
      ({
        state: o.live === false ? "reconnecting" : "live",
        everLive: true,
        store: { ...emptyStore(), you, records: recordsFor(you) },
        lazy,
        connection: { load: () => null, retryLoad: () => null },
      }) as unknown as SyncState,
  );
  const g = globalThis as { document?: unknown };
  g.document = { title: "", hidden: false };
  return renderToStaticMarkup(
    <SyncContext.Provider value={store}>
      <ShellProvider registry={createWindowRegistry(you.role, [strongholdWindow])}>
        <TooltipProvider delayDuration={0} skipDelayDuration={0}>
          {node}
        </TooltipProvider>
      </ShellProvider>
    </SyncContext.Provider>,
  );
}

const attrs = (html: string, testId: string, attr: string) =>
  [...html.matchAll(new RegExp(`<[^>]*data-testid="${testId}"[^>]*>`, "g"))].map(
    (m) => m[0].match(new RegExp(`${attr}="([^"]*)"`))?.[1] ?? "",
  );
const texts = (html: string, testId: string) =>
  [...html.matchAll(new RegExp(`data-testid="${testId}"[^>]*>(.*?)</span>`, "g"))].map((m) =>
    (m[1] ?? "").replace(/<[^>]+>/g, ""),
  );

afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
  holdMemory().bind(null);
});

/** Greystone as the window's tab body receives it (only id / name are read by the Stores tab). */
const greyParts = (dm: boolean) => ({ hold: { ...GREY } as unknown as StrongholdRecord, dm });

describe("Move form with Stores (FR-LOOT-33, -34)", () => {
  test("FR-LOOT-34 Move options: the DM gets every Stores (the tower with eye-off) and Outside the party ↔ Stores; player-1 Greystone's only, per FR-LOOT-33", () => {
    expect(storesRefs(dmIndex)).toEqual([
      { id: "grey", name: "Greystone Keep", hidden: false },
      { id: "tower", name: "HOLD-SECRET-TOWER", hidden: true },
    ]);
    const dmFrom = fromOptions(chars, dmV, dmScope);
    expect(keys(dmFrom)).toEqual([
      "party",
      "char:mira",
      "char:thorn",
      "stores:grey",
      "stores:tower",
      "world",
    ]);
    expect(dmFrom.find((o) => o.key === "stores:tower")).toEqual({
      key: "stores:tower",
      label: "HOLD-SECRET-TOWER Stores",
      hidden: true,
    });
    expect(dmFrom.find((o) => o.key === "stores:grey")?.hidden).toBeUndefined();
    expect(keys(toOptions(chars, dmV, "world", dmScope))).toEqual([
      "char:mira",
      "char:thorn",
      "stores:grey",
      "stores:tower",
    ]);
    expect(keys(toOptions(chars, dmV, "stores:grey", dmScope))).toContain("world");
    expect(keys(toOptions(chars, dmV, "party", dmScope))).not.toContain("world");
    // Player-1: own character, pot, Greystone; Stores → pot / own; pot → own / Stores.
    expect(keys(fromOptions(chars, p1V, p1Scope))).toEqual(["char:mira", "party", "stores:grey"]);
    expect(keys(toOptions(chars, p1V, "stores:grey", p1Scope))).toEqual(["party", "char:mira"]);
    expect(keys(toOptions(chars, p1V, "party", p1Scope))).toEqual(["char:mira", "stores:grey"]);
    expect(keys(toOptions(chars, p1V, "char:mira", p1Scope))).toEqual([
      "party",
      "char:thorn",
      "stores:grey",
    ]);
    // A player with no character can still move with a visible Stores.
    expect(canMove([], p1V)).toBe(false);
    expect(canMove([], p1V, p1Scope)).toBe(true);
  });

  test("FR-LOOT-34 Move to party from Stores: the preset puts the Stores first, To = Party pot, and only pairs with that Stores; 50 gp → loot.move {stores → party}", () => {
    const preset: MoveScope = { ...p1Scope, preset: storesKey("grey") };
    const froms = fromOptions(chars, p1V, preset);
    expect(keys(froms)).toEqual(["stores:grey", "char:mira", "party"]);
    expect(keys(toOptions(chars, p1V, "stores:grey", preset))[0]).toBe("party");
    expect(keys(toOptions(chars, p1V, "char:mira", preset))).toEqual(["stores:grey"]);
    const draft = { cp: "", sp: "", ep: "", gp: "50", pp: "" };
    expect(movePayload(chars, p1V, "stores:grey", "party", "", draft, preset)).toEqual({
      ok: true,
      value: {
        from: { kind: "stores", strongholdId: "grey" },
        to: { kind: "party" },
        text: "",
        cp: 0,
        sp: 0,
        ep: 0,
        gp: 50,
        pp: 0,
      },
    });
    // Pot → own character isn't this Stores' move.
    expect(movePayload(chars, p1V, "party", "char:mira", "", draft, preset).ok).toBe(false);
    // The DM's coin in / out: Outside the party ↔ Stores.
    const dmPreset: MoveScope = { ...dmScope, preset: storesKey("grey") };
    expect(keys(fromOptions(chars, dmV, dmPreset))).toContain("world");
    expect(keys(toOptions(chars, dmV, "stores:grey", dmPreset))).toContain("world");
    expect(movePayload(chars, dmV, "world", "stores:grey", "", draft, dmPreset).ok).toBe(true);
    expect(MOVE_TO_PARTY).toBe("Move to party");
  });
});

describe("Log names (FR-LOOT-35)", () => {
  test("FR-LOOT-35 log rendering: Stores ends named from stronghold-index; no index row → 'Stores (removed)'; a redacted end → 'Outside the party'", () => {
    const name = (id: string) => (id === "grey" ? "Greystone Keep" : undefined);
    const nameOf = (id: string) => (id === "mira" ? "Mira" : undefined);
    expect(endpointLabel(stores("grey"), nameOf, name)).toBe("Greystone Keep Stores");
    expect(endpointLabel(stores("gone"), nameOf, name)).toBe("Stores (removed)");
    expect(endpointLabel({ kind: "outside" }, nameOf, name)).toBe("Outside the party");
    expect(itemLine({ ...(ENTRIES[1] as LootEntryRecord), qty: 20 }, nameOf, name)).toBe(
      "Greystone Keep Stores → Mira: Arrows ×20",
    );
  });

  test("FR-LOOT-35 the Loot tab names Stores (a named Stores links to its window), the DM's tower too; player-1 reads 'Outside the party' for the hidden one; the pot strip lists no Stores", () => {
    const dm = render(<LootLog />, DM);
    expect(texts(dm, "loot-entry-route")).toEqual([
      "Stores (removed) → Party pot",
      "Greystone Keep Stores → Party pot",
    ]);
    expect(texts(dm, "loot-entry-item")).toEqual(["Greystone Keep Stores → Mira: Arrows ×20"]);
    expect(attrs(dm, "loot-entry-stores", "data-record-id")).toEqual(["grey", "grey"]);
    expect(dm).not.toContain("loot-stores-coin");
    const p1 = render(<LootLog />, P1);
    expect(texts(p1, "loot-entry-route")).toEqual([
      "Outside the party → Party pot",
      "Greystone Keep Stores → Party pot",
    ]);
    expect(p1).not.toContain("HOLD-SECRET");
    expect(p1).not.toContain("tower");
  });
});

describe("Stores items (FR-LOOT-36, -37, FR-PARTY-77)", () => {
  test("FR-PARTY-77 full text: an item's long name wraps and its notes show whole on their own line", () => {
    const html = render(<StoresTab parts={greyParts(true)} />, DM);
    const name = /<span data-testid="party-item-name"[^>]*>/.exec(html)?.[0] ?? "";
    expect(name).toContain("break-words");
    expect(name).not.toContain("truncate");
    const notes = /<p data-testid="party-item-notes"[^>]*>([^<]*)<\/p>/.exec(html);
    expect(notes?.[1]).toBe("Silvered, kept in the vault.");
    expect(notes?.[0]).toContain("whitespace-pre-wrap");
    expect(html).not.toContain("max-w-[30%]");
  });

  test("FR-PARTY-77 inventory without Stores rows: the party list skips every row with a strongholdId; a Stores lists its own", () => {
    expect(holderRows(ITEMS, null).map((i) => i.id)).toEqual(["potion"]);
    expect(holderRows(ITEMS, stores("grey")).map((i) => i.id)).toEqual(["rope", "arrows", "gem"]);
    const html = render(<InventoryTab />, DM);
    expect(attrs(html, "party-item-row", "data-record-id")).toEqual(["potion"]);
    expect(attrs(html, "party-item-row", "data-holder")).toEqual(["party"]);
    for (const n of ["Rope", "Arrows", "HOLD-SECRET"]) expect(html).not.toContain(n);
  });

  test("FR-LOOT-37 Stores item payloads: Add to Stores sends holder + dmOnly; Take / Move… → Party or a character; Give… only into this Stores; Edit sends dmOnly on Stores rows only", () => {
    const g = stores("grey");
    expect(addPayload({ name: "Arrows", qty: "5", notes: "", dmOnly: true }, g)).toEqual({
      ok: true,
      value: { name: "Arrows", qty: 5, notes: "", holder: g, dmOnly: true },
    });
    expect(addPayload({ name: "Rope", qty: "1", notes: "" })).toEqual({
      ok: true,
      value: { name: "Rope", qty: 1, notes: "" },
    });
    expect(keys(holderTakeTargets(chars, p1V, g))).toEqual(["party", "character:mira"]);
    expect(keys(holderTakeTargets(chars, dmV, g))).toEqual([
      "party",
      "character:mira",
      "character:thorn",
    ]);
    expect(keys(holderTakeTargets(chars, p1V, null))).toEqual(["character:mira"]);
    const arrows = ITEMS[2] as PartyItemRecord;
    expect(holderTakePayload(arrows, g, "character:mira", "20")).toEqual({
      ok: true,
      value: { from: g, to: { kind: "character", characterId: "mira" }, qty: 20, itemId: "arrows" },
    });
    expect(holderTakePayload(arrows, g, "party", "41")).toEqual({
      ok: false,
      message: "Only 40 left",
    });
    expect(holderGiveTargets(chars, p1V, "mira", g, "Greystone Keep Stores")).toEqual([
      { key: storesItemKey("grey"), label: "Greystone Keep Stores" },
    ]);
    const gem = ITEMS[3] as PartyItemRecord;
    expect(editDraftOf(gem).dmOnly).toBe(true);
    expect(editPayload(gem, { ...editDraftOf(gem), dmOnly: false })).toEqual({
      ok: true,
      value: { itemId: "gem", name: "HOLD-SECRET-GEM", qty: 1, notes: "", dmOnly: false },
      unchanged: false,
    });
    expect(editPayload(gem, editDraftOf(gem)).unchanged).toBe(true);
    const potion = ITEMS[0] as PartyItemRecord;
    expect(editPayload(potion, { ...editDraftOf(potion), qty: "3" })).toEqual({
      ok: true,
      value: { itemId: "potion", name: "Potion of healing", qty: 3, notes: "" },
      unchanged: false,
    });
    expect(holderCopy(g).empty).toBe(STORES_EMPTY);
  });
});

describe("Stores tab (FR-HOLD-28)", () => {
  test("FR-HOLD-28 the Stronghold window's tabs: Facilities, Staff, Stores, Reminders, Notes; players see Stores too", () => {
    expect(HOLD_TABS).toEqual(["facilities", "staff", "stores", "reminders", "notes"]);
    expect(visibleTabs({ role: "player" }, { notes: "" })).toContain("stores");
  });

  test("FR-HOLD-28 FR-LOOT-34 DM Stores tab: 120 gp strip, the Move form preset ('Move to party'), Rope, Arrows and the DM-only gem with eye-off, Add to Stores with DM only", () => {
    const html = render(<StoresTab parts={greyParts(true)} />, DM);
    expect(attrs(html, "hold-stores", "data-record-id")).toEqual(["grey"]);
    expect(attrs(html, "loot-stores-coin", "data-value")).toEqual(["gp"]);
    expect(html).toContain(">120 gp<");
    expect(attrs(html, "loot-move", "data-preset")).toEqual(["stores"]);
    expect(html).toMatch(new RegExp(`data-testid="loot-move-title"[^>]*>${MOVE_TO_PARTY}</h3>`));
    expect(attrs(html, "party-item-row", "data-record-id")).toEqual(["arrows", "gem", "rope"]);
    expect(attrs(html, "party-item-row", "data-holder")).toEqual(["stores", "stores", "stores"]);
    expect(attrs(html, "party-item-row", "data-dm-only")).toEqual(["false", "true", "false"]);
    expect(html).toContain('data-testid="party-item-dm-only"');
    expect(html).toContain('data-testid="loot-stores-add"');
    expect(html).toContain('data-testid="loot-stores-add-dm-only"');
    expect(html).toContain("Add to Stores");
    expect(html).not.toContain("Potion of healing");
  });

  test("FR-HOLD-28 FR-LOOT-36 player-1 Stores tab: Move to party, Take on Rope and Arrows, Give…; no gem, no DM controls", () => {
    const html = render(<StoresTab parts={greyParts(false)} />, P1);
    expect(attrs(html, "loot-move", "data-preset")).toEqual(["stores"]);
    expect(attrs(html, "party-item-row", "data-record-id")).toEqual(["arrows", "rope"]);
    expect(attrs(html, "party-item-take", "data-testid")).toHaveLength(2);
    expect(html).toContain(">Take<");
    expect(html).toContain('data-testid="party-item-give"');
    for (const forbidden of [
      "HOLD-SECRET",
      "loot-stores-add",
      "party-item-edit",
      "party-item-remove",
      "data-dm-only",
    ]) {
      expect(html).not.toContain(forbidden);
    }
  });

  test("FR-HOLD-28 empty Stores read 'Stores are empty'; disconnected → actions disabled", () => {
    const empty = render(
      <StoresTab
        parts={{
          ...greyParts(false),
          hold: { ...GREY, id: "tower2" } as unknown as StrongholdRecord,
        }}
      />,
      P1,
    );
    expect(empty).toContain(STORES_EMPTY);
    expect(empty).toContain('data-testid="loot-stores-coin-empty"');
    const off = render(<StoresTab parts={greyParts(true)} />, DM, { live: false });
    expect(off).toMatch(/data-testid="party-item-take"[^>]*disabled/);
    expect(off).toMatch(/<fieldset disabled=""/);
  });
});

describe("Sprint 10 H4 (BL-96)", () => {
  test("FR-LOOT-33 FR-LOOT-34 BL-96 a party-inventory row's Take / Move… also offers the Stores the viewer may use: player-1 the shown Greystone only, the DM both (the tower marked); the payload moves party → Stores", () => {
    const p1 = holderTakeTargets(chars, p1V, null, storesRefs(p1Index));
    expect(p1).toEqual([
      { key: "character:mira", label: "Mira" },
      { key: storesItemKey("grey"), label: "Greystone Keep Stores" },
    ]);
    expect(JSON.stringify(p1)).not.toContain("tower");
    expect(JSON.stringify(p1)).not.toContain("HOLD-SECRET");
    const dm = holderTakeTargets(chars, dmV, null, storesRefs(dmIndex));
    expect(dm).toEqual([
      { key: "character:mira", label: "Mira" },
      { key: "character:thorn", label: "Thorn" },
      { key: storesItemKey("grey"), label: "Greystone Keep Stores" },
      { key: storesItemKey("tower"), label: "HOLD-SECRET-TOWER Stores", hidden: true },
    ]);
    // A Stores' own rows never offer Stores (Stores → Stores isn't a move, FR-LOOT-33).
    expect(keys(holderTakeTargets(chars, p1V, stores("grey"), storesRefs(p1Index)))).toEqual([
      "party",
      "character:mira",
    ]);
    // No character but a shown Stores: the row still moves (into the Stores).
    expect(keys(holderTakeTargets([], p1V, null, storesRefs(p1Index)))).toEqual(["stores:grey"]);
    const potion = ITEMS[0] as PartyItemRecord;
    expect(holderTakePayload(potion, null, storesItemKey("grey"), "1")).toEqual({
      ok: true,
      value: {
        from: { kind: "party" },
        to: { kind: "stores", strongholdId: "grey" },
        qty: 1,
        itemId: "potion",
      },
    });
  });
});
