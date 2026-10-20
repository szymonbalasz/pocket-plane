// FR-CMP-55 (ASSET FR-ASSET-48, IM-3): the homebrew form's image slots pass the kind's context:
// items → `compendium-item` (uploads and pastes tagged Items), other kinds → `compendium` (no
// tag); From library opens the picker with it. Static renders over a fake store; walkthrough IM6.
import { describe, expect, test } from "bun:test";
import { sampleLibrary } from "@shared/assets-pipeline/sample-library";
import { ImageAttach } from "@ui/features/assets-pipeline/attach/ImageAttach";
import {
  attachLibraryPicker,
  captureTree,
  findElement,
  hostPicker,
  renderInSync,
  stubImageForFile,
  tagOf,
} from "@ui/features/assets-pipeline/picker-test-kit";
import { contextTags } from "@ui/features/assets-pipeline/upload";
import { ImageSlots, imageContextOf } from "./HomebrewForm";
import { HOMEBREW_KINDS } from "./homebrew-form";

stubImageForFile();
const lib = sampleLibrary();
const slots = {
  images: [],
  onChange: () => {},
  busy: false,
  duplicate: false,
  onAdd: () => {},
};

describe("homebrew image slots (FR-CMP-55)", () => {
  test("FR-CMP-55 slots search and tag (FR-ASSET-48 every picker filters: item → Items, other kinds → no tag)", () => {
    for (const kind of HOMEBREW_KINDS) {
      const context = imageContextOf(kind);
      expect([kind, context]).toEqual([kind, kind === "item" ? "compendium-item" : "compendium"]);
      expect(contextTags(context)).toEqual(kind === "item" ? ["Items"] : undefined);
    }
    const props = { ...slots, context: imageContextOf("item") };
    const html = renderInSync(<ImageSlots {...props} />, lib);
    expect(tagOf(html, "asset-attach")).toContain('data-context="compendium-item"');
    const attach = findElement(captureTree(ImageSlots, props, lib), ImageAttach);
    if (!attach) throw new Error("no attach control");
    const dialog = attachLibraryPicker(attach.props, lib);
    expect(dialog?.props.context).toBe("compendium-item");
    const picker = hostPicker({ ...dialog?.props, onSelect: () => {} }, lib);
    expect(tagOf(picker.html, "asset-picker")).toContain('data-context="compendium-item"');
    expect(tagOf(picker.html, "asset-picker-search")).not.toBe("");
    expect(picker.gobEl.sort()).toEqual(["Elite Goblin", "Goblin Elder"]);
  });
});
