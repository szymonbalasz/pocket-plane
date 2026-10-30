// FR-OVW-14 the Scenes window with overviews (static render over a fake store): one list with
// battle scenes, the same folders, an Overview mark, Live on the shown one. Menus: e2e.
import { describe, expect, test } from "bun:test";
import { OVERVIEW_TYPE, type OverviewRecord } from "@shared/overview-scenes/schemas";
import { emptyStore } from "@shared/protocol/store";
import { SCENE_FOLDER_TYPE, SCENE_TYPE, type SceneRecord } from "@shared/scenes-map/schemas";
import { TooltipProvider } from "@ui/components/ui/overlays";
import { SyncContext, type SyncState } from "@ui/sync/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { ScenesBody } from "../scenes-map/scenes-window";

const scene = (id: string, name: string, folderId: string | null = null) =>
  ({ id, name, seq: 1, active: false, folderId }) as SceneRecord;
const overview = (id: string, name: string, active: boolean, folderId: string | null = null) =>
  ({ id, name, seq: 2, active, folderId }) as OverviewRecord;

function render(state: "live" | "reconnecting") {
  const store = createStore<SyncState>()(
    () =>
      ({
        state,
        everLive: true,
        store: {
          ...emptyStore(),
          you: { campaignId: "c1", role: "dm", playerId: null },
          records: {
            [SCENE_FOLDER_TYPE]: { f1: { id: "f1", name: "Act 1", seq: 1 } },
            [SCENE_TYPE]: { ambush: scene("ambush", "Ambush"), cellar: scene("cellar", "Cellar") },
            [OVERVIEW_TYPE]: {
              coast: overview("coast", "Sword Coast", true),
              phandalin: overview("phandalin", "Phandalin", false, "f1"),
              bridge: overview("bridge", "Bridge", false),
            },
          },
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

const rowOf = (html: string, id: string) =>
  html.match(new RegExp(`<li data-testid="ovw-scene-row" data-record-id="${id}".*?</li>`))?.[0] ??
  "";

describe("FR-OVW-14 Scenes window", () => {
  test("FR-OVW-14 overviews sit in one list with battle scenes, by name, with an Overview mark", () => {
    const html = render("live");
    const order = [...html.matchAll(/data-testid="(?:ovw|map)-scene-row-name"[^>]*>([^<]+)</g)].map(
      (m) => m[1],
    );
    // The folder's row first (FR-MAP-02), then the root's, by name across both kinds.
    expect(order).toEqual(["Phandalin", "Ambush", "Bridge", "Cellar", "Sword Coast"]);
    expect(rowOf(html, "coast")).toContain('data-testid="ovw-scene-mark"');
    expect(
      html.match(/data-testid="map-scene-row"[^>]*data-record-id="ambush".*?<\/li>/)?.[0],
    ).not.toContain("ovw-scene-mark");
  });

  test("FR-OVW-14 the shown overview is marked live and has no Show; the others do", () => {
    const html = render("live");
    const shown = rowOf(html, "coast");
    expect(shown).toContain('data-testid="ovw-scene-live"');
    expect(shown).not.toContain('data-testid="ovw-scene-show"');
    const other = rowOf(html, "bridge");
    expect(other).not.toContain('data-testid="ovw-scene-live"');
    expect(other).toContain('data-testid="ovw-scene-show"');
    expect(other).toContain('aria-label="Show Bridge to players"');
  });

  test("FR-OVW-14 same folders: an overview sits in its folder's list", () => {
    const html = render("live");
    const folder = html.match(/<li data-testid="map-folder-row" data-record-id="f1".*?<\/ul>/)?.[0];
    expect(folder).toContain('data-testid="ovw-scene-row" data-record-id="phandalin"');
  });

  test("FR-OVW-14 New offers both kinds through one menu; actions off while not live, viewing on", () => {
    const live = render("live");
    expect(live.match(/<button[^>]*data-testid="map-scene-new"[^>]*>/)?.[0]).toContain(
      'aria-haspopup="menu"',
    );
    const off = render("reconnecting");
    const row = rowOf(off, "bridge");
    expect(row.match(/<button[^>]*data-testid="ovw-scene-show"[^>]*>/)?.[0]).toContain(
      ' disabled=""',
    );
    expect(row.match(/<button[^>]*data-testid="ovw-scene-menu"[^>]*>/)?.[0]).toContain(
      ' disabled=""',
    );
    // The row's own button (viewing) is never disabled.
    expect(
      row.match(/<button[^>]*aria-current[^>]*>|<button type="button"[^>]*>/)?.[0],
    ).not.toContain("disabled");
  });
});
