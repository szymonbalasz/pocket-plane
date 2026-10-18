// FR-ENT-29: the DM Creatures window footer has the Credits link (`ent-list-credits`), also
// while empty.
import { describe, expect, test } from "bun:test";
import { emptyStore } from "@shared/protocol/store";
import { TooltipProvider } from "@ui/components/ui/overlays";
import { SyncContext, type SyncState } from "@ui/sync/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { CreaturesList } from "./creatures-window";

const store = createStore<SyncState>()(
  () =>
    ({
      state: "live",
      everLive: true,
      store: { ...emptyStore(), you: { campaignId: "c1", role: "dm", playerId: null } },
      lazy: {},
      connection: { load: () => null, retryLoad: () => null },
    }) as unknown as SyncState,
);

describe("FR-ENT-29 licence credits", () => {
  test("FR-ENT-29 Creatures window footer: Credits link, also with no creatures", () => {
    const html = renderToStaticMarkup(
      <SyncContext.Provider value={store}>
        <TooltipProvider delayDuration={0} skipDelayDuration={0}>
          <CreaturesList actions={[]} />
        </TooltipProvider>
      </SyncContext.Provider>,
    );
    expect(html).toContain('data-testid="ent-list-empty"');
    expect(html).toContain('data-testid="ent-list-credits"');
  });
});
