// RS2 (HOLD §13 client tests; FR-HOLD-22–34, FR-PARTY-71, -72, -75, FR-SHELL-170–172): pure rules
// and static renders of the Strongholds tab and the Stronghold window over a fake sync store, with
// `hold-greystone`'s rows (DM full, player-1 redacted by the shared FR-HOLD-08 function). Clicks,
// live frames and layout: `e2e/hold-ui.e2e.ts` and walkthrough RS-H.
import { afterEach, describe, expect, test } from "bun:test";
import type { You } from "@shared/protocol/frames";
import { lazyAfterSnapshot, markLoaded } from "@shared/protocol/lazy";
import { emptyStore, type RecordMap } from "@shared/protocol/store";
import {
  indexOf,
  redactIndex,
  redactStronghold,
  STRONGHOLD_INDEX_TYPE,
  STRONGHOLD_TYPE,
  type StrongholdRecord,
  type StrongholdView,
} from "@shared/strongholds/schemas";
import { TooltipProvider } from "@ui/components/ui/overlays";
import { SyncContext, type SyncState } from "@ui/sync/store";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { openPartyTab } from "../party-board/open-tab";
import { PARTY_TAB_ENTRIES, partyTabs, shownTab, visibleTabIds } from "../party-board/party-tabs";
import { createPartyMemory, createTabState, tabKey } from "../party-board/seen";
import { createWindowRegistry } from "../play-shell/registry";
import { ShellProvider } from "../play-shell/ShellContext";
import { BANDS, SIZE_TABLE } from "../play-shell/size-table";
import { prefillDraft } from "./HoldReminders";
import { RemindersWithLinks } from "./links";
import {
  deleteBody,
  facilityDraft,
  facilityErrors,
  figuresLine,
  HOLD_GONE,
  HOLD_WINDOW_KIND,
  holdTabVisible,
  incomeRollIntent,
  NEW_FACILITY,
  NEW_STAFF,
  orderSuggestions,
  reminderGroups,
  reminderPrefill,
  removeFacilityBody,
  replacedBy,
  sameDraft,
  staffByFacility,
  staffErrors,
  stateSummary,
  totalsLine,
  visibleTabs,
} from "./logic";
import { createHoldMemory, holdKey, holdMemory, openStronghold } from "./memory";
import { StrongholdsTab } from "./StrongholdsTab";
import { StrongholdWindow } from "./StrongholdWindow";
import { strongholdWindow } from "./window";

const DM: You = { campaignId: "c", role: "dm", playerId: null };
const P1: You = { campaignId: "c", role: "player", playerId: "p1" };

const fac = (id: string, name: string, more: Partial<StrongholdRecord["facilities"][0]> = {}) => ({
  id,
  name,
  state: "built" as const,
  cost: null,
  buildDays: null,
  upkeep: null,
  incomeDice: null,
  effect: "",
  order: "",
  replacesId: null,
  dmOnly: false,
  ...more,
});
const staff = (id: string, name: string, more: Partial<StrongholdRecord["staff"][0]> = {}) => ({
  id,
  name,
  role: "",
  wage: null,
  notes: "",
  facilityId: null,
  dmOnly: false,
  ...more,
});

