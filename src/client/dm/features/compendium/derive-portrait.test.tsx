// FR-CMPX-28: Derive… prefills the custom's portrait with the campaign's imported art.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { emptyStore } from "@shared/protocol/store";
import { SyncContext, type SyncState } from "@ui/sync/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { DerivePortrait } from "./DeriveDialog";
import { initialDerive } from "./derive-form";

const STAT_BLOCK = {
  size: "small",
  ac: 12,
  hpMax: 9,
  initBonus: 1,
  attacks: [],
  cr: "1",
} as unknown as Parameters<typeof initialDerive>[1]["statBlock"];

const store = createStore<SyncState>()(
  () =>
    ({
      state: "live",
      store: emptyStore(),
      lazy: {},
      connection: { load: () => null, retryLoad: () => null },
    }) as unknown as SyncState,
);

// `AssetImg` makes an `Image` while rendering; the server render has none. A stub for this file.
const hadImage = "Image" in globalThis;
beforeAll(() => {
  if (!hadImage) (globalThis as { Image?: unknown }).Image = class {};
});
afterAll(() => {
  if (!hadImage) delete (globalThis as { Image?: unknown }).Image;
});

describe("FR-CMPX-28 Derive portrait", () => {
  test("FR-CMPX-28 the form starts with the imported art when it exists, else none", () => {
    expect(initialDerive("Goblin", { statBlock: STAT_BLOCK }).portraitAssetId).toBeNull();
    expect(initialDerive("Goblin", { statBlock: STAT_BLOCK }, null).portraitAssetId).toBeNull();
    expect(initialDerive("Goblin", { statBlock: STAT_BLOCK }, "a1").portraitAssetId).toBe("a1");
  });

  test("FR-CMPX-28 the prefilled portrait is shown and can be removed", () => {
    const html = renderToStaticMarkup(
      <SyncContext.Provider value={store}>
        <DerivePortrait id="a1" name="Goblin" onRemove={() => {}} />
      </SyncContext.Provider>,
    );
    expect(html).toContain('data-testid="cmp-derive-portrait"');
    expect(html).toContain('data-value="a1"');
    expect(html).toContain('data-testid="cmp-derive-portrait-remove"');
  });
});
