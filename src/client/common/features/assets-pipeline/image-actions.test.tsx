// ASSET §13.1 unit (client, #386): Rename / Delete beside the selected image's name
// (FR-ASSET-66) as static renders over a fake store. The Dialogs, a delete and a refusal:
// e2e/image-manage.e2e.ts. BL-177: the refusal before any confirm.
import { describe, expect, test } from "bun:test";
import { sampleLibrary, sampleNamed } from "@shared/assets-pipeline/sample-library";
import { Dialog } from "@ui/components/ui/overlays";
import { renderToStaticMarkup } from "react-dom/server";
import { AssetPicker } from "./AssetPicker";
import { DeleteRefused, deleteCheckOf, deleteImagePrompt } from "./ImageActions";
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

  test("BL-177 delete of something in use: refused up front with the 'Used in' wording, Close, no Delete; unused or a failed check → the confirm", () => {
    const uses = [
      { kind: "overview image", name: "Sword Coast" },
      { kind: "pause card", name: null },
    ] as const;
    expect(deleteCheckOf(uses)).toEqual({ state: "used", uses });
    expect(deleteCheckOf([])).toEqual({ state: "clear" });
    expect(deleteCheckOf(null)).toEqual({ state: "clear" });

    const html = renderToStaticMarkup(
      <Dialog open>
        <DeleteRefused name="Scroll" noun="image" uses={uses} close={() => {}} />
      </Dialog>,
    );
    expect(tagOf(html, "asset-delete-used")).toContain('role="alert"');
    expect(html).toContain(
      "Used in: Sword Coast (overview image), pause card. Change those first.",
    );
    expect(html).toContain("Scroll can&#x27;t be deleted while it&#x27;s in use.");
    expect(html).toContain('data-testid="asset-manage-close"');
    expect(html).not.toContain("asset-manage-confirm");
    expect(html).not.toContain("asset-delete-prompt");
  });
});
