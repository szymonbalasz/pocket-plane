// FR-CAMP-45 `isFeatureOn` / `useFeature` over fake stores and a static render.
import { describe, expect, test } from "bun:test";
import { applySnapshot, type RecordStore } from "@shared/protocol/store";
import { SyncContext, type SyncState } from "@ui/sync/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { isFeatureOn, useFeature } from "./use-feature";

const YOU = { campaignId: "c1", role: "player" as const, playerId: "p1" };

function store(features?: string[], withCampaign = true): RecordStore {
  const camp = { id: "c1", name: "C", dmColor: "#e69f00", ...(features ? { features } : {}) };
  return applySnapshot({
    type: "snapshot",
    seq: 0,
    you: YOU,
    records: withCampaign ? { campaign: [camp] } : {},
  } as never);
}

function render(s: RecordStore, key: string): boolean | undefined {
  let got: boolean | undefined;
  function Probe() {
    got = useFeature(key);
    return null;
  }
  const sync = createStore<SyncState>()(() => ({ state: "live", store: s }) as never);
  renderToStaticMarkup(
    <SyncContext.Provider value={sync}>
      <Probe />
    </SyncContext.Provider>,
  );
  return got;
}

describe("FR-CAMP-45 useFeature", () => {
  test("FR-CAMP-45 useFeature: true only when the campaign lists the key; no key / no campaign row → false", () => {
    expect(isFeatureOn(store(["gems"]), "gems")).toBe(true);
    expect(isFeatureOn(store(), "gems")).toBe(false);
    expect(isFeatureOn(store(["other"]), "gems")).toBe(false);
    expect(isFeatureOn(store(undefined, false), "gems")).toBe(false);
    expect(render(store(["gems"]), "gems")).toBe(true);
    expect(render(store(), "gems")).toBe(false);
  });
});
