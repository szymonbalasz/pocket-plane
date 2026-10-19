// FR-CMP-51 entry gallery + lightbox (static render over a fake store): no images → no gallery;
// a spell (non-item kind) with 2 images → main + 1 tile; an item with 3 → main + 2 tiles in
// order; the lightbox's inside (counter, Prev / Next wrap); `error` → the broken tile, no text;
// the same markup in the player client. The Dialog portal, Esc and `display` loads:
// e2e/cmpimg-ui.e2e.ts and walkthrough I.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { EntryResponse } from "@shared/compendium/rest";
import { emptyStore } from "@shared/protocol/store";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { LightboxView, lightboxCount, wrapIndex } from "./gallery";
import type { Role } from "./logic";
import { EntryView } from "./views";

const ROW = {
  campaignId: "c1",
  derivedFromId: null,
  createdAt: "t",
  updatedAt: "t",
  source: null,
  sourceKey: null,
  definitionId: null,
  importedAt: null,
  shared: true,
};
const ITEM = (imageAssetIds: string[]): EntryResponse => ({
  entry: {
    ...ROW,
    id: "e-lantern",
    kind: "item",
    name: "Moonlit Lantern",
    line: "Wondrous item",
    facets: { category: "magic", attunement: false },
    body: { typeLine: "Wondrous item", text: "Glows." },
    imageAssetIds,
  },
  source: null,
});
const SPELL = (imageAssetIds: string[]): EntryResponse => ({
  entry: {
    ...ROW,
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
    imageAssetIds,
  },
  source: null,
});

// `AssetImg` makes an `Image` while rendering; the server render has none. A stub for this file:
// any URL with "broken" fails at once (the FR-ASSET-07 "files missing" case).
const hadImage = "Image" in globalThis;
beforeAll(() => {
  if (!hadImage)
    (globalThis as { Image?: unknown }).Image = class {
      decoding = "";
      onload = null;
      onerror: (() => void) | null = null;
      #src = "";
      get src() {
        return this.#src;
      }
      set src(v: string) {
        this.#src = v;
        if (v.includes("broken")) this.onerror?.();
      }
    };
});
afterAll(() => {
  if (!hadImage) delete (globalThis as { Image?: unknown }).Image;
});

function store(role: Role) {
  const you = { campaignId: "c1", role, playerId: role === "dm" ? null : "p1" };
  return createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store: { ...emptyStore(), you },
        lazy: {},
        connection: { load: () => null, retryLoad: () => null },
      }) as unknown as SyncState,
  );
}

const render = (role: Role, node: ReactNode) =>
  renderToStaticMarkup(
    <SyncContext.Provider value={store(role)}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        {node}
      </TooltipProvider>
    </SyncContext.Provider>,
  ).replaceAll("<!-- -->", "");

const view = (data: EntryResponse, role: Role = "dm") =>
  render(role, <EntryView data={data} viewer={role} />);
const count = (html: string, testId: string) => html.split(`data-testid="${testId}"`).length - 1;
const tiles = (html: string) =>
  [
    ...html.matchAll(/data-testid="cmp-entry-image" data-record-id="([^"]+)" data-value="(\d)"/g),
  ].map((m) => `${m[2]}:${m[1]}`);
/** The gallery's markup: from its element to the entry text's rule. */
const gallery = (html: string) => {
  const start = html.lastIndexOf("<", html.indexOf('data-testid="cmp-entry-images"'));
  return html.slice(start, html.indexOf("<hr", start));
};

describe("FR-CMP-51 entry gallery", () => {
  test("FR-CMP-51 entry gallery: no images → no cmp-entry-images (the view is unchanged)", () => {
    const html = view(ITEM([]));
    expect(count(html, "cmp-entry-images")).toBe(0);
    expect(count(html, "cmp-entry-image-main")).toBe(0);
    expect(html).toContain('data-testid="cmp-entry-header"');
  });

  test("FR-CMP-51 entry gallery: a spell with 2 images → main + 1 tile, under the header", () => {
    const html = view(SPELL(["s1", "s2"]));
    expect(html).toContain('data-testid="cmp-entry-images" data-value="2"');
    expect(html).toContain('data-testid="cmp-entry-image-main" data-record-id="s1"');
    expect(tiles(html)).toEqual(["2:s2"]);
    expect(html.indexOf("cmp-entry-header")).toBeLessThan(html.indexOf("cmp-entry-images"));
    // Before the spell's facts.
    expect(html.indexOf("cmp-entry-images")).toBeLessThan(html.indexOf("Casting Time"));
    // `thumb` in the view; `display` only in the lightbox.
    expect(html).not.toContain("/display");
  });

  test("FR-CMP-51 entry gallery: 3 images → main + 2 tiles in order", () => {
    const html = view(ITEM(["i1", "i2", "i3"]));
    expect(count(html, "cmp-entry-image-main")).toBe(1);
    expect(html).toContain('data-testid="cmp-entry-image-main" data-record-id="i1"');
    expect(tiles(html)).toEqual(["2:i2", "3:i3"]);
  });

  test("FR-CMP-51 lightbox: counter n / N; Prev / Next wrap; one image → no stepping", () => {
    expect(wrapIndex(0, -1, 3)).toBe(2);
    expect(wrapIndex(2, 1, 3)).toBe(0);
    expect(wrapIndex(0, 1, 3)).toBe(1);
    expect(lightboxCount(1, 3)).toBe("2 / 3");
    const html = render(
      "dm",
      <LightboxView ids={["i1", "i2", "i3"]} index={1} name="X" onIndex={() => {}} />,
    );
    expect(html).toContain('data-testid="cmp-lightbox-count"');
    expect(html).toContain("2 / 3");
    expect(html).not.toMatch(/data-testid="cmp-lightbox-prev"[^>]*disabled/);
    expect(html).not.toMatch(/data-testid="cmp-lightbox-next"[^>]*disabled/);
    const one = render("dm", <LightboxView ids={["i1"]} index={0} name="X" onIndex={() => {}} />);
    expect(one).toContain("1 / 1");
    expect(one).toMatch(/data-testid="cmp-lightbox-prev"[^>]*disabled/);
    expect(one).toMatch(/data-testid="cmp-lightbox-next"[^>]*disabled/);
  });

  test("FR-CMP-51 entry gallery: a load error → the neutral broken tile, no text; loading → skeleton", () => {
    const html = view(ITEM(["ok-1", "broken-2"]));
    const g = gallery(html);
    expect(g).toContain('data-state="loading"');
    expect(g).toContain('data-state="error"');
    // The broken tile holds only its icon: no visible text in the gallery at all.
    expect(g.replace(/<[^>]+>/g, "").trim()).toBe("");
  });

  test("FR-CMP-51 entry gallery: the same component in the player client", () => {
    const data = ITEM(["i1", "i2"]);
    const dm = gallery(view(data, "dm"));
    const player = gallery(view(data, "player"));
    expect(player).toContain('data-testid="cmp-entry-image-main" data-record-id="i1"');
    expect(player).toBe(dm);
  });
});
