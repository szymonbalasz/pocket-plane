// Player present popup (FR-PARTY-36, -37) as a static render over a fake sync store: the popup's
// inside per content state (images + pager, body, text-only, loading, error) and which row a
// snapshot makes it show. The Dialog portal, Close / Esc / click outside and "Open in Party":
// e2e/party-present.e2e.ts.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type {
  HandoutPresentRecord,
  PlayerHandoutBodyRecord,
  PlayerHandoutRecord,
} from "@shared/party-board/schemas";
import { emptyStore } from "@shared/protocol/store";
import { TooltipProvider } from "@ui/components/ui/overlays";
import { shownPresent } from "@ui/features/party-board/present-logic";
import type { LoadedHandout } from "@ui/features/party-board/Viewer";
import { SyncContext, type SyncState } from "@ui/sync/store";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { PresentContent, presentToShow } from "./present-popup";

const header = (imageAssetIds: string[]): PlayerHandoutRecord => ({
  id: "h7",
  campaignId: "c1",
  seq: 7,
  title: "Smuggler's Route",
  imageAssetIds,
  sharedWith: { mode: "players" },
  rev: 1,
  createdAt: "t",
  updatedAt: "t",
  sharedAt: "t",
});
const body: PlayerHandoutBodyRecord = {
  id: "h7",
  campaignId: "c1",
  body: "Meet at the docks",
  rev: 1,
};
const loaded = (images: string[], text = body.body): LoadedHandout => ({
  header: header(images),
  body: { ...body, body: text },
});

function store() {
  return createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store: { ...emptyStore(), you: { campaignId: "c1", role: "player", playerId: "p1" } },
        lazy: {},
        connection: { load: () => null, retryLoad: () => null },
      }) as unknown as SyncState,
  );
}

const render = (node: ReactNode) =>
  renderToStaticMarkup(
    <SyncContext.Provider value={store()}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        {node}
      </TooltipProvider>
    </SyncContext.Provider>,
  ).replaceAll("<!-- -->", "");

const noop = () => {};

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
const content = (state: "loading" | "error" | "show", l: LoadedHandout | null) =>
  render(
    <PresentContent state={state} loaded={l} onRetry={noop} onClose={noop} onOpenBoard={noop} />,
  );

const count = (html: string, testId: string) => html.split(`data-testid="${testId}"`).length - 1;

describe("FR-PARTY-36 popup content", () => {
  test("FR-PARTY-36 three images: the first, Prev disabled, 1 / 3, then the body; Close + Open in Party", () => {
    const html = content("show", loaded(["a1", "a2", "a3"]));
    expect(html).toContain("Smuggler&#x27;s Route");
    expect(count(html, "party-present-image")).toBe(1);
    expect(html).toContain('data-testid="party-present-image" data-record-id="a1"');
    expect(html).toMatch(/data-testid="party-present-prev"[^>]*disabled/);
    expect(html).not.toMatch(/data-testid="party-present-next"[^>]*disabled/);
    expect(html).toContain("1 / 3");
    expect(html).toContain("Meet at the docks");
    expect(count(html, "party-present-close")).toBe(1);
    expect(html).not.toMatch(/data-testid="party-present-open-board"[^>]*disabled/);
    // Body after the image.
    expect(html.indexOf("party-present-body")).toBeGreaterThan(html.indexOf("party-present-image"));
  });

  test("FR-PARTY-36 one image: no pager; text-only: title + body, no image", () => {
    const one = content("show", loaded(["a1"]));
    expect(count(one, "party-present-image")).toBe(1);
    expect(count(one, "party-present-page")).toBe(0);
    const text = content("show", loaded([]));
    expect(count(text, "party-present-image")).toBe(0);
    expect(count(text, "party-present-body")).toBe(1);
    // Image-only: no body element.
    expect(count(content("show", loaded(["a1"], "")), "party-present-body")).toBe(0);
  });

  test("FR-PARTY-36 loading → skeleton; reject → Couldn't load — Retry; Open in Party waits", () => {
    const loading = content("loading", null);
    expect(count(loading, "party-present-loading")).toBe(1);
    expect(loading).toMatch(/data-testid="party-present-open-board"[^>]*disabled/);
    const error = content("error", null);
    expect(error).toContain("Couldn&#x27;t load — Retry");
    expect(count(error, "party-present-retry")).toBe(1);
  });

  test("FR-PARTY-36 popup on connect: the snapshot's own row is shown; nothing without one", () => {
    const row: HandoutPresentRecord = {
      id: "pr1",
      campaignId: "c1",
      handoutId: "h2",
      playerId: "p1",
      presentedAt: "2026-10-19T10:00:00.000Z",
    };
    // A fresh page: generation 1, no local hides.
    expect(shownPresent([row], "p1", {}, 1)).toEqual(row);
    expect(shownPresent([], "p1", {}, 1)).toBeNull();
  });
});

describe("present popup while paused (FR-SHELL-127, TT4)", () => {
  test("FR-SHELL-127 present popup deferred: none while paused (incl. a page loaded paused), the same row at resume", () => {
    const row = {
      id: "pr1",
      campaignId: "c1",
      handoutId: "h7",
      playerId: "p1",
      createdAt: "t",
    } as unknown as HandoutPresentRecord;
    const you = { role: "player", playerId: "p1" };
    expect(presentToShow([row], you, {}, 1, true)).toBeNull();
    expect(presentToShow([row], you, {}, 1, false)).toEqual(row);
    expect(presentToShow([row], { role: "dm", playerId: null }, {}, 1, false)).toBeNull();
  });
});
