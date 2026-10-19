// FR-CMP-49 / -50 homebrew form images (static render over a fake store + uploader): the strip's
// tiles in slot order, "Main" on the first, Move left / Remove / Move right, the attach control's
// contract (max 4, count, owner `cmp-form`), the caller-side dedupe hint; Clone / Edit prefill.
// Real upload / paste / drop into the Dialog: e2e/cmpimg-ui.e2e.ts and walkthrough I.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { CompendiumEntry } from "@shared/compendium/schemas";
import { emptyStore } from "@shared/protocol/store";
import { TooltipProvider } from "@ui/components/ui/overlays";
import { type AttachUploader, AttachUploaderProvider } from "@ui/features/assets-pipeline/uploader";
import { SyncContext, type SyncState } from "@ui/sync/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { ImageSlots } from "./HomebrewForm";
import {
  ALREADY_IN_ENTRY,
  attachImage,
  draftOf,
  initialFields,
  moveImage,
  removeImage,
} from "./homebrew-form";

const ROW = {
  derivedFromId: null,
  createdAt: "t",
  updatedAt: "t",
  definitionId: null,
  importedAt: null,
};
const POTION: CompendiumEntry = {
  ...ROW,
  id: "e-potion",
  campaignId: null,
  kind: "item",
  source: "srd-5.1",
  sourceKey: "item/potion-of-healing",
  name: "Potion of Healing",
  line: "Common potion",
  facets: { category: "potion", rarity: "common", attunement: false },
  body: { typeLine: "Potion", text: "Heals." },
  imageAssetIds: [],
  shared: false,
  importedAt: "t",
};
const LANTERN: CompendiumEntry = {
  ...ROW,
  id: "e-lantern",
  campaignId: "c1",
  kind: "item",
  source: null,
  sourceKey: null,
  name: "Moonlit Lantern",
  line: "Wondrous item",
  facets: { category: "magic", attunement: false },
  body: { typeLine: "Wondrous item", text: "Glows." },
  imageAssetIds: ["a-lantern", "a-lit"],
  shared: true,
};
const SPELL: CompendiumEntry = {
  ...LANTERN,
  id: "e-moonbeam",
  kind: "spell",
  name: "Moonbeam (house)",
  line: "Level 2 evocation",
  facets: { level: 2, school: "evocation", classes: [], concentration: true, ritual: false },
  body: {
    castingTime: "1 action",
    range: "120 feet",
    components: "V, S",
    duration: "1 minute",
    text: "Silver light.",
  },
  imageAssetIds: ["a-moon"],
  shared: false,
};

// `AssetImg` makes an `Image` while rendering; the server render has none. A stub for this file.
const hadImage = "Image" in globalThis;
beforeAll(() => {
  if (!hadImage)
    (globalThis as { Image?: unknown }).Image = class {
      decoding = "";
      src = "";
      onload = null;
      onerror = null;
    };
});
afterAll(() => {
  if (!hadImage) delete (globalThis as { Image?: unknown }).Image;
});

const uploader: AttachUploader = { upload: () => new Promise(() => {}) };

function render(images: string[], o: { duplicate?: boolean; busy?: boolean } = {}) {
  const s = createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store: { ...emptyStore(), you: { campaignId: "c1", role: "dm", playerId: null } },
        lazy: {},
        connection: {},
      }) as unknown as SyncState,
  );
  return renderToStaticMarkup(
    <SyncContext.Provider value={s}>
      <AttachUploaderProvider value={uploader}>
        <TooltipProvider delayDuration={0} skipDelayDuration={0}>
          <ImageSlots
            images={images}
            onChange={() => {}}
            onAdd={() => {}}
            busy={o.busy ?? false}
            duplicate={o.duplicate ?? false}
          />
        </TooltipProvider>
      </AttachUploaderProvider>
    </SyncContext.Provider>,
  ).replaceAll("<!-- -->", "");
}

const count = (html: string, testId: string) => html.split(`data-testid="${testId}"`).length - 1;
/** The opening tag of the first element with `testId`. */
const tag = (html: string, testId: string) =>
  new RegExp(`<[^>]*data-testid="${testId}"[^>]*>`).exec(html)?.[0] ?? "";
const order = (html: string) =>
  [
    ...html.matchAll(/data-testid="cmp-form-image" data-record-id="([^"]+)" data-value="(\d)"/g),
  ].map((m) => `${m[2]}:${m[1]}`);