/** `hold-greystone` (FR-HOLD-35) as the DM holds it. */
const GREY: StrongholdRecord = {
  id: "grey",
  campaignId: "c",
  seq: 1,
  name: "Greystone Keep",
  dmOnly: false,
  defenders: 12,
  defendersDmOnly: false,
  notes: "Rebuilt after the siege.",
  notesDmOnly: false,
  facilities: [
    fac("forge", "Forge Hall", { upkeep: 5, incomeDice: "2d6", order: "Craft: arrows" }),
    fac("herb", "Herb Beds", { state: "building", cost: 500, buildDays: 20 }),
    fac("map", "Map Room", { state: "planned", cost: 1000, buildDays: 30 }),
    fac("bath", "Old Bathhouse", { state: "replaced" }),
    fac("steam", "Steam Rooms", { upkeep: 3, replacesId: "bath" }),
    fac("vault", "HOLD-SECRET-VAULT", {
      effect: "HOLD-SECRET-VAULT keeps the old ledger.",
      dmOnly: true,
    }),
  ],
  staff: [
    staff("brenna", "Brenna", { role: "smith", wage: 2, facilityId: "forge" }),
    staff("tobin", "Tobin", { role: "gardener", wage: 1, facilityId: "herb" }),
    staff("spy", "HOLD-SECRET-SPY", { role: "cook", wage: 5, dmOnly: true }),
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const TOWER: StrongholdRecord = {
  ...GREY,
  id: "tower",
  seq: 2,
  name: "HOLD-SECRET-TOWER",
  dmOnly: true,
  notes: "HOLD-SECRET-NOTES",
  facilities: [fac("t1", "Top Room")],
  staff: [],
  createdAt: "2026-01-01T00:00:00.001Z",
};

const REM_BASE = {
  campaignId: "c",
  rolls: [],
  createdByPlayerId: null,
  seq: 1,
  dmOnly: false,
  ownerPlayerId: null,
  linkHidden: false,
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const REMINDERS = [
  {
    ...REM_BASE,
    id: "r-steam",
    characterId: null,
    text: "Steam Rooms: advantage on the first CON save after a long rest",
    source: "Greystone Keep: Steam Rooms",
    strongholdId: "grey",
    facilityId: "steam",
    createdAt: "2026-01-01T00:00:01.000Z",
  },
  {
    ...REM_BASE,
    id: "r-whole",
    characterId: "mira",
    ownerPlayerId: "p1",
    text: "Check the walls",
    source: "Greystone Keep",
    strongholdId: "grey",
    facilityId: null,
    createdAt: "2026-01-01T00:00:02.000Z",
  },
  {
    ...REM_BASE,
    id: "r-vault",
    characterId: null,
    text: "REM-SECRET-VAULT",
    source: "",
    strongholdId: "grey",
    facilityId: "vault",
    createdAt: "2026-01-01T00:00:03.000Z",
    dmOnly: false,
    linkHidden: true,
  },
];

interface StoreOpts {
  you: You;
  loaded?: boolean;
  failed?: boolean;
  live?: boolean;
}

/** The records a viewer holds: DM full, player-1 the redactions of shown ones. */
function recordsFor(you: You) {
  const all = [GREY, TOWER];
  const dm = you.role === "dm";
  const shown = dm ? all : all.filter((r) => !r.dmOnly);
  const map = <T extends { id: string }>(rows: T[]) =>
    Object.fromEntries(rows.map((r) => [r.id, r]));
  return {
    [STRONGHOLD_INDEX_TYPE]: map(shown.map((r) => (dm ? indexOf(r) : redactIndex(indexOf(r))))),
    [STRONGHOLD_TYPE]: map(shown.map((r) => (dm ? r : redactStronghold(r)) as StrongholdView)),
    reminder: map(dm ? REMINDERS : REMINDERS.filter((r) => !r.linkHidden)),
    entity: { mira: { id: "mira", name: "Mira" } },
  };
}

function render(node: ReactNode, o: StoreOpts) {
  let lazy = lazyAfterSnapshot(1);
  if (o.loaded !== false) {
    lazy = { ...lazy, loaded: markLoaded(markLoaded(lazy.loaded, STRONGHOLD_TYPE), "reminder") };
  }
  if (o.failed) lazy = { ...lazy, failed: markLoaded(lazy.failed, STRONGHOLD_TYPE) };
  const store = createStore<SyncState>()(
    () =>
      ({
        state: o.live === false ? "reconnecting" : "live",
        everLive: true,
        store: { ...emptyStore(), you: o.you, records: recordsFor(o.you) },
        lazy,
        connection: { load: () => null, retryLoad: () => null },
      }) as unknown as SyncState,
  );
  const g = globalThis as { document?: unknown };
  g.document = { title: "", hidden: false };
  return renderToStaticMarkup(
    <SyncContext.Provider value={store}>
      <ShellProvider registry={createWindowRegistry(o.you.role, [strongholdWindow])}>
        <TooltipProvider delayDuration={0} skipDelayDuration={0}>
          {node}
        </TooltipProvider>
      </ShellProvider>
    </SyncContext.Provider>,
  );
}

const memoryBackend = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
};

const attrs = (html: string, testId: string, attr: string) =>
  [...html.matchAll(new RegExp(`<[^>]*data-testid="${testId}"[^>]*>`, "g"))].map(
    (m) => m[0].match(new RegExp(`${attr}="([^"]*)"`))?.[1] ?? "",
  );

afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
  holdMemory().bind(null);
});

