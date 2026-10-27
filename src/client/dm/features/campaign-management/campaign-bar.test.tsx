// FR-CAMP-51 (BL-77): the DM title ellipsises; kit-parity FR-KIT-11: the title is the switcher and
// its menu holds the campaigns, New campaign… and Rename…. Static render over an in-code DM store
// (the menu's items through `campaignMenu`, as the menu renders them); the widths at 1280×720 /
// 1024×768 are walkthrough FX3 step 4.
import { expect, mock, test } from "bun:test";
import type { CampaignSummary } from "@shared/campaign-management/schemas";
import { applySnapshot } from "@shared/protocol/store";
import { TooltipProvider } from "@ui/components/ui/overlays";
import { SyncContext, type SyncState } from "@ui/sync/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";

// `session.ts` needs a browser (localStorage, window.location) at import.
mock.module("./session", () => ({
  api: {},
  dmCall: () => Promise.resolve(),
  useDmSession: (sel: (s: { loadCampaigns(): Promise<void> }) => unknown) =>
    sel({ loadCampaigns: () => Promise.resolve() }),
}));
const { CampaignBar, campaignMenu } = await import("./CampaignBar");

const LONG = "The Very Long Campaign of Forty Chars!!!";

function render(name: string, campaigns: CampaignSummary[]) {
  const store = applySnapshot({
    type: "snapshot",
    seq: 0,
    you: { campaignId: "c1", role: "dm", playerId: null },
    records: { campaign: [{ id: "c1", name, dmColor: "#e69f00" }] },
  } as never);
  const sync = createStore<SyncState>()(
    () => ({ state: "live", store, connection: null }) as unknown as SyncState,
  );
  return renderToStaticMarkup(
    <SyncContext.Provider value={sync}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        <CampaignBar campaigns={campaigns} />
      </TooltipProvider>
    </SyncContext.Provider>,
  );
}

test("FR-CAMP-51 switcher ellipsises", () => {
  expect(LONG).toHaveLength(40);
  const html = render(LONG, [{ id: "c1", name: LONG, active: true }] as CampaignSummary[]);
  const trigger = html.match(/<button[^>]*data-testid="camp-campaign-switcher"[^>]*>/)?.[0] ?? "";
  expect(trigger).not.toBe("");
  const cls = trigger.match(/class="([^"]*)"/)?.[1]?.split(" ") ?? [];
  expect(cls).toContain("min-w-0");
  expect(cls).toContain("max-w-full");
  // The name sits in a truncating box inside the trigger, its `title` the full name (FR-SHELL-30
  // allows a native title on a truncated non-interactive element; the Tooltip wraps the trigger).
  expect(html).toMatch(
    new RegExp(`<span class="min-w-0 truncate" title="${LONG}">.*data-testid="camp-campaign-name"`),
  );
  expect(html).toContain(LONG);
});

test("FR-KIT-11 campaign menu: the title is the switcher (name in the title slot, a chevron, no box); the menu lists the campaigns, a separator, New campaign… and Rename…; no separate buttons in the bar", () => {
  const campaigns = [
    { id: "c1", name: "Stored name", active: true },
    { id: "c2", name: "Second", active: false },
  ] as CampaignSummary[];
  const html = render("Greyhollow Pass", campaigns);
  const trigger = html.match(/<button[^>]*data-testid="camp-campaign-switcher"[^>]*>/)?.[0] ?? "";
  expect(trigger).toContain('data-slot="topbar-title"');
  expect(trigger).toContain('aria-haspopup="menu"');
  expect(trigger).not.toMatch(/\bborder\b/);
  expect(html).toMatch(/data-testid="camp-campaign-name">Greyhollow Pass</);
  expect(html).toContain("lucide-chevron-down");
  // New / Rename are menu items now: nothing else in the bar carries their IDs.
  expect(html).not.toContain('data-testid="camp-campaign-new"');
  expect(html).not.toContain('data-testid="camp-campaign-rename"');
  // The items, as the menu renders them.
  const items = campaignMenu(campaigns, "Greyhollow Pass", true);
  expect(items.map((i) => [i.kind, i.testId, i.recordId, "label" in i ? i.label : ""])).toEqual([
    ["campaign", "camp-campaign-option", "c1", "Greyhollow Pass (active)"],
    ["campaign", "camp-campaign-option", "c2", "Second"],
    ["separator", undefined, undefined, ""],
    ["new", "camp-campaign-new", undefined, "New campaign…"],
    ["rename", "camp-campaign-rename", undefined, "Rename…"],
  ]);
  // Not live: switching waits (as the Select was disabled); New and Rename stay (REST).
  const offline = campaignMenu(campaigns, "Greyhollow Pass", false);
  expect(offline.filter((i) => i.kind === "campaign").every((i) => i.disabled)).toBe(true);
  expect(offline.filter((i) => i.kind === "new" || i.kind === "rename").length).toBe(2);
  // No active campaign: no Rename….
  const none = campaignMenu(
    [{ id: "c2", name: "Second", active: false }] as CampaignSummary[],
    "",
    true,
  );
  expect(none.map((i) => i.kind)).toEqual(["campaign", "separator", "new"]);
  expect(campaignMenu([], "", true).map((i) => i.kind)).toEqual(["new"]);
});
