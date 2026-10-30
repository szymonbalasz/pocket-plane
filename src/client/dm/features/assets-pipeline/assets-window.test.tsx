// ASSET §13.1 unit (client, #394): the Assets window's registration (FR-ASSET-69), the picker
// without Select, the "Used in" text and the Sounds rows' helpers (FR-ASSET-70). Tabs, preview,
// a sound's rename / delete: e2e/assets-window.e2e.ts.
import { describe, expect, mock, test } from "bun:test";
import { sampleLibrary, sampleNamed } from "@shared/assets-pipeline/sample-library";
import { AssetPicker } from "@ui/features/assets-pipeline/AssetPicker";
import {
  renderInSync,
  stubImageForFile,
  tagOf,
} from "@ui/features/assets-pipeline/picker-test-kit";
import { ASSETS_KIND, seconds, soundUsedBy, usedInText } from "./assets-window";

mock.module("../campaign-management/PlayersPanel", () => ({ PlayersPanel: () => null }));
const { dmWindows } = await import("../../windows");

stubImageForFile();
const lib = sampleLibrary();
const elite = sampleNamed(lib, "Elite Goblin");

describe("Assets window (FR-ASSET-69, -70)", () => {
  test("FR-ASSET-69 registered (DM): asset.library 'Assets', launcher 'Assets' after Rules, closed by default", () => {
    const def = dmWindows.get(ASSETS_KIND);
    expect(def?.title).toBe("Assets");
    expect(def?.clients).toEqual(["dm"]);
    expect(def?.defaultOpen).toBe(false);
    expect(def?.launcher?.label).toBe("Assets");
    const rules = dmWindows.get("cmp.rules")?.launcher?.order ?? 0;
    expect(def?.launcher?.order).toBeGreaterThan(rules);
  });

  test("FR-ASSET-69 library picker: no Select button; the selected image gets the extra line", () => {
    const html = renderInSync(
      <AssetPicker
        initialSelectedId={elite.id}
        selectedExtra={(a) => <p data-testid="asset-lib-used" data-record-id={a.id} />}
      />,
      lib,
    );
    expect(tagOf(html, "asset-picker-select")).toBe("");
    expect(tagOf(html, "asset-lib-used")).toContain(`data-record-id="${elite.id}"`);
    // A host with onSelect keeps its Select button.
    const host = renderInSync(<AssetPicker onSelect={() => {}} />, lib);
    expect(tagOf(host, "asset-picker-select")).not.toBe("");
  });

  test("FR-ASSET-69 used-in text; FR-ASSET-70 a sound's alerts and length", () => {
    expect(usedInText([])).toBe("Not used anywhere: it can be deleted.");
    expect(
      usedInText([
        { kind: "scene map", name: "Town" },
        { kind: "pause card", name: null },
      ]),
    ).toBe("Used in: Town (scene map), pause card");
    expect(soundUsedBy({ turn: "s1", pause: "s1", request: "s2" }, "s1")).toEqual([
      "Your turn",
      "Pause",
    ]);
    expect(soundUsedBy(undefined, "s1")).toEqual([]);
    expect(seconds(400)).toBe("0.4 s");
    expect(seconds(5000)).toBe("5.0 s");
  });
});
