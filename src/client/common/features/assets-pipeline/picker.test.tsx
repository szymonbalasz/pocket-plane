// ASSET §13.1 unit (client): the picker's search field, tag chips, tag editor, Manage tags and
// `context` (FR-ASSET-41 client, -45, -46, -47, -48) as static renders over a fake store, plus the
// Dialog's focus wiring and the upload body. Typing, Esc and real focus: e2e/image-search.e2e.ts.
import { describe, expect, test } from "bun:test";
import { sampleLibrary, sampleNamed } from "@shared/assets-pipeline/sample-library";
import { tagChips } from "@shared/assets-pipeline/search";
import type { ImageContext } from "@shared/assets-pipeline/tags";
import { DialogContent } from "@ui/components/ui/overlays";
import { IntentRejected } from "@ui/sync/connection";
import type { RefObject } from "react";
import { AssetPicker, AssetPickerDialog, noMatchText } from "./AssetPicker";
import { ImageAttach } from "./attach/ImageAttach";
import {
  captureTree,
  fakeUploader,
  findElement,
  renderInSync,
  stubImageForFile,
  tagOf,
} from "./picker-test-kit";
import { addTagPlan, imageFull, removeTag } from "./tags/editor-logic";
import { tagIntentError } from "./tags/intent";
import { contextTags, droppedTagMessage, outcomeOf, uploadBody } from "./upload";
import { withContextTags } from "./uploader";

stubImageForFile();
const lib = sampleLibrary();
const elite = sampleNamed(lib, "Elite Goblin");
const misc = sampleNamed(lib, "Misc Sketch");
const isDisabled = (html: string, id: string) => /\sdisabled=""/.test(tagOf(html, id));
const attrs = (html: string, id: string, attr: string) =>
  [...html.matchAll(new RegExp(`data-testid="${id}"[^>]*?${attr}="([^"]*)"`, "g"))].map(
    (m) => m[1],
  );

describe("search field (FR-ASSET-45)", () => {
  test("FR-ASSET-45 search: the inline picker shows the search and doesn't take focus; the Dialog focuses it on open", () => {
    const html = renderInSync(<AssetPicker onSelect={() => {}} />, lib);
    const search = tagOf(html, "asset-picker-search");
    expect(search).toContain('aria-label="Search images"');
    expect(search).toContain('placeholder="Search images"');
    expect(search).not.toMatch(/autofocus/i);
    // Empty search: no clear ×, every image in picker order.
    expect(tagOf(html, "asset-picker-search-clear")).toBe("");
    expect(attrs(html, "asset-picker-item", "data-record-id")).toEqual(lib.map((a) => a.id));

    // The Dialog: its content's open auto-focus goes to the picker's search Input.
    const tree = captureTree(
      AssetPickerDialog,
      { open: true, onOpenChange: () => {}, onSelect: () => {} },
      lib,
    );
    const content = findElement(tree, DialogContent);
    const picker = findElement(tree, AssetPicker);
    const ref = picker?.props.searchRef as RefObject<HTMLInputElement | null>;
    let focused = 0;
    ref.current = { focus: () => focused++ } as unknown as HTMLInputElement;
    let prevented = false;
    content?.props.onOpenAutoFocus?.({
      preventDefault: () => (prevented = true),
    } as unknown as Event);
    expect([prevented, focused]).toEqual([true, 1]);
  });

  test("FR-ASSET-45 no match text; a hidden selection stays selected: Select works and the line names it", () => {
    expect(noMatchText("wolf", null)).toBe("No images match wolf");
    expect(noMatchText("wolf", "Maps")).toBe("No images match wolf in Maps");
    const html = renderInSync(<AssetPicker onSelect={() => {}} initialSelectedId={misc.id} />, lib);
    expect(isDisabled(html, "asset-picker-select")).toBe(false);
    expect(html).toMatch(/data-testid="asset-picker-selected"[^>]*>Misc Sketch</);
    // An unknown selection (not in the library) can't be used.
    const gone = renderInSync(<AssetPicker onSelect={() => {}} initialSelectedId="nope" />, lib);
    expect(isDisabled(gone, "asset-picker-select")).toBe(true);
    expect(tagOf(gone, "asset-tags-editor")).toBe("");
  });
});

describe("tag filter (FR-ASSET-46)", () => {
  test("FR-ASSET-46 tag filter: chips All · built-ins · DM tags A–Z · Untagged, with counts; All on at open", () => {
    const html = renderInSync(<AssetPicker onSelect={() => {}} />, lib);
    expect(attrs(html, "asset-picker-tag-chip", "data-tag")).toEqual([
      "all",
      "tokens",
      "portraits",
      "maps",
      "handouts",
      "props",
      "items",
      "zz lair secret",
      "untagged",
    ]);
    expect(attrs(html, "asset-picker-tag-chip", "data-state")).toEqual([
      "on",
      ...Array(8).fill("off"),
    ]);
    expect(html).toMatch(/>Tokens<span[^>]*>12</);
    expect(html).toMatch(/>Untagged<span[^>]*>1</);
    // Items carry their folded tags.
    expect(tagOf(html, "asset-picker-item")).toContain('data-tags="');
    expect(html).toContain(`data-record-id="${elite.id}" data-tags="tokens portraits"`);
    // No tagged image → no Untagged chip; no images → no chip row.
    const tagged = renderInSync(
      <AssetPicker onSelect={() => {}} />,
      lib.filter((a) => a.tags.length > 0),
    );
    expect(attrs(tagged, "asset-picker-tag-chip", "data-tag")).not.toContain("untagged");
    expect(
      tagOf(renderInSync(<AssetPicker onSelect={() => {}} />, []), "asset-picker-tag-chip"),
    ).toBe("");
  });
});

