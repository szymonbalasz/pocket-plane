// The `party.board` "Party Manager" frame (FR-PARTY-29, -50, -60, -67) as a static render over a
// fake sync store, per client role: tab order from the registry, Party status the landing tab, the
// Loot tab mounting party-loot's body, tab memory fallbacks, no "Coin: open Party loot" button.
// Clicking the tabs and the Loot tab's forms: e2e/party-loot-tab.e2e.ts, e2e/party-manager.e2e.ts.
import { afterEach, describe, expect, test } from "bun:test";
import type { You } from "@shared/protocol/frames";
import { lazyAfterSnapshot } from "@shared/protocol/lazy";
import { emptyStore, type RecordMap } from "@shared/protocol/store";
import { TooltipProvider } from "@ui/components/ui/overlays";
import { SyncContext, type SyncState } from "@ui/sync/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { createWindowRegistry } from "../play-shell/registry";
import { ShellProvider } from "../play-shell/ShellContext";
import { PartyBoard } from "./Board";
import { openPartyTab, tabKeyOf } from "./open-tab";
import { type PartyTabEntry, shownTab, visibleTabIds } from "./party-tabs";
import { createPartyMemory, createTabState, partyMemory } from "./seen";

const DM: You = { campaignId: "c1", role: "dm", playerId: null };
const PLAYER: You = { campaignId: "c1", role: "player", playerId: "p1" };

function store(you: You) {
  return createStore<SyncState>()(
    () =>
      ({
        state: "live",
        everLive: true,
        store: {
          ...emptyStore(),
          you,
          records: { "loot-entry": {}, "party-pot": {}, wallet: {}, entity: {} },
        },
        lazy: lazyAfterSnapshot(1),
        connection: { load: () => null, retryLoad: () => null },
      }) as unknown as SyncState,
  );
}

function render(you: You) {
  // The shell's title marker takes `document` at render; a stub is enough for a static render.
  const g = globalThis as { document?: unknown };
  g.document = { title: "", hidden: false };
  try {
    return renderToStaticMarkup(
      <SyncContext.Provider value={store(you)}>
        <ShellProvider registry={createWindowRegistry(you.role === "dm" ? "dm" : "player", [])}>
          <TooltipProvider delayDuration={0} skipDelayDuration={0}>
            <PartyBoard parts={{ handouts: <p data-testid="stub-handouts" /> }} />
          </TooltipProvider>
        </ShellProvider>
      </SyncContext.Provider>,
    );
  } finally {
    delete g.document;
  }
}

const tabsOf = (html: string) =>
  [...html.matchAll(/data-testid="party-tab"[^>]*data-value="(\w+)"/g)].map((m) => m[1]);
const activeOf = (html: string) =>
  html.match(/data-state="active"[^>]*data-testid="party-tab"[^>]*data-value="(\w+)"/)?.[1] ??
  html.match(/data-testid="party-tab"[^>]*data-value="(\w+)"[^>]*data-state="active"/)?.[1];

afterEach(() => partyMemory().tabs.bind(null));

