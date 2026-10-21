// FR-CAMP-42 Campaign options (GM3): static renders of the "Options" Button and the feature rows
// over in-code DM stores; the Switch's on / ask / off rule. The Dialog's clicks (on, off-confirm,
// Cancel) run in e2e/gems-ui.e2e.ts.
import { describe, expect, test } from "bun:test";
import { FEATURES, featureDef, GEMS_FEATURE } from "@shared/campaign-management/features";
import { applySnapshot, type RecordStore } from "@shared/protocol/store";
import { TooltipProvider } from "@ui/components/ui/overlays";
import { SyncContext, type SyncState } from "@ui/sync/store";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { CampaignOptions, FeatureRows, switchAction } from "./CampaignOptions";

function dmStore(features?: string[]): RecordStore {
  return applySnapshot({
    type: "snapshot",
    seq: 0,
    you: { campaignId: "c1", role: "dm", playerId: null },
    records: {
      campaign: [
        {
          id: "c1",
          name: "Fixture Campaign",
          dmColor: "#e69f00",
          ...(features ? { features } : {}),
        },
      ],
    },
  } as never);
}

function render(s: RecordStore, node: ReactNode, state = "live"): string {
  const sync = createStore<SyncState>()(
    () =>
      ({
        state,
        store: s,
        connection: { sendIntent: () => Promise.resolve({}) },
      }) as unknown as SyncState,
  );
  return renderToStaticMarkup(
    <SyncContext.Provider value={sync}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        {node}
      </TooltipProvider>
    </SyncContext.Provider>,
  );
}

const rowTag = (html: string, key: string) =>
  html.match(
    new RegExp(`<div[^>]*data-testid="camp-feature"[^>]*data-value="${key}"[^>]*>`),
  )?.[0] ?? "";
const switchTag = (html: string) =>
  html.match(/<button[^>]*data-testid="camp-feature-switch"[^>]*>/)?.[0] ?? "";

describe("FR-CAMP-42 options dialog", () => {
  test("FR-CAMP-42 options dialog: Options button; one row per registered feature with label, description and Switch state from the campaign; disabled unless live; off asks once", () => {
    expect(render(dmStore(), <CampaignOptions />)).toContain('data-testid="camp-options-open"');

    const off = render(dmStore(), <FeatureRows />);
    expect(off.split('data-testid="camp-feature"').length - 1).toBe(FEATURES.length);
    const gems = featureDef(GEMS_FEATURE);
    if (!gems) throw new Error("gems not registered");
    expect(off).toContain(gems.label);
    expect(off).toContain(gems.description);
    expect(rowTag(off, "gems")).toContain('data-state="off"');
    expect(switchTag(off)).toContain('aria-checked="false"');
    expect(switchTag(off)).not.toContain('disabled=""');

    const on = render(dmStore(["gems"]), <FeatureRows />);
    expect(rowTag(on, "gems")).toContain('data-state="on"');
    expect(switchTag(on)).toContain('aria-checked="true"');

    // Not live → the Switch is disabled.
    expect(switchTag(render(dmStore(["gems"]), <FeatureRows />, "reconnecting"))).toContain(
      'disabled=""',
    );

    // On sends at once; off asks first ("Hide gems? Counts are kept…"); no offConfirm → off at once.
    expect(switchAction(gems, true)).toBe("on");
    expect(switchAction(gems, false)).toBe("ask");
    expect(gems.offConfirm).toBe("Hide gems? Counts are kept and come back when you turn gems on");
    expect(switchAction({ ...gems, offConfirm: undefined }, false)).toBe("off");
  });
});
