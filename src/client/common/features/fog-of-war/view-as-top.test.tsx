// FR-FOG-60 (#383): the top bar's View as, a copy of the fog bar's Select (static server render
// over a fake sync store). The shared pick and its drawing outside the Fog tool:
// `e2e/map-pan-plain.e2e.ts`, `plain-map.test.ts`.
import { expect, test } from "bun:test";
import { lazyAfterSnapshot } from "@shared/protocol/lazy";
import { emptyStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { TOP_BAR_ITEMS, topBarItemsFor, topBarItemWidth } from "../play-shell/top-bar-items";
import { VIEW_AS_TOP_W, ViewAsTopBarItem, viewAsTopDisabled } from "./ViewAsSelect";
import { setViewAs, setViewAsOff, useViewAs, useViewAsOff } from "./view-as";

function render(state: "live" | "offline", loading = false): string {
  const you = { campaignId: "c1", role: "dm", playerId: null };
  const sync = createStore<SyncState>()(
    () =>
      ({
        state,
        store: { ...emptyStore(), you },
        notLiveSince: null,
        everLive: true,
        viewAs: { loading: loading ? { sceneId: "s1", playerId: "p1" } : null },
        lazy: lazyAfterSnapshot(0),
        connection: { sendIntent: () => Promise.resolve({}) },
      }) as unknown as SyncState,
  );
  return renderToStaticMarkup(
    <SyncContext.Provider value={sync}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        <ViewAsTopBarItem />
      </TooltipProvider>
    </SyncContext.Provider>,
  );
}

const trigger = (html: string) =>
  html.match(/<button[^>]*data-testid="fog-view-as-top"[^>]*>/)?.[0];

test("FR-FOG-60 top-bar View as: DM only, 40-px icon slot right of Pause, disabled while not live, spinner while loading", () => {
  const dm = topBarItemsFor("dm", TOP_BAR_ITEMS);
  expect(dm.map((t) => t.id)).toEqual(["pause", "view-as", "palette"]);
  const item = dm.find((t) => t.id === "view-as");
  expect([1600, 1280].map((w) => (item ? topBarItemWidth(item, { w, h: 720 }) : 0))).toEqual([
    VIEW_AS_TOP_W,
    VIEW_AS_TOP_W,
  ]);
  expect(topBarItemsFor("player", TOP_BAR_ITEMS).some((t) => t.id === "view-as")).toBe(false);

  const off = trigger(render("live"));
  expect(off).toContain('data-value="dm"');
  expect(off).not.toContain(' disabled=""');
  // An icon button like Pause: not highlighted on "DM"; the Tooltip names the view.
  expect(VIEW_AS_TOP_W).toBe(40);
  expect(off).toContain('data-on="false"');
  expect(trigger(render("offline"))).toContain(' disabled=""');
  expect(trigger(render("live", true))).toContain("data-loading");
});

// A server render only sees a zustand store's initial state, so the rule and the flag are tested
// here; the DM map setting it and the control going off: `e2e/overview-scenes.e2e.ts`.
test("FR-OVW-10 top-bar View as is off while an overview is viewed; the pick stays for the next scene", () => {
  expect(viewAsTopDisabled(true, false)).toBe(false);
  expect(viewAsTopDisabled(true, true)).toBe(true);
  expect(viewAsTopDisabled(false, false)).toBe(true);
  setViewAs("p1");
  setViewAsOff(true);
  try {
    expect(useViewAsOff.getState().off).toBe(true);
    expect(useViewAs.getState().playerId).toBe("p1");
    setViewAsOff(false);
    expect(useViewAsOff.getState().off).toBe(false);
    expect(useViewAs.getState().playerId).toBe("p1");
  } finally {
    setViewAsOff(false);
    setViewAs(null);
  }
});
