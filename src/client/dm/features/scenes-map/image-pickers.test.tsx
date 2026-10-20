// FR-MAP-86 / -87 (ASSET FR-ASSET-48, IM-3): the New scene map picker and the token menu's
// Image… picker pass their `context`, so each shows the search and the tag chips and tags its
// uploads (map → Maps, token → Tokens). Static renders over a fake store; typing and focus:
// e2e/image-search.e2e.ts, walkthrough IM1 / IM2.
import { describe, expect, test } from "bun:test";
import { sampleLibrary, sampleNamed } from "@shared/assets-pipeline/sample-library";
import type { TokenRecord } from "@shared/scenes-map/schemas";
import { AssetPicker, AssetPickerDialog } from "@ui/features/assets-pipeline/AssetPicker";
import {
  captureTree,
  findElement,
  hostPicker,
  stubImageForFile,
  tagOf,
} from "@ui/features/assets-pipeline/picker-test-kit";
import type { ReactNode } from "react";
import { NewSceneDialog } from "./scenes-window";
import type { TokenMenuDialogProps } from "./token-menu";
import { scenesMapTokenMenu } from "./token-menu-entries";

stubImageForFile();
const lib = sampleLibrary();

describe("scenes-map image pickers (FR-ASSET-48)", () => {
  test("FR-MAP-86 map picker searches and tags (FR-ASSET-48 every picker filters: New scene, inline, context map)", () => {
    const tree = captureTree(NewSceneDialog, { open: true, onOpenChange: () => {} }, lib);
    const picker = findElement(tree, AssetPicker);
    expect(picker?.props.context).toBe("map");
    // Inline: no search ref, so it never takes focus from the scene name (review #26).
    expect(picker?.props.searchRef).toBeUndefined();
    const { html, gobEl } = hostPicker({ ...picker?.props, onSelect: () => {} }, lib);
    expect(tagOf(html, "asset-picker")).toContain('data-context="map"');
    expect(tagOf(html, "asset-picker-search")).not.toBe("");
    expect(tagOf(html, "asset-picker-tag-chip")).toContain('data-tag="all"');
    expect(gobEl.sort()).toEqual(["Elite Goblin", "Goblin Elder"]);
  });

  test("FR-MAP-87 token image picker searches and tags (FR-ASSET-48 every picker filters: token menu Image…, context token)", () => {
    const entry = scenesMapTokenMenu.find((e) => e.id === "map.image");
    if (!entry?.Dialog) throw new Error("no map.image entry");
    const token = {
      id: "t1",
      name: "Goblin",
      imageAssetId: sampleNamed(lib, "token-goblin").id,
    } as TokenRecord;
    const Dialog = entry.Dialog as (p: TokenMenuDialogProps) => ReactNode;
    const tree = captureTree(Dialog, { token, close: () => {} }, lib);
    const dialog = findElement(tree, AssetPickerDialog);
    expect(dialog?.props.context).toBe("token");
    expect(dialog?.props.initialSelectedId).toBe(token.imageAssetId);
    const { html, gobEl } = hostPicker({ ...dialog?.props, onSelect: () => {} }, lib);
    expect(tagOf(html, "asset-picker")).toContain('data-context="token"');
    expect(tagOf(html, "asset-picker-search")).not.toBe("");
    expect(gobEl.sort()).toEqual(["Elite Goblin", "Goblin Elder"]);
  });
});
