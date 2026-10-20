// FR-ENT-41 (ASSET FR-ASSET-48, IM-3): the creature form's Portrait… picker passes
// `context="portrait"`: search, tag chips, uploads tagged Portraits. Static render over a fake
// store; walkthrough IM4.
import { describe, expect, test } from "bun:test";
import { sampleLibrary } from "@shared/assets-pipeline/sample-library";
import { AssetPickerDialog } from "@ui/features/assets-pipeline/AssetPicker";
import {
  captureTree,
  findElement,
  hostPicker,
  stubImageForFile,
  tagOf,
} from "@ui/features/assets-pipeline/picker-test-kit";
import { CreatureForm } from "./creature-form";

stubImageForFile();
const lib = sampleLibrary();

describe("portrait picker (FR-ASSET-48)", () => {
  test("FR-ENT-41 portrait picker searches and tags (FR-ASSET-48 every picker filters: creature form Portrait…, context portrait)", () => {
    const tree = captureTree(CreatureForm, { mode: { kind: "new" }, close: () => {} }, lib);
    const dialog = findElement(tree, AssetPickerDialog);
    expect(dialog?.props.context).toBe("portrait");
    const { html, gobEl } = hostPicker({ ...dialog?.props, onSelect: () => {} }, lib);
    expect(tagOf(html, "asset-picker")).toContain('data-context="portrait"');
    expect(tagOf(html, "asset-picker-search")).not.toBe("");
    expect(gobEl.sort()).toEqual(["Elite Goblin", "Goblin Elder"]);
  });
});
