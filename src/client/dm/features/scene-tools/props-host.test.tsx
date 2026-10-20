// FR-SCN-55 (ASSET FR-ASSET-48, IM-3): the Props tool's picker (place and Change image) passes
// `context="prop"`: search, tag chips, uploads tagged Props. Static render over a fake store;
// walkthrough IM3.
import { afterAll, describe, expect, test } from "bun:test";
import { sampleLibrary } from "@shared/assets-pipeline/sample-library";
import type { ScenePropRecord } from "@shared/scene-tools/schemas";
import { AssetPickerDialog } from "@ui/features/assets-pipeline/AssetPicker";
import {
  captureTree,
  findElement,
  hostPicker,
  stubImageForFile,
  tagOf,
} from "@ui/features/assets-pipeline/picker-test-kit";
import { usePropTool } from "@ui/features/scene-tools/prop-tool";
import { ScnPropsDmHost } from "./props-host";

stubImageForFile();
const lib = sampleLibrary();
// A static render reads a zustand store's server snapshot, its initial state object: the test
// patches that object (and restores it).
const initial = usePropTool.getInitialState();
const saved = { ...initial };
const setTool = (patch: Partial<typeof initial>) => Object.assign(initial, patch);
afterAll(() => {
  Object.assign(initial, saved);
});

describe("props picker (FR-ASSET-48)", () => {
  test("FR-SCN-55 props picker searches and tags (FR-ASSET-48 every picker filters: place and Change image, context prop)", () => {
    const prop = { id: "p1", assetId: lib[0]?.id } as ScenePropRecord;
    for (const picking of [{ kind: "place" }, { kind: "image", propId: "p1" }] as const) {
      setTool({ picking, props: [prop] });
      const dialog = findElement(captureTree(ScnPropsDmHost, {}, lib), AssetPickerDialog);
      expect(dialog?.props.context).toBe("prop");
      const { html, gobEl } = hostPicker({ ...dialog?.props, onSelect: () => {} }, lib);
      expect(tagOf(html, "asset-picker")).toContain('data-context="prop"');
      expect(tagOf(html, "asset-picker-search")).not.toBe("");
      expect(gobEl.sort()).toEqual(["Elite Goblin", "Goblin Elder"]);
    }
  });
});