describe("Party Manager tab (FR-PARTY-71, -72, -75)", () => {
  test("FR-PARTY-71 tabs after PM's list: Strongholds at order 60, after Loot", () => {
    const tabs = partyTabs();
    expect(tabs.map((t) => t.id).slice(0, 4)).toEqual(["status", "handouts", "inventory", "loot"]);
    const hold = PARTY_TAB_ENTRIES.find((t) => t.id === "strongholds");
    expect(hold?.order).toBe(60);
    expect(hold?.label).toBe("Strongholds");
    expect(tabs.at(-1)?.id).toBe("strongholds");
  });

  test("FR-PARTY-72 strongholds tab per viewer: DM always; a player only with a stronghold-index row; a stored `strongholds` with none falls back to Party status", () => {
    const index = { grey: { id: "grey", campaignId: "c", name: "Greystone Keep" } };
    const store = (n: number) => ({
      ...emptyStore(),
      records: (n > 0 ? { [STRONGHOLD_INDEX_TYPE]: index } : {}) as RecordMap,
    });
    expect(visibleTabIds({ role: "dm", playerId: null, store: store(0) })).toContain("strongholds");
    expect(visibleTabIds({ role: "player", playerId: "p1", store: store(1) })).toContain(
      "strongholds",
    );
    const none = visibleTabIds({ role: "player", playerId: "p1", store: store(0) });
    expect(none).not.toContain("strongholds");
    expect(shownTab("strongholds", none)).toBe("status");
    expect(holdTabVisible({ role: "player" }, 0)).toBe(false);
    expect(holdTabVisible({ role: "dm" }, 0)).toBe(true);
  });

  test("FR-PARTY-75 open on a tab: `openPartyTab('strongholds')` stores the tab and opens the Party Manager", () => {
    const tabs = createTabState(createPartyMemory(memoryBackend));
    const opened: string[] = [];
    openPartyTab("strongholds", { you: DM, tabs, open: (k) => opened.push(k) });
    expect(tabs.state.getState().tab).toBe("strongholds");
    expect(tabs.state.getState().key).toBe(tabKey("c", "dm", null));
    expect(opened).toEqual(["party.board"]);
  });
});

describe("Strongholds tab (FR-HOLD-22)", () => {
  test("FR-HOLD-22 list per viewer: DM every stronghold by name with the DM-only Badge, New stronghold and row menus; a player only shown ones, no DM controls, no secret", () => {
    const dm = render(<StrongholdsTab />, { you: DM });
    expect(attrs(dm, "hold-row", "data-record-id")).toEqual(["grey", "tower"]);
    expect(attrs(dm, "hold-row", "data-dm-only")).toEqual(["false", "true"]);
    expect(dm).toContain('data-testid="hold-new"');
    expect(dm).toContain('data-testid="hold-new-name"');
    expect(attrs(dm, "hold-row-menu", "data-record-id")).toEqual(["grey", "tower"]);
    expect(dm).toContain("DM only");
    // Summary and Defenders from the loaded records (visible facilities only for players).
    expect(dm).toContain("3 built · 1 building · 1 planned · 1 replaced");
    expect(attrs(dm, "hold-row-defenders", "data-value")).toEqual(["12", "12"]);

    const p = render(<StrongholdsTab />, { you: P1 });
    expect(attrs(p, "hold-row", "data-record-id")).toEqual(["grey"]);
    expect(p).toContain("2 built · 1 building · 1 planned · 1 replaced");
    for (const forbidden of ["hold-new", "hold-row-menu", "HOLD-SECRET", "DM only"]) {
      expect(p).not.toContain(forbidden);
    }
  });

  test("FR-HOLD-22 rows render from the index at once; the summary fills in after the lazy load (skeleton until then); DM empty list", () => {
    const loading = render(<StrongholdsTab />, { you: DM, loaded: false });
    expect(attrs(loading, "hold-row", "data-record-id")).toEqual(["grey", "tower"]);
    expect(loading).not.toContain('data-testid="hold-row-summary"');
    expect(stateSummary([])).toBe("");
  });

  test("FR-PARTY-74 the tab loads `stronghold` when it mounts; a reject shows Retry", () => {
    const html = render(<StrongholdsTab />, { you: DM, loaded: false, failed: true });
    expect(html).toContain('data-testid="hold-retry"');
  });
});