describe("FR-CMP-50 form slots", () => {
  test("FR-CMP-50 form slots: tiles in order, Main on the first, attach control max 4 / count / owner cmp-form", () => {
    const html = render(["a1", "a2", "a3"]);
    expect(tag(html, "cmp-form-images")).toContain('data-value="3"');
    expect(html).toContain("Images (3 / 4)");
    expect(order(html)).toEqual(["1:a1", "2:a2", "3:a3"]);
    expect(count(html, "cmp-form-image-main")).toBe(1);
    expect(html.indexOf("cmp-form-image-main")).toBeLessThan(html.indexOf('data-record-id="a2"'));
    expect(count(html, "cmp-form-image-remove")).toBe(3);
    // The first can't move left, the last can't move right.
    expect(html).toMatch(/data-testid="cmp-form-image-left"[^>]*disabled/);
    expect(count(html, "cmp-form-image-right")).toBe(3);
    const attach = tag(html, "asset-attach");
    expect(attach).toContain('data-owner="cmp-form"');
    // remaining = max 4 − count 3.
    expect(attach).toContain('data-remaining="1"');
    expect(count(html, "cmp-form-image-dup")).toBe(0);
  });

  test("FR-CMP-50 form slots: empty → just the control and its hint; full → No more images (4); saving disables it", () => {
    const empty = render([]);
    expect(count(empty, "cmp-form-image")).toBe(0);
    expect(empty).toContain("Images (0 / 4)");
    expect(tag(empty, "asset-attach")).toContain('data-remaining="4"');
    expect(count(empty, "asset-attach-hint")).toBe(1);
    const full = render(["a1", "a2", "a3", "a4"]);
    expect(full).toContain("No more images (4)");
    expect(full).toMatch(/data-testid="asset-attach-upload"[^>]*disabled/);
    expect(render(["a1"], { busy: true })).toMatch(
      /data-testid="asset-attach-upload"[^>]*disabled/,
    );
  });

  test("FR-CMP-50 form slots: onAdd appends; an id already held is ignored with Already in this entry", () => {
    expect(attachImage(["a1"], "a2")).toEqual({ ids: ["a1", "a2"], duplicate: false });
    expect(attachImage(["a1", "a2"], "a1")).toEqual({ ids: ["a1", "a2"], duplicate: true });
    const html = render(["a1"], { duplicate: true });
    expect(count(html, "cmp-form-image-dup")).toBe(1);
    expect(html).toContain(ALREADY_IN_ENTRY);
    expect(ALREADY_IN_ENTRY).toBe("Already in this entry");
  });

  test("FR-CMP-50 form slots: Remove; Move left / right swap neighbours (the moved one becomes Main at slot 1)", () => {
    expect(removeImage(["a1", "a2", "a3"], 1)).toEqual(["a1", "a3"]);
    expect(moveImage(["a1", "a2", "a3"], 1, -1)).toEqual(["a2", "a1", "a3"]);
    expect(moveImage(["a1", "a2", "a3"], 1, 1)).toEqual(["a1", "a3", "a2"]);
    // Ends: unchanged.
    expect(moveImage(["a1", "a2"], 0, -1)).toEqual(["a1", "a2"]);
    expect(moveImage(["a1", "a2"], 1, 1)).toEqual(["a1", "a2"]);
  });

  test("FR-CMP-50 every homebrew kind: New starts with no images; a spell's Edit holds its image", () => {
    for (const kind of ["item", "spell", "condition", "feature"] as const) {
      expect(initialFields({ kind: "new" }, kind).images).toEqual([]);
    }
    expect(initialFields({ kind: "edit", entry: SPELL }).images).toEqual(["a-moon"]);
  });
});

describe("FR-CMP-49 clone prefill", () => {
  test("FR-CMP-49 clone carries images: a homebrew base's images prefill (a copy); an imported base → no slots prefilled", () => {
    const f = initialFields({ kind: "clone", base: LANTERN });
    expect(f.images).toEqual(["a-lantern", "a-lit"]);
    f.images.pop();
    expect(LANTERN.imageAssetIds).toEqual(["a-lantern", "a-lit"]);
    expect(initialFields({ kind: "clone", base: POTION }).images).toEqual([]);
    // Images never ride in the entry draft (a separate body field, FR-CMP-46).
    expect(draftOf(f)).not.toHaveProperty("images");
    expect(draftOf(f)).not.toHaveProperty("imageAssetIds");
  });
});