describe("tag editor and Manage tags (FR-ASSET-47)", () => {
  const chips = tagChips(lib);

  test("FR-ASSET-47 edit tags: the selected image's chips with Remove + Add tag; Manage tags; disabled when not live", () => {
    const html = renderInSync(
      <AssetPicker onSelect={() => {}} initialSelectedId={elite.id} />,
      lib,
    );
    expect(tagOf(html, "asset-tags-editor")).toContain(`data-record-id="${elite.id}"`);
    expect(attrs(html, "asset-tags-chip", "data-tag")).toEqual(["tokens", "portraits"]);
    expect(attrs(html, "asset-tags-remove", "data-tag")).toEqual(["tokens", "portraits"]);
    expect(isDisabled(html, "asset-tags-add")).toBe(false);
    expect(isDisabled(html, "asset-tags-manage")).toBe(false);
    for (const state of ["connecting", "reconnecting"] as const) {
      const off = renderInSync(
        <AssetPicker onSelect={() => {}} initialSelectedId={elite.id} />,
        lib,
        { state },
      );
      expect(isDisabled(off, "asset-tags-add")).toBe(true);
      expect(isDisabled(off, "asset-tags-remove")).toBe(true);
      expect(isDisabled(off, "asset-tags-manage")).toBe(true);
      // Search and filter keep working on the store.
      expect(isDisabled(off, "asset-picker-search")).toBe(false);
      expect(attrs(off, "asset-picker-item", "data-record-id")).toHaveLength(lib.length);
    }
  });

  test("FR-ASSET-47 Add (Enter / suggestion) sends the whole list; existing spelling; held → nothing; 9th refused; Remove", () => {
    expect(addTagPlan(misc.tags, "Dungeon", chips)).toEqual({ kind: "send", tags: ["Dungeon"] });
    expect(addTagPlan(["Tokens"], "portraits", chips)).toEqual({
      kind: "send",
      tags: ["Tokens", "Portraits"],
    });
    expect(addTagPlan(["Tokens"], "TOKENS", chips)).toEqual({ kind: "held" });
    expect(addTagPlan([], "!!!", chips).kind).toBe("invalid");
    expect(addTagPlan([], "x".repeat(25), chips).kind).toBe("invalid");
    const eight = ["a", "b", "c", "d", "e", "f", "g", "h"];
    expect(addTagPlan(eight, "Maps", chips)).toEqual({ kind: "invalid", message: imageFull });
    expect(removeTag(["Tokens", "Portraits"], "tokens")).toEqual(["Portraits"]);
  });

  test("FR-ASSET-47 built-ins have no Rename; a rejected intent's message shows inline", () => {
    expect(chips.tags.filter((c) => !c.builtIn).map((c) => c.label)).toEqual(["zz-lair-secret"]);
    expect(tagIntentError(new IntentRejected("invalid", "Built-in tag"))).toBe("Built-in tag");
    expect(tagIntentError(new IntentRejected("conflict", "Too many tags (50)"))).toBe(
      "Too many tags (50)",
    );
    expect(tagIntentError(new IntentRejected("offline", "Not connected"))).toMatch(/connection/);
  });
});

describe("context and upload tags (FR-ASSET-41, -48)", () => {
  test("FR-ASSET-48 context tags uploads: picker / attach carry data-context; token → Tokens, handout → Handouts, compendium-item → Items, compendium → no field", async () => {
    const html = renderInSync(<AssetPicker onSelect={() => {}} context="token" />, lib);
    expect(tagOf(html, "asset-picker")).toContain('data-context="token"');
    expect(
      tagOf(renderInSync(<AssetPicker onSelect={() => {}} />, lib), "asset-picker"),
    ).not.toContain("data-context");
    const attach = renderInSync(
      <ImageAttach max={4} count={0} owner="t" onAdd={() => {}} context="handout" />,
      lib,
    );
    expect(tagOf(attach, "asset-attach")).toContain('data-context="handout"');

    const cases: [ImageContext | undefined, string[] | undefined][] = [
      ["token", ["Tokens"]],
      ["portrait", ["Portraits"]],
      ["map", ["Maps"]],
      ["prop", ["Props"]],
      ["handout", ["Handouts"]],
      ["compendium-item", ["Items"]],
      ["compendium", undefined],
      [undefined, undefined],
    ];
    for (const [ctx, tags] of cases) {
      expect(contextTags(ctx)).toEqual(tags);
      const { uploader, sent } = fakeUploader(elite);
      const h = { onProgress: () => {}, onProcessing: () => {} };
      await withContextTags(uploader, () => ctx)(new File(["x"], "a.png"), { listed: false }, h);
      expect(sent[0]?.opts.tags).toEqual(tags);
      const body = uploadBody(new File(["x"], "a.png"), {
        listed: true,
        ...(tags ? { tags } : {}),
      });
      expect(body.get("tags")).toBe(tags ? JSON.stringify(tags) : null);
    }
  });

  test("FR-ASSET-41 cap on upload: droppedTags parsed from the response and named in the Toast text", () => {
    const dropped = [{ tag: "Tokens", reason: "image-full" as const }];
    expect(outcomeOf(200, { asset: elite, droppedTags: dropped })).toEqual({
      kind: "ok",
      outcome: "existing",
      asset: elite,
      droppedTags: dropped,
    });
    expect(outcomeOf(201, { asset: elite })).toEqual({
      kind: "ok",
      outcome: "created",
      asset: elite,
    });
    expect(droppedTagMessage({ tag: "Tokens", reason: "image-full" })).toBe(
      "Tag Tokens not added: 8 tags on this image",
    );
    expect(droppedTagMessage({ tag: "Lair", reason: "campaign-full" })).toBe(
      "Tag Lair not added: 50 tags in this campaign",
    );
  });
});
