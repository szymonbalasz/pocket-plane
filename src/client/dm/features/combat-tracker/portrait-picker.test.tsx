// FR-ENT-41 (ASSET FR-ASSET-48, IM-3): the creature form's Portrait… picker passes
// `context="portrait"`: search, tag chips, uploads tagged Portraits. Static render over a fake
// store; walkthrough IM4.
import { describe, expect, test } from "bun:test";
import { sampleLibrary } from "@shared/assets-pipeline/sample-library";
import type { DefinitionRecord } from "@shared/entities/schemas";
import { AssetPickerDialog } from "@ui/features/assets-pipeline/AssetPicker";
import {
  captureTree,
  findElement,
  hostPicker,
  renderInSync,
  stubImageForFile,
  tagOf,
} from "@ui/features/assets-pipeline/picker-test-kit";
import { CreatureForm, PortraitPreview } from "./creature-form";

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

describe("creature form portrait preview (FR-MAP-35)", () => {
  const def = (o: Partial<{ portraitAssetId: string | null; tokenShape: string | null }>) =>
    ({
      id: "thug",
      kind: "monster",
      name: "Wererat Thug",
      campaignId: "c1",
      portraitAssetId: "art-thug",
      tokenShape: null,
      derivedFromId: null,
      statBlock: { size: "medium", ac: 14, hpMax: 68, initBonus: 2, attacks: [], cr: "3" },
      ...o,
    }) as unknown as DefinitionRecord;
  /** The form's preview element (its props), or null without one. */
  const formPreview = (d: DefinitionRecord) =>
    findElement(
      captureTree(CreatureForm, { mode: { kind: "edit", def: d }, close: () => {} }, lib),
      PortraitPreview,
    );
  const drawn = (shape: Parameters<typeof PortraitPreview>[0]["shape"]) =>
    tagOf(
      renderInSync(<PortraitPreview id="art-thug" shape={shape} name="Thug" />, lib),
      "cbt-form-portrait-preview",
    );

  test("FR-MAP-35 the form previews the portrait in the token shape: none, square, round; Default draws round; no portrait, no preview", () => {
    expect(formPreview(def({ tokenShape: "none" }))?.props).toMatchObject({
      id: "art-thug",
      shape: "none",
    });
    expect(formPreview(def({ tokenShape: null }))?.props.shape).toBe("default");
    expect(formPreview(def({ portraitAssetId: null }))).toBeNull();
    expect(drawn("none")).toContain('data-shape="none"');
    expect(drawn("none")).not.toContain("border");
    expect(drawn("square")).toMatch(/data-shape="square"[^>]*rounded-sm border-2/);
    expect(drawn("round")).toMatch(/data-shape="round"[^>]*rounded-full border-2/);
    expect(drawn("default")).toContain('data-shape="round"');
  });
});