describe("Stronghold window (FR-HOLD-23–34)", () => {
  const select = (you: You, id: string) => {
    const mem = holdMemory();
    mem.bind(holdKey(you));
    mem.select(id);
  };

  test('FR-HOLD-23 gone or hidden → "This stronghold isn\'t available"; loading → skeleton titled from the index; reject → Retry', () => {
    expect(
      render(<StrongholdWindow kind={HOLD_WINDOW_KIND} instance="main" />, { you: P1 }),
    ).toContain(HOLD_GONE.replace("'", "&#x27;"));
    select(P1, "tower"); // hidden from players: no index row
    const hidden = render(<StrongholdWindow kind={HOLD_WINDOW_KIND} instance="main" />, {
      you: P1,
    });
    expect(hidden).toContain('data-testid="hold-gone"');
    expect(hidden).not.toContain("HOLD-SECRET");
    select(DM, "grey");
    const loading = render(<StrongholdWindow kind={HOLD_WINDOW_KIND} instance="main" />, {
      you: DM,
      loaded: false,
    });
    expect(loading).toContain('data-testid="hold-loading"');
    expect(loading).toContain("Greystone Keep");
    const failed = render(<StrongholdWindow kind={HOLD_WINDOW_KIND} instance="main" />, {
      you: DM,
      loaded: false,
      failed: true,
    });
    expect(failed).toContain('data-testid="hold-retry"');
  });

  test("FR-HOLD-25 full text: a facility's effect shows whole, wrapped, line breaks kept; no clamp, no More", () => {
    select(DM, "grey");
    const html = render(<StrongholdWindow kind={HOLD_WINDOW_KIND} instance="main" />, { you: DM });
    const effect = /<p data-testid="hold-facility-effect"[^>]*>/.exec(html)?.[0] ?? "";
    expect(effect).toContain("whitespace-pre-wrap");
    expect(effect).toContain("break-words");
    expect(effect).not.toContain("line-clamp");
    expect(html).not.toContain("hold-facility-effect-more");
    expect(html).toContain("HOLD-SECRET-VAULT keeps the old ledger.");
  });

  test("FR-HOLD-24 FR-HOLD-25 DM view: header (Shown switch, Defenders, menu, All strongholds), five tabs (RS3's Stores third), six facilities in the DM's order with states, figures, Income, order, replaces / replaced by, staff, eye-off on the vault; totals incl. DM only", () => {
    select(DM, "grey");
    const html = render(<StrongholdWindow kind={HOLD_WINDOW_KIND} instance="main" />, { you: DM });
    expect(attrs(html, "hold-window", "data-record-id")).toEqual(["grey"]);
    expect(attrs(html, "hold-show", "data-value")).toEqual(["true"]);
    expect(attrs(html, "hold-defenders", "data-value")).toEqual(["12"]);
    expect(html).toContain('data-testid="hold-menu"');
    expect(html).toContain('data-testid="hold-all"');
    expect(attrs(html, "hold-tab", "data-value")).toEqual([
      "facilities",
      "staff",
      "stores",
      "reminders",
      "notes",
    ]);
    expect(attrs(html, "hold-facility", "data-record-id")).toEqual([
      "forge",
      "herb",
      "map",
      "bath",
      "steam",
      "vault",
    ]);
    expect(attrs(html, "hold-facility", "data-state")).toEqual([
      "built",
      "building",
      "planned",
      "replaced",
      "built",
      "built",
    ]);
    expect(attrs(html, "hold-facility", "data-dm-only")).toEqual([
      "false",
      "false",
      "false",
      "false",
      "false",
      "true",
    ]);
    expect(html).toContain("Cost 500 gp · 20 days");
    expect(html).toContain("Income 2d6");
    expect(html).toContain("Order: Craft: arrows");
    expect(html).toContain("Replaces Old Bathhouse");
    expect(html).toContain("Replaced by Steam Rooms");
    expect(html).toContain(">Brenna<");
    expect(html).toContain("Upkeep 8 gp · Wages 8 gp (incl. DM only)");
    expect(html).toContain('data-testid="hold-facility-add"');
    expect(html).toContain('data-testid="hold-facility-menu"');
  });

  test("FR-HOLD-24 FR-HOLD-25 player view: five facilities, no vault / spy, Defenders 12, no DM controls; totals over the visible rows", () => {
    select(P1, "grey");
    const html = render(<StrongholdWindow kind={HOLD_WINDOW_KIND} instance="main" />, { you: P1 });
    expect(attrs(html, "hold-facility", "data-record-id")).toEqual([
      "forge",
      "herb",
      "map",
      "bath",
      "steam",
    ]);
    expect(attrs(html, "hold-defenders", "data-value")).toEqual(["12"]);
    expect(html).toContain("Upkeep 8 gp · Wages 3 gp");
    expect(html).toContain("Income 2d6");
    for (const forbidden of [
      "HOLD-SECRET",
      "REM-SECRET",
      "hold-show",
      "hold-menu",
      "hold-facility-menu",
      "hold-facility-add",
      "incl. DM only",
    ]) {
      expect(html).not.toContain(forbidden);
    }
  });

  test("FR-HOLD-34 disconnected: last view, every action disabled", () => {
    select(DM, "grey");
    const html = render(<StrongholdWindow kind={HOLD_WINDOW_KIND} instance="main" />, {
      you: DM,
      live: false,
    });
    expect(html).toContain("Forge Hall");
    for (const id of [
      "hold-facility-add",
      "hold-facility-menu",
      "hold-facility-income",
      "hold-menu",
    ]) {
      const tag = html.match(new RegExp(`<[^>]*data-testid="${id}"[^>]*>`))?.[0] ?? "";
      expect({ id, disabled: /disabled=""/.test(tag) }).toEqual({ id, disabled: true });
    }
  });

  test("FR-HOLD-30 notes tab: players see it only when the notes are visible and non-empty; the DM always", () => {
    const p = redactStronghold(GREY);
    expect(visibleTabs({ role: "player" }, p)).toContain("notes");
    expect(
      visibleTabs({ role: "player" }, redactStronghold({ ...GREY, notesDmOnly: true })),
    ).not.toContain("notes");
    expect(visibleTabs({ role: "player" }, { ...p, notes: "" })).not.toContain("notes");
    expect(visibleTabs({ role: "dm" }, { ...GREY, notes: "" })).toContain("notes");
  });

  test("FR-HOLD-24 a DM-only defenders count: players get no chip", () => {
    select(P1, "grey");
    const r = redactStronghold({ ...GREY, defendersDmOnly: true });
    expect(r.defenders).toBeUndefined();
  });
});

