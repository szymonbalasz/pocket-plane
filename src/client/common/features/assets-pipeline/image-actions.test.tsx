// ASSET §13.1 unit (client, #386): Rename / Delete beside the selected image's name
// (FR-ASSET-66) as static renders over a fake store. The Dialogs, a delete and a refusal:
// e2e/image-manage.e2e.ts.
import { describe, expect, test } from "bun:test";
import { sampleLibrary, sampleNamed } from "@shared/assets-pipeline/sample-library";
import { AssetPicker } from "./AssetPicker";
import { deleteImagePrompt } from "./ImageActions";
import { renderInSync, stubImageForFile, tagOf } from "./picker-test-kit";

stubImageForFile();
const lib = sampleLibrary();
const elite = sampleNamed(lib, "Elite Goblin");
const isDisabled = (html: string, id: string) => /\sdisabled=""/.test(tagOf(html, id));

describe("rename / delete an image (FR-ASSET-66)", () => {
  test("FR-ASSET-66 image actions: Rename and Delete for the selected image only; disabled when not live; the delete prompt", () => {
    const none = renderInSync(<AssetPicker onSelect={() => {}} />, lib);
    expect(tagOf(none, "asset-rename")).toBe("");
    expect(tagOf(none, "asset-delete")).toBe("");

    const html = renderInSync(
      <AssetPicker onSelect={() => {}} initialSelectedId={elite.id} />,
      lib,
    );
    for (const id of ["asset-rename", "asset-delete"]) {
      expect(tagOf(html, id)).toContain(`data-record-id="${elite.id}"`);
      expect(isDisabled(html, id)).toBe(false);
    }
    expect(tagOf(html, "asset-rename")).toContain('aria-label="Rename image"');
    expect(tagOf(html, "asset-delete")).toContain('aria-label="Delete image"');
    for (const state of ["connecting", "reconnecting"] as const) {
      const off = renderInSync(
        <AssetPicker onSelect={() => {}} initialSelectedId={elite.id} />,
        lib,
        { state },
      );
      expect(isDisabled(off, "asset-rename")).toBe(true);
      expect(isDisabled(off, "asset-delete")).toBe(true);
    }
    expect(deleteImagePrompt("Elite Goblin")).toBe(
      "Delete Elite Goblin? Its links stop working. This can't be undone.",
    );
  });
});
