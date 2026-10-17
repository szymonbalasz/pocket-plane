// FR-MAP-51 Scenes rows (static render over a fake store): non-active rows carry "Show to players",
// the active row keeps "Live" and has none; disabled while not live.
import { describe, expect, test } from "bun:test";
import { emptyStore } from "@shared/protocol/store";
import { SCENE_TYPE, type SceneRecord } from "@shared/scenes-map/schemas";
import { TooltipProvider } from "@ui/components/ui/overlays";
import { SyncContext, type SyncState } from "@ui/sync/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { ScenesBody } from "./scenes-window";
import { useDmMap } from "./view-state";

const scene = (id: string, name: string, seq: number, active: boolean) =>
  ({ id, name, seq, active, folderId: null }) as SceneRecord;
const town = scene("town", "Town", 1, true);
const ambush = scene("ambush", "Goblin Ambush", 2, false);

function render(state: "live" | "reconnecting") {
  const store = createStore<SyncState>()(
    () =>
      ({
        state,
        everLive: true,
        store: {
          ...emptyStore(),
          you: { campaignId: "c1", role: "dm", playerId: null },
          records: { [SCENE_TYPE]: { town, ambush } },
        },
        lazy: {},
        connection: { load: () => null, retryLoad: () => null },
      }) as unknown as SyncState,
  );
  return renderToStaticMarkup(
    <SyncContext.Provider value={store}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        <ScenesBody />
      </TooltipProvider>
    </SyncContext.Provider>,
  );
}

/** The `<li>` of one scene row. */
const row = (html: string, id: string) =>
  html.match(new RegExp(`<li data-testid="map-scene-row" data-record-id="${id}".*?</li>`))?.[0] ??
  "";
const showButton = (html: string) =>
  html.match(/<button[^>]*data-testid="map-scene-show"[^>]*>/)?.[0];

describe("FR-MAP-51 Show to players in the Scenes window", () => {
  test("FR-MAP-51 non-active rows get a Show to players button; the active row keeps Live", () => {
    const html = render("live");
    const a = row(html, "ambush");
    const btn = showButton(a);
    expect(btn).toContain('data-record-id="ambush"');
    expect(btn).toContain('aria-label="Show Goblin Ambush to players"');
    expect(btn).not.toContain(' disabled=""');
    expect(a).not.toContain("map-scene-live");
    const t = row(html, "town");
    expect(t).toContain('data-testid="map-scene-live"');
    expect(showButton(t)).toBeUndefined();
  });

  test("FR-MAP-51 Show to players disabled while not live (FR-MAP-28)", () => {
    expect(showButton(row(render("reconnecting"), "ambush"))).toContain(' disabled=""');
  });

  test("FR-MAP-51 the badge's row-focus request is held until the row takes it", () => {
    useDmMap.getState().focusRow("town");
    expect(useDmMap.getState().rowFocus).toBe("town");
    useDmMap.getState().focusRow(null);
    expect(useDmMap.getState().rowFocus).toBeNull();
  });
});
