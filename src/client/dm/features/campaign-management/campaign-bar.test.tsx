// FR-CAMP-51 (BL-77): the DM switcher ellipsises. Static render over an in-code DM store; the
// widths at 1280×720 / 1024×768 are walkthrough FX3 step 4.
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
const { CampaignBar } = await import("./CampaignBar");

const LONG = "The Very Long Campaign of Forty Chars!!!";

test("FR-CAMP-51 switcher ellipsises", () => {
  expect(LONG).toHaveLength(40);
  const store = applySnapshot({
    type: "snapshot",
    seq: 0,
    you: { campaignId: "c1", role: "dm", playerId: null },
    records: { campaign: [{ id: "c1", name: LONG, dmColor: "#e69f00" }] },
  } as never);
  const sync = createStore<SyncState>()(
    () => ({ state: "live", store, connection: null }) as unknown as SyncState,
  );
  const campaigns = [{ id: "c1", name: LONG, active: true }] as CampaignSummary[];
  const html = renderToStaticMarkup(
    <SyncContext.Provider value={sync}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        <CampaignBar campaigns={campaigns} />
      </TooltipProvider>
    </SyncContext.Provider>,
  );
  const trigger = html.match(/<button[^>]*data-testid="camp-campaign-switcher"[^>]*>/)?.[0] ?? "";
  expect(trigger).not.toBe("");
  const cls = trigger.match(/class="([^"]*)"/)?.[1]?.split(" ") ?? [];
  expect(cls).not.toContain("min-w-48");
  expect(cls).toContain("min-w-24");
  expect(trigger).toContain(`title="${LONG}"`);
  // The name sits in a truncating box inside the trigger.
  expect(html).toMatch(/<span class="min-w-0 truncate">.*data-testid="camp-campaign-name"/);
  expect(html).toContain(LONG);
});
