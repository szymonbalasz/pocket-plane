// FR-CAMP-27 picker, player side: "Playing as ● Player 1 in …", the dot reads the player's own
// colour from the store (CAMP §7).
import { describe, expect, test } from "bun:test";
import { PLAYER_COLORS } from "@shared/campaign-management/colors";
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
      campaign: [{ id: "c1", name: "Fixture Campaign", dmColor: "amber" }],
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

describe("FR-CAMP-27 picker (player header)", () => {
  test("FR-CAMP-27 picker: the header dot sits before the name and shows the player's colour", () => {
    const html = render("jade");
    expect(html).toMatch(/data-testid="camp-my-color"[^>]*data-value="jade"/);
    expect(html).toContain(`background-color:${PLAYER_COLORS.jade}`);
    expect(html.indexOf("camp-my-color")).toBeLessThan(html.indexOf("camp-joined-player-name"));
    expect(html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ")).toBe(
      "Playing as Player 1 in Fixture Campaign",
    );
    expect(render("rose")).toMatch(/data-testid="camp-my-color"[^>]*data-value="rose"/);
  });
});
