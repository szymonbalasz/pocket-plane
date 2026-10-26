// FR-CAMP-35 picker, player side: the header's colour dot (`camp-my-color`) retired; the identity
// chip shows the colour and Preferences holds the picker (CAMP §7).
import { describe, expect, test } from "bun:test";
import { applySnapshot } from "@shared/protocol/store";
import { TooltipProvider } from "@ui/components/ui/overlays";
import { SyncContext, type SyncState } from "@ui/sync/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { JoinedHeader } from "./screens";

function render(color: string) {
  const store = applySnapshot({
    type: "snapshot",
    seq: 0,
    you: { campaignId: "c1", role: "player", playerId: "p1" },
    records: {
      campaign: [{ id: "c1", name: "Fixture Campaign", dmColor: "#e69f00" }],
      player: [{ id: "p1", campaignId: "c1", name: "Player 1", color }],
    },
  } as never);
  const sync = createStore<SyncState>()(
    () => ({ state: "live", store, connection: { sendIntent: async () => ({}) } }) as never,
  );
  return renderToStaticMarkup(
    <SyncContext.Provider value={sync}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        <JoinedHeader playerName="Player 1" campaignName="Fixture Campaign" />
      </TooltipProvider>
    </SyncContext.Provider>,
  );
}

describe("FR-CAMP-35 picker (player header)", () => {
  test("FR-CAMP-35 FR-KIT-12 picker: camp-my-color gone from the player header; the line reads 'Fixture Campaign · playing as Player 1'", () => {
    const html = render("#19b98a");
    expect(html).not.toContain("camp-my-color");
    expect(html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ")).toBe(
      "Fixture Campaign · playing as Player 1",
    );
  });

  test("FR-KIT-12 player title: the campaign name in the title slot, the player in the small muted line; IDs kept", () => {
    const html = render("#19b98a");
    expect(html).toMatch(
      /<p data-testid="camp-player-joined"[^>]*><span data-testid="camp-joined-campaign-name" data-slot="topbar-title"[^>]*>Fixture Campaign<\/span>/,
    );
    expect(html).toMatch(
      /<span data-slot="topbar-sub" class="[^"]*text-muted-foreground[^"]*">· playing as <span data-testid="camp-joined-player-name">Player 1<\/span><\/span>/,
    );
  });
});