describe("Pure rules (FR-HOLD-17, -19, -25, -26, -27, -29, -31, -32, -33)", () => {
  test("FR-HOLD-25 figures, replaced by, staff per facility", () => {
    expect(figuresLine({ cost: 500, buildDays: 20, upkeep: null })).toBe("Cost 500 gp · 20 days");
    expect(figuresLine({ cost: 1000, buildDays: 1, upkeep: 5 })).toBe(
      "Cost 1 000 gp · 1 day · Upkeep 5 gp",
    );
    expect(figuresLine({ cost: null, buildDays: null, upkeep: null })).toBe("");
    expect(replacedBy(GREY.facilities).get("bath")).toBe("Steam Rooms");
    expect(staffByFacility(GREY.staff).get("forge")).toEqual(["Brenna"]);
  });

  test("FR-HOLD-31 totals over the rows the viewer receives", () => {
    expect(totalsLine(GREY)).toBe("Upkeep 8 gp · Wages 8 gp (incl. DM only)");
    expect(totalsLine(redactStronghold(GREY))).toBe("Upkeep 8 gp · Wages 3 gp");
    // H9: Tobin DM-only → players' wages 2 gp.
    const tobinHidden = {
      ...GREY,
      staff: GREY.staff.map((m) => (m.id === "tobin" ? { ...m, dmOnly: true } : m)),
    };
    expect(totalsLine(redactStronghold(tobinHidden))).toBe("Upkeep 8 gp · Wages 2 gp");
  });

  test("FR-HOLD-32 order suggestions: distinct, most used first, ≤ 20, no built-in list", () => {
    const other = {
      facilities: [fac("a", "A", { order: "Recruit" }), fac("b", "B", { order: "Recruit" })],
    };
    expect(orderSuggestions([GREY, other])).toEqual(["Recruit", "Craft: arrows"]);
    expect(orderSuggestions([])).toEqual([]);
    const many = {
      facilities: Array.from({ length: 30 }, (_, i) => fac(`f${i}`, `F${i}`, { order: `O${i}` })),
    };
    expect(orderSuggestions([many])).toHaveLength(20);
  });

  test("FR-HOLD-17 FR-HOLD-19 confirm texts name the reminders and the Stores, including a negative balance", () => {
    expect(removeFacilityBody(1, 0)).toBe(
      "It leaves the Facilities list; its 1 reminder is removed too.",
    );
    expect(removeFacilityBody(2, 0)).toBe(
      "It leaves the Facilities list; its 2 reminders are removed too.",
    );
    const zero = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
    expect(deleteBody(3, 2, { ...zero, gp: 120 })).toBe(
      "3 reminders are removed; its Stores (2 items, 120 gp) move to the party.",
    );
    expect(deleteBody(0, 1, { ...zero, gp: 5 })).toBe(
      "No reminders are removed; its Stores (1 item, 5 gp) move to the party.",
    );
    expect(deleteBody(1, 0, { ...zero, gp: -15 })).toBe(
      "1 reminder is removed; its Stores owe 15 gp: the party pot pays it.",
    );
    expect(deleteBody(1, 1, { ...zero, gp: -15, sp: 3 })).toBe(
      "1 reminder is removed; its Stores (1 item, 3 sp) move to the party; they owe 15 gp: the party pot pays it.",
    );
  });

  test("FR-HOLD-26 facility editor draft: FR-HOLD-04 mirrored (name, numbers, dice notation, self-replace), unchanged detection", () => {
    expect(facilityErrors(NEW_FACILITY).name).toBeDefined();
    const ok = { ...NEW_FACILITY, name: "Forge Hall", incomeDice: "2d6", cost: "500" };
    expect(facilityErrors(ok)).toEqual({});
    expect(facilityErrors({ ...ok, incomeDice: "2d" }).incomeDice).toBeDefined();
    expect(facilityErrors({ ...ok, cost: "-1" }).cost).toBe("Cost: a whole number, 0 or more");
    expect(facilityErrors({ ...ok, cost: "1.5" }).cost).toBeDefined();
    expect(facilityErrors({ ...ok, upkeep: "100000" }).upkeep).toBeDefined();
    expect(facilityErrors({ ...ok, replacesId: "me" }, "me").replacesId).toBe("Not itself");
    const forge = GREY.facilities[0];
    if (!forge) throw new Error("fixture");
    expect(sameDraft(facilityDraft(forge), facilityDraft(forge))).toBe(true);
    expect(
      sameDraft({ ...facilityDraft(forge), order: "Craft: shields" }, facilityDraft(forge)),
    ).toBe(false);
  });

  test("FR-HOLD-27 staff editor draft: FR-HOLD-05 mirrored", () => {
    expect(staffErrors(NEW_STAFF).name).toBeDefined();
    expect(staffErrors({ ...NEW_STAFF, name: "Brenna", wage: "2" })).toEqual({});
    expect(staffErrors({ ...NEW_STAFF, name: "Brenna", wage: "x" }).wage).toBe(
      "Wage: a whole number, 0 or more",
    );
  });

  test("FR-HOLD-29 reminders grouped by facility, whole stronghold first; only those the viewer receives; prefill for Add / Make reminder", () => {
    const dm = reminderGroups("grey", GREY.facilities, REMINDERS);
    expect(dm.map((g) => [g.label, g.rows.map((r) => r.id)])).toEqual([
      ["Whole stronghold", ["r-whole"]],
      ["Steam Rooms", ["r-steam"]],
      ["HOLD-SECRET-VAULT", ["r-vault"]],
    ]);
    const p = redactStronghold(GREY);
    expect(
      reminderGroups(
        "grey",
        p.facilities,
        REMINDERS.filter((r) => !r.linkHidden),
      ).map((g) => g.label),
    ).toEqual(["Whole stronghold", "Steam Rooms"]);
    expect(reminderGroups("tower", GREY.facilities, REMINDERS)).toEqual([]);
    const steam = GREY.facilities[4];
    if (!steam) throw new Error("fixture");
    expect(reminderPrefill(GREY, { ...steam, effect: "x".repeat(600) })).toEqual({
      target: { kind: "party" },
      text: "x".repeat(500),
      source: "Greystone Keep: Steam Rooms",
      strongholdId: "grey",
      facilityId: "steam",
    });
    expect(reminderPrefill(GREY)).toMatchObject({
      text: "",
      source: "Greystone Keep",
      facilityId: null,
    });
  });

  test("FR-HOLD-29 the window's Reminders tab lists the linked reminders with their target (DM: the vault's with eye-off; players never)", () => {
    const mem = holdMemory();
    mem.bind(holdKey(DM));
    mem.select("grey");
    mem.chooseTab("reminders");
    const dm = render(<StrongholdWindow kind={HOLD_WINDOW_KIND} instance="main" />, { you: DM });
    expect(attrs(dm, "hold-reminder", "data-record-id")).toEqual(["r-whole", "r-steam", "r-vault"]);
    expect(dm).toContain(">Mira<");
    mem.bind(holdKey(P1));
    mem.select("grey");
    mem.chooseTab("reminders");
    const p = render(<StrongholdWindow kind={HOLD_WINDOW_KIND} instance="main" />, { you: P1 });
    expect(attrs(p, "hold-reminder", "data-record-id")).toEqual(["r-whole", "r-steam"]);
    expect(p).not.toContain("REM-SECRET");
  });

  test('FR-HOLD-33 income dice: the macros\' roll path, label "‹Facility› income", category other, no actor (rolls as DM / Me)', () => {
    expect(
      incomeRollIntent({ name: "Forge Hall", incomeDice: "2d6" }, { mode: "normal" } as Parameters<
        typeof incomeRollIntent
      >[1]),
    ).toEqual({ expression: "2d6", mode: "normal", category: "other", label: "Forge Hall income" });
  });
});

