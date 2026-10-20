// FR-PARTY-47 / -48 (ASSET FR-ASSET-48, IM-3): the handout editor's attach control passes
// `context="handout"` (uploads and pastes tagged Handouts; From library opens the picker with that
// context, search and chips), and the Images block sits between the title and the body. Static
// renders over a fake store; layout at 1280 × 720: walkthrough IM5.
import { describe, expect, test } from "bun:test";
import { sampleLibrary, sampleNamed } from "@shared/assets-pipeline/sample-library";
import { ImageAttach } from "@ui/features/assets-pipeline/attach/ImageAttach";
import {
  attachLibraryPicker,
  captureTree,
  fakeUploader,
  findElement,
  hostPicker,
  renderInSync,
  stubImageForFile,
  tagOf,
} from "@ui/features/assets-pipeline/picker-test-kit";
import { withContextTags } from "@ui/features/assets-pipeline/uploader";
import { HandoutEditor } from "./Editor";

stubImageForFile();
const lib = sampleLibrary();
const editor = { stored: null, onSaved: () => {}, onCancel: () => {} };

describe("handout editor images (FR-PARTY-47, -48)", () => {
  test("FR-PARTY-47 editor picker searches and tags (FR-ASSET-48 every picker filters: handout attach + From library, context handout)", async () => {
    const attach = findElement(captureTree(HandoutEditor, editor, lib), ImageAttach);
    if (!attach) throw new Error("no attach control");
    expect(attach.props.context).toBe("handout");
    expect(attach.props.owner).toBe("party-editor");
    const html = renderInSync(<HandoutEditor {...editor} />, lib);
    expect(tagOf(html, "asset-attach")).toContain('data-context="handout"');
    // From library: the picker with the same context, search and chips.
    const dialog = attachLibraryPicker(attach.props, lib);
    expect(dialog?.props.context).toBe("handout");
    const picker = hostPicker({ ...dialog?.props, onSelect: () => {} }, lib);
    expect(tagOf(picker.html, "asset-picker")).toContain('data-context="handout"');
    expect(tagOf(picker.html, "asset-picker-search")).not.toBe("");
    expect(picker.gobEl.sort()).toEqual(["Elite Goblin", "Goblin Elder"]);
    // A paste / drop / Upload from this control: an attachment tagged Handouts.
    const { uploader, sent } = fakeUploader(sampleNamed(lib, "Treasure Map"));
    const h = { onProgress: () => {}, onProcessing: () => {} };
    await withContextTags(uploader, () => attach.props.context)(
      new File(["x"], "Pasted image.png"),
      { listed: false },
      h,
    );
    expect(sent[0]?.opts).toEqual({ listed: false, tags: ["Handouts"] });
  });

  test("FR-PARTY-48 images above the fold: DOM order title → Images (label, attach row) → body", () => {
    const html = renderInSync(<HandoutEditor {...editor} />, lib);
    const at = (id: string) => html.indexOf(`data-testid="${id}"`);
    expect(at("party-editor-title")).toBeGreaterThan(-1);
    expect(at("party-editor-title")).toBeLessThan(at("asset-attach"));
    expect(at("asset-attach")).toBeLessThan(at("party-editor-body"));
    expect(at("asset-attach-library")).toBeLessThan(at("party-editor-body"));
    expect(html.indexOf("Images (0/10)")).toBeLessThan(at("party-editor-body"));
  });
});
