// The `party.board` frame (FR-PARTY-29) as a static render over a fake sync store, per client
// role: tab order, the Loot tab mounting party-loot's body, no "Coin: open Party loot" button.
// Clicking the tabs and the Loot tab's forms: e2e/party-loot-tab.e2e.ts.
import { afterEach, describe, expect, test } from "bun:test";
import type { You } from "@shared/protocol/frames";
import { emptyStore } from "@shared/protocol/store";
import { TooltipProvider } from "@ui/components/ui/overlays";
import { SyncContext, type SyncState } from "@ui/sync/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { PartyBoard } from "./Board";
import { tabKeyOf } from "./open-tab";
import { partyMemory } from "./seen";

const DM: You = { campaignId: "c1", role: "dm", playerId: null };
const PLAYER: You = { campaignId: "c1", role: "player", playerId: "p1" };

function store(you: You) {
  return createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store: {
          ...emptyStore(),
          you,
          records: { "loot-entry": {}, "party-pot": {}, wallet: {}, entity: {} },
        },
        lazy: {},
        connection: { load: () => null, retryLoad: () => null },
      }) as unknown as SyncState,
  );
}

const render = (you: You) =>
  renderToStaticMarkup(
    <SyncContext.Provider value={store(you)}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        <PartyBoard handouts={<p data-testid="stub-handouts" />} />
      </TooltipProvider>
    </SyncContext.Provider>,
  );

const tabsOf = (html: string) =>
  [...html.matchAll(/data-testid="party-tab"[^>]*data-value="(\w+)"/g)].map((m) => m[1]);

afterEach(() => partyMemory().tabs.bind(null));

describe.each([
  ["DM", DM],
  ["player", PLAYER],
] as const)("%s board", (_, you) => {
  test("FR-PARTY-29 Loot tab right of Inventory (tabs Handouts, Inventory, Loot; Handouts first by default)", () => {
    const html = render(you);
    expect(tabsOf(html)).toEqual(["handouts", "inventory", "loot"]);
    expect(html).toContain(">Loot<");
    expect(html).toContain('data-testid="stub-handouts"');
    expect(html).not.toContain('data-testid="loot-log"');
  });

  test("FR-PARTY-29 no Coin button", () => {
    const html = render(you);
    expect(html).not.toContain("party-loot-link");
    expect(html).not.toContain("Coin: open Party loot");
  });

  test("FR-PARTY-29 FR-LOOT-21 the stored Loot tab shows party-loot's body", () => {
    partyMemory().tabs.choose(tabKeyOf(you), "loot");
    const html = render(you);
    expect(html).toContain('data-testid="loot-log"');
    expect(html).toContain('data-testid="loot-pot"');
    expect(html).not.toContain('data-testid="stub-handouts"');
    // DM-only parts by role, as in the old window (FR-LOOT-19).
    expect(html.includes('data-testid="loot-add"')).toBe(you.role === "dm");
  });
});