describe("Reminders wiring (FR-HOLD-29, FR-REM-18)", () => {
  test("FR-HOLD-29 Add reminder / Make reminder open REM's editor prefilled (party, linked, no rolls); the DM's tab has Add reminder and REM's rows, a player's neither the button nor a hidden row", () => {
    const steam = GREY.facilities[4];
    if (!steam) throw new Error("fixture");
    expect(prefillDraft(reminderPrefill(GREY, steam))).toEqual({
      target: "party",
      text: "",
      source: "Greystone Keep: Steam Rooms",
      rolls: [],
      dmOnly: false,
      strongholdId: "grey",
      facilityId: "steam",
    });
    expect(prefillDraft(reminderPrefill(GREY))).toMatchObject({
      source: "Greystone Keep",
      facilityId: null,
    });
    const mem = holdMemory();
    mem.bind(holdKey(DM));
    mem.select("grey");
    mem.chooseTab("reminders");
    const dm = render(<StrongholdWindow kind={HOLD_WINDOW_KIND} instance="main" />, { you: DM });
    expect(dm).toContain('data-testid="hold-reminders-add"');
    expect(attrs(dm, "rem-row", "data-record-id")).toEqual(["r-whole", "r-steam", "r-vault"]);
    mem.bind(holdKey(P1));
    mem.select("grey");
    mem.chooseTab("reminders");
    const p = render(<StrongholdWindow kind={HOLD_WINDOW_KIND} instance="main" />, { you: P1 });
    expect(p).not.toContain('data-testid="hold-reminders-add"');
    expect(attrs(p, "rem-row", "data-record-id")).toEqual(["r-whole", "r-steam"]);
  });

  test("FR-REM-18 the Party Manager's and the sheet's reminder rows carry the link icon that opens the Stronghold window", () => {
    const html = render(<RemindersWithLinks />, { you: DM });
    expect(attrs(html, "rem-row-link", "data-testid").length).toBeGreaterThan(0);
  });
});

