// FR-FOG-58: the fog bar wraps by control group at its home spot. The group structure (static
// server render over a fake sync store); the rows at 550 / 470 / 390 px and the push are walked in
// `e2e/tool-bar-spot.e2e.ts` (real layout) and `FR-SHELL-55 push right` (bun test).
import { expect, test } from "bun:test";
import { lazyAfterSnapshot } from "@shared/protocol/lazy";
import { emptyStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { REFERENCE_VIEWPORTS } from "../play-shell/layout-checks";
import { BAR_GROUP_ATTR, toolBarMaxWidth } from "../scenes-map/tool-bar-spot";
import { FOG_BAR_GROUPS, FogBar } from "./FogBar";

function render(): string {
  const you = { campaignId: "c1", role: "dm", playerId: null };
  const sync = createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store: { ...emptyStore(), you },
        notLiveSince: null,
        everLive: true,
        viewAs: { loading: null },
        lazy: lazyAfterSnapshot(0),
        connection: { sendIntent: () => Promise.resolve({}) },
      }) as unknown as SyncState,
  );
  return renderToStaticMarkup(
    <SyncContext.Provider value={sync}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        <FogBar />
      </TooltipProvider>
    </SyncContext.Provider>,
  );
}

/** Each group's markup, in document order (groups never nest). */
function groups(html: string): { id: string; html: string }[] {
  const out: { id: string; html: string }[] = [];
  const re = new RegExp(`<div[^>]*${BAR_GROUP_ATTR}="([a-z]+)"[^>]*>`, "g");
  const starts = [...html.matchAll(re)];
  starts.forEach((m, i) => {
    const end = starts[i + 1]?.index ?? html.length;
    out.push({ id: m[1] as string, html: html.slice(m.index, end) });
  });
  return out;
}

test("FR-FOG-58 fog bar wraps at home: six control groups in order, each kept whole; Party vision and View as in one group", () => {
  const html = render();
  const list = groups(html);
  expect(list.map((g) => g.id)).toEqual([...FOG_BAR_GROUPS]);
  const where = (testId: string) =>
    list.filter((g) => g.html.includes(`data-testid="${testId}"`)).map((g) => g.id);
  expect(where("fog-mode-reveal")).toEqual(["mode"]);
  expect(where("fog-mode-darkness")).toEqual(["mode"]);
  expect(where("fog-shape-rect")).toEqual(["shape"]);
  expect(where("fog-shape-brush")).toEqual(["shape"]);
  expect(where("fog-reveal-all")).toEqual(["all"]);
  expect(where("fog-fog-all")).toEqual(["all"]);
  expect(where("fog-undo")).toEqual(["history"]);
  expect(where("fog-redo")).toEqual(["history"]);
  expect(where("fog-explored-toggle")).toEqual(["explored"]);
  expect(where("fog-forget-explored")).toEqual(["explored"]);
  expect(where("fog-party-vision")).toEqual(["vision"]);
  expect(where("fog-view-as")).toEqual(["vision"]);
  // Each group is a no-wrap row of its own (`shrink-0`, no `flex-wrap`): it never splits.
  for (const m of html.matchAll(/<div[^>]*data-testid="fog-bar-group"[^>]*>/g)) {
    expect(m[0]).toContain("shrink-0");
    expect(m[0]).not.toContain("flex-wrap");
  }
  // The fixed `min(62rem, 100vw − 7rem)` cap is gone: the width comes from the home spot.
  expect(html).not.toContain("62rem");
});

test("FR-FOG-58 fog bar max width = FR-MAP-60's: 390 / 390 / 470 / 550 px (ends 8 px before the DM's top-centre toast box)", () => {
  expect(REFERENCE_VIEWPORTS.map((vp) => toolBarMaxWidth("dm", { top: 56, left: 64 }, vp))).toEqual(
    [390, 390, 470, 550],
  );
});
