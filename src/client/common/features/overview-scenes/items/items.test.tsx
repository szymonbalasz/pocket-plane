// The item drawings (react-konva's nodes are plain element names, so they render to markup under
// bun): attrs of one label, miniature and image tile; hidden styling for the DM.
import { describe, expect, test } from "bun:test";
import { LABEL_STYLE_DEFAULT } from "@shared/overview-scenes/schemas";
import { emptyStore } from "@shared/protocol/store";
import { SyncContext, type SyncState } from "@ui/sync/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import type { CanvasColors } from "../../scenes-map/theme";
import type { OverviewItemView } from "../item-layout";
import { OverviewCanvasContext } from "../overview-canvas-context";
import { ItemNode } from "./ItemNode";

const colors = {
  muted: "muted",
  border: "border",
  mutedForeground: "fg",
  hidden: "hidden-colour",
  background: "bg",
  foreground: "fg",
} as unknown as CanvasColors;

const base: OverviewItemView = {
  id: "i1",
  campaignId: "c",
  overviewId: "o",
  seq: 1,
  z: 0,
  kind: "label",
  x: 12,
  y: 34,
  w: null,
  h: null,
  hidden: false,
  assetId: null,
  text: "Thundertree",
  style: LABEL_STYLE_DEFAULT,
  characterId: null,
  ownerPlayerId: null,
  shape: null,
};

function draw(item: OverviewItemView, client: "dm" | "player" = "dm") {
  const sync = createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store: emptyStore(),
        connection: {},
      }) as unknown as SyncState,
  );
  return renderToStaticMarkup(
    <SyncContext.Provider value={sync}>
      <OverviewCanvasContext.Provider
        value={{ client, overviewId: "o", colors, live: true, myPlayerId: null }}
      >
        <ItemNode item={item} scale={2} fontRev={0} />
      </OverviewCanvasContext.Provider>
    </SyncContext.Provider>,
  );
}

const nodeAttr = (html: string, name: string, attr: string) =>
  html
    .match(new RegExp(`<[^>]*name="${name}"[^>]*>`))?.[0]
    ?.match(new RegExp(`${attr}="([^"]*)"`))?.[1];

describe("item drawings", () => {
  test("FR-OVW-27 FR-OVW-29 a label: dot + stroked text in its font, a Group at x, y", () => {
    const html = draw(base);
    expect(html).toContain('name="ovw-item"');
    expect(html).toContain('id="i1"');
    expect(html).toContain('kind="label"');
    expect(nodeAttr(html, "ovw-label-dot", "radius")).toBe("6");
    expect(nodeAttr(html, "ovw-label-text", "text")).toBe("Thundertree");
    expect(nodeAttr(html, "ovw-label-text", "font-family")).toContain("EB Garamond");
    expect(nodeAttr(html, "ovw-label-text", "stroke")).toBe("#000000");
    expect(html).not.toContain("ovw-item-hidden");
  });

  test("FR-OVW-27 dot off draws no dot; stroke 0 turns the stroke off", () => {
    const html = draw({
      ...base,
      style: {
        ...LABEL_STYLE_DEFAULT,
        strokeWidth: 0,
        dot: { ...LABEL_STYLE_DEFAULT.dot, on: false },
      },
    });
    expect(html).not.toContain("ovw-label-dot");
    expect(html).toContain('name="ovw-label-text"');
  });

  test("FR-OVW-20 a hidden item carries the hidden mark in `visibility.hidden`", () => {
    const html = draw({ ...base, hidden: true });
    expect(html).toContain('name="ovw-item-hidden"');
    expect(html).toContain("hidden-colour");
  });

  test("FR-OVW-34 FR-OVW-36 a miniature with no image: token art by shape, name under it", () => {
    const mini: OverviewItemView = {
      ...base,
      kind: "miniature",
      w: 64,
      h: 64,
      text: "Mira Vale",
      style: null,
      shape: "round",
    };
    const round = draw(mini);
    expect(nodeAttr(round, "ovw-miniature-art", "text")).toBe("MV");
    expect(nodeAttr(round, "ovw-miniature-name", "text")).toBe("Mira Vale");
    expect(nodeAttr(round, "ovw-miniature-name", "width")).toBe("64");
    expect(nodeAttr(round, "ovw-miniature-name", "font-size")).toBe("14");
    expect(round).toContain("<Circle");
    expect(draw({ ...mini, shape: "square" })).not.toContain("<Circle");
    // No name (FR-OVW-32): no name node.
    expect(draw({ ...mini, text: "" })).not.toContain("ovw-miniature-name");
  });

  test("OVW §7 an image still loading: the tile at its w × h; a hidden one the hidden mark", () => {
    const tile = draw({ ...base, kind: "image", w: 300, h: 200, text: null, style: null });
    expect(tile).toContain('name="ovw-image-loading"');
    expect(tile).toContain('width="300"');
    expect(tile).toContain('height="200"');
    const hidden = draw({ ...base, kind: "image", w: 300, h: 200, hidden: true });
    expect(hidden).toContain('name="ovw-item-hidden"');
  });
});