describe("Window registration and memory (FR-SHELL-170–172, FR-HOLD-23)", () => {
  test("FR-SHELL-170 stronghold window registered: both clients, no launcher, loads closed; size row 480 × 560 / useful 400 × 400 / min 340 × 360 fits the 1280×720 band; no launcher entry for hold.*", () => {
    // Registered in both `windows.ts` (the size-table test fails on a row with no registered kind).
    expect(strongholdWindow.title).toBe("Stronghold");
    expect(strongholdWindow.launcher).toBeUndefined();
    expect(strongholdWindow.defaultOpen).toBe(false);
    expect(strongholdWindow.clients).toEqual(["dm", "player"]);
    expect(strongholdWindow.defaultSize).toEqual({ w: 480, h: 560 });
    expect(strongholdWindow.usefulSize).toEqual({ w: 400, h: 400 });
    expect(strongholdWindow.minSize).toEqual({ w: 340, h: 360 });
    expect(strongholdWindow.defaultPosition.anchor).toBe("top-right");
    for (const client of ["dm", "player"] as const) {
      const row = SIZE_TABLE[client][HOLD_WINDOW_KIND];
      expect(row?.useful[0]).toEqual({ w: 400, h: 400 });
      // FR-SHELL-171: the useful height fits PM1's 1280×720 band.
      expect(row?.useful[0]?.h ?? Infinity).toBeLessThanOrEqual(BANDS[client][0] ?? 0);
    }
  });

  test('FR-HOLD-23 selection kept per browser and viewer: `openStronghold` selects, opens `by: "user"`; the tab is remembered; an invalid entry → default', () => {
    const backend = memoryBackend();
    const warnings: string[] = [];
    const mem = createHoldMemory(
      () => backend,
      (m) => warnings.push(m),
    );
    const opened: unknown[] = [];
    openStronghold("grey", { you: P1, memory: mem, open: (...a) => opened.push(a) });
    expect(opened).toEqual([[HOLD_WINDOW_KIND, undefined, { by: "user" }]]);
    mem.chooseTab("staff");
    const again = createHoldMemory(() => backend);
    again.bind(holdKey(P1));
    expect(again.state.getState()).toMatchObject({ strongholdId: "grey", tab: "staff" });
    // Another viewer's key is separate.
    again.bind(holdKey(DM));
    expect(again.state.getState().strongholdId).toBeNull();
    backend.setItem(holdKey(DM) as string, "{bad");
    const third = createHoldMemory(
      () => backend,
      (m) => warnings.push(m),
    );
    third.bind(holdKey(DM));
    expect(third.state.getState()).toMatchObject({ strongholdId: null, tab: "facilities" });
    expect(warnings.length).toBe(1);
  });
});