describe.each([
  ["DM", DM],
  ["player", PLAYER],
] as const)("%s board", (_, you) => {
  test("FR-PARTY-60 tabs order and memory: Party status, Handouts, Inventory, Loot; Party status the landing tab; stored `companions` / unknown → Party status", () => {
    const html = render(you);
    expect(tabsOf(html)).toEqual(["status", "handouts", "inventory", "loot"]);
    expect(html).toContain(">Party status<");
    expect(html).not.toContain(">Companions<");
    // No entry: Party status shows (its body mounted), Handouts not yet.
    expect(html).toContain('data-testid="party-status"');
    expect(html).not.toContain('data-testid="stub-handouts"');
    for (const stored of ["companions", "log"]) {
      partyMemory().tabs.choose(tabKeyOf(you), stored);
      expect(render(you)).toContain('data-testid="party-status"');
    }
    partyMemory().tabs.choose(tabKeyOf(you), "handouts");
    const h = render(you);
    expect(h).toContain('data-testid="stub-handouts"');
    expect(h).not.toContain('data-testid="party-status"');
  });

  test("FR-PARTY-29 no Coin button", () => {
    const html = render(you);
    expect(html).not.toContain("party-loot-link");
    expect(html).not.toContain("Coin: open Party loot");
  });

  test("FR-PARTY-29 FR-LOOT-21 the stored Loot tab shows party-loot's body", () => {
    partyMemory().tabs.choose(tabKeyOf(you), "loot");
    const html = render(you);
    expect(activeOf(html)).toBe("loot");
    expect(html).toContain('data-testid="loot-log"');
    expect(html).toContain('data-testid="loot-pot"');
    expect(html).not.toContain('data-testid="stub-handouts"');
    // DM-only parts by role, as in the old window (FR-LOOT-19).
    expect(html.includes('data-testid="loot-add"')).toBe(you.role === "dm");
  });

  test("FR-PARTY-50 tabs keep state: every tab panel mounted, the shown one visible, the others hidden (no events, not focusable) and empty until first shown", () => {
    partyMemory().tabs.choose(tabKeyOf(you), "loot");
    const html = render(you);
    const panels = [...html.matchAll(/<div[^>]*role="tabpanel"[^>]*>/g)].map((m) => m[0]);
    expect(panels).toHaveLength(4);
    const shown = panels.filter((p) => !/ hidden=""/.test(p));
    expect(shown).toHaveLength(1);
    expect(shown[0]).toContain('data-state="active"');
    // Only the shown tab has mounted so far; Party status and Handouts mount on their first visit
    // and then stay (switching back and forth keeps their state; closing the window drops them).
    expect(html).toContain('data-testid="loot-log"');
    expect(html).not.toContain('data-testid="stub-handouts"');
    expect(html).not.toContain('data-testid="party-status"');
  });
});

describe("FR-PARTY-60 openPartyTab", () => {
  test('FR-PARTY-60 openPartyTab("status") stores Party status and opens the board as a feature open', () => {
    const tabs = createTabState(createPartyMemory(() => ({ getItem: () => null, setItem() {} })));
    const opened: unknown[] = [];
    openPartyTab("status", { you: PLAYER, tabs, open: (...a) => void opened.push(a) });
    expect(tabs.state.getState()).toEqual({ key: tabKeyOf(PLAYER), tab: "status" });
    expect(opened).toEqual([["party.board", undefined, { by: "feature" }]]);
  });
});

describe("FR-PARTY-67 tab registry", () => {
  const entries: PartyTabEntry[] = [
    { id: "loot", label: "Loot", order: 40, render: () => null },
    { id: "status", label: "Party status", order: 10, render: () => null },
    {
      id: "holds",
      label: "Strongholds",
      order: 60,
      // A tab only some viewers see (seams S1): here, while the store holds a `stronghold` row.
      visible: (v) => Object.keys(v.store.records.stronghold ?? {}).length > 0,
      render: () => null,
    },
    { id: "dm-only", label: "DM", order: 50, visible: (v) => v.role === "dm", render: () => null },
  ];
  const viewer = (role: "dm" | "player", holds: boolean) => ({
    role,
    playerId: role === "dm" ? null : "p1",
    store: {
      ...emptyStore(),
      records: (holds ? { stronghold: { s1: { id: "s1" } } } : {}) as RecordMap,
    },
  });

  test("FR-PARTY-67 tab registry: rendered in order, visible ones only; a remembered tab that turns invisible shows Party status and comes back once visible", () => {
    expect(visibleTabIds(viewer("dm", true), entries)).toEqual([
      "status",
      "loot",
      "dm-only",
      "holds",
    ]);
    expect(visibleTabIds(viewer("player", false), entries)).toEqual(["status", "loot"]);
    // The stored "holds" survives while it is hidden: Party status shows, then "holds" again.
    const tabs = createTabState(createPartyMemory(() => ({ getItem: () => null, setItem() {} })));
    tabs.choose("k", "holds");
    const stored = tabs.state.getState().tab;
    expect(shownTab(stored, visibleTabIds(viewer("player", false), entries))).toBe("status");
    expect(tabs.state.getState().tab).toBe("holds");
    expect(shownTab(stored, visibleTabIds(viewer("player", true), entries))).toBe("holds");
    // Only registered ids count.
    expect(shownTab("reminders", visibleTabIds(viewer("dm", true), entries))).toBe("status");
  });
});