describe("Sprint 10 H4 (BL-104)", () => {
  test("FR-HOLD-17 BL-104 the remove-facility confirm's body doesn't repeat its title: what leaves, the reminders removed, the staff kept", () => {
    const title = "Remove Steam Rooms?";
    const body = removeFacilityBody(1, 0);
    expect(body).not.toContain(title);
    expect(body).toBe("It leaves the Facilities list; its 1 reminder is removed too.");
    expect(removeFacilityBody(0, 0)).toBe(
      "It leaves the Facilities list; no reminders are linked to it.",
    );
    expect(removeFacilityBody(2, 1)).toBe(
      "It leaves the Facilities list; its 2 reminders are removed too; 1 staff member who works there stays, unassigned.",
    );
    expect(removeFacilityBody(0, 3)).toBe(
      "It leaves the Facilities list; no reminders are linked to it; 3 staff who work there stay, unassigned.",
    );
  });
});

describe("Sprint 10 H4 follow-up (orchestrator ruling 1)", () => {
  test("FR-HOLD-19 the stronghold Delete confirm's body doesn't repeat its 'Delete ‹name›?' title", () => {
    const zero = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
    const body = deleteBody(3, 2, { ...zero, gp: 120 });
    expect(body).not.toContain("Delete Greystone Keep?");
    expect(body).toBe("3 reminders are removed; its Stores (2 items, 120 gp) move to the party.");
    expect(deleteBody(0, 0)).toBe("No reminders are removed; its Stores are empty.");
  });
});
