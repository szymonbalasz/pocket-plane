// FR-OVW-28's panel as static markup: every control's test ID, the mixed state, disabled while not
// live; the text half alone for a miniature's name; the label's preview; where the field sits. A
// static render reads a zustand store's initial state, so what a live preview draws: the e2e.
import { describe, expect, test } from "bun:test";
import { LABEL_STYLE_DEFAULT, type LabelStyle } from "@shared/overview-scenes/schemas";
import { emptyStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { SyncContext, type SyncState } from "../../sync/store";
import type { CanvasColors } from "../scenes-map/theme";
import type { OverviewItemView } from "./item-layout";
import { LabelFieldOverlay, labelFieldSpot } from "./LabelFieldOverlay";
import {
  LabelStylePreview,
  LabelTextStyleControls,
  LabelToolPanel,
  SelectedLabelsPanel,
} from "./LabelStylePanel";
import { mixedTextStyle, patchLabelStyle } from "./label-style";
import { OverviewCanvasContext } from "./overview-canvas-context";
import { initialEditor } from "./overview-editor";
import { selectionHasStylePanel } from "./SelectionStylePanel";

const label = (id: string, style: LabelStyle = LABEL_STYLE_DEFAULT): OverviewItemView => ({
  id,
  campaignId: "c1",
  overviewId: "o",
  seq: 1,
  z: 0,
  kind: "label",
  x: 0,
  y: 0,
  w: null,
  h: null,
  hidden: false,
  assetId: null,
  text: "Thundertree",
  style,
  characterId: null,
  ownerPlayerId: null,
  shape: null,
  locked: false,
});

function render(node: React.ReactNode, state: "live" | "reconnecting" = "live") {
  const sync = createStore<SyncState>()(
    () =>
      ({
        state,
        store: { ...emptyStore(), you: { campaignId: "c1", role: "dm", playerId: null } },
        connection: {},
      }) as unknown as SyncState,
  );
  return renderToStaticMarkup(
    <SyncContext.Provider value={sync}>
      <OverviewCanvasContext.Provider
        value={{
          client: "dm",
          overviewId: "o",
          colors: {} as CanvasColors,
          live: state === "live",
          myPlayerId: null,
        }}
      >
        {node}
      </OverviewCanvasContext.Provider>
    </SyncContext.Provider>,
  );
}

const tagOf = (html: string, testId: string) =>
  html.match(new RegExp(`<[^>]*data-testid="${testId}"[^>]*>`))?.[0] ?? "";

const CONTROLS = [
  "ovw-style-font",
  "ovw-style-size",
  "ovw-style-color",
  "ovw-style-stroke-color",
  "ovw-style-stroke-width",
  "ovw-style-dot",
  "ovw-style-dot-size",
  "ovw-style-dot-color",
  "ovw-style-dot-stroke-color",
  "ovw-style-dot-stroke-width",
];

describe("FR-OVW-28 the style panel", () => {
  test("FR-OVW-28 beside the Label tool: every control, the preview, Add hidden, nothing mixed", () => {
    const html = render(<LabelToolPanel />);
    for (const id of CONTROLS) expect(html).toContain(`data-testid="${id}"`);
    expect(html).toContain('data-testid="ovw-style-preview"');
    expect(html).toContain('data-testid="ovw-add-hidden"');
    expect(html).not.toContain("data-mixed");
  });

  test("FR-OVW-28 mixed selection: differing fields carry data-mixed, shared ones their value", () => {
    const fell = patchLabelStyle(LABEL_STYLE_DEFAULT, { font: "fell", size: 40 });
    const html = render(<SelectedLabelsPanel items={[label("a"), label("b", fell)]} />);
    expect(tagOf(html, "ovw-style-panel")).toContain('data-count="2"');
    expect(tagOf(html, "ovw-style-font")).toContain("data-mixed");
    expect(tagOf(html, "ovw-style-size")).toContain("data-mixed");
    expect(tagOf(html, "ovw-style-size-input")).toContain('placeholder="Mixed"');
    expect(tagOf(html, "ovw-style-color")).not.toContain("data-mixed");
    expect(tagOf(html, "ovw-style-color")).toContain('value="#ffffff"');
    expect(tagOf(html, "ovw-style-dot-size")).not.toContain("data-mixed");
  });

  test("FR-OVW-29 dot off hides the dot's rows; a mix of on and off keeps them", () => {
    const off = patchLabelStyle(LABEL_STYLE_DEFAULT, { dot: { on: false } });
    const one = render(<SelectedLabelsPanel items={[label("a", off)]} />);
    expect(one).toContain('data-testid="ovw-style-dot"');
    expect(one).not.toContain('data-testid="ovw-style-dot-size"');
    const both = render(<SelectedLabelsPanel items={[label("a", off), label("b")]} />);
    expect(tagOf(both, "ovw-style-dot")).toContain("data-mixed");
    expect(both).toContain('data-testid="ovw-style-dot-size"');
  });

  test("FR-OVW-47 selected labels: the controls are off while not live", () => {
    const html = render(<SelectedLabelsPanel items={[label("a")]} />, "reconnecting");
    expect(tagOf(html, "ovw-style-color")).toContain("disabled");
    expect(tagOf(html, "ovw-style-size-input")).toContain("disabled");
    expect(tagOf(html, "ovw-style-dot")).toContain("disabled");
  });

  test("FR-OVW-47 the Label tool's panel: every control off while not live, on while live", () => {
    const off = render(<LabelToolPanel />, "reconnecting");
    const ids = [
      ...CONTROLS.filter((id) => id !== "ovw-style-font"),
      "ovw-style-font-fell",
      "ovw-style-size-input",
      "ovw-style-stroke-width-input",
      "ovw-style-dot-size-input",
      "ovw-style-dot-stroke-width-input",
      "ovw-add-hidden",
    ];
    const isOff = (html: string, id: string) =>
      / disabled=""|data-disabled=""/.test(tagOf(html, id));
    for (const id of ids) expect([id, isOff(off, id)]).toEqual([id, true]);
    const on = render(<LabelToolPanel />);
    for (const id of ids) expect([id, isOff(on, id)]).toEqual([id, false]);
  });

  test("FR-OVW-36 the text half alone, for a miniature's name: no dot", () => {
    const html = render(
      <LabelTextStyleControls
        value={mixedTextStyle([LABEL_STYLE_DEFAULT])}
        onPreview={() => {}}
        onCommit={() => {}}
      />,
    );
    expect(html).toContain('data-testid="ovw-style-font"');
    expect(html).toContain('data-testid="ovw-style-stroke-width"');
    expect(html).not.toContain("ovw-style-dot");
  });

  test("FR-OVW-30 the preview: dot and text in the label's font and colours, or text alone", () => {
    const html = render(<LabelStylePreview style={LABEL_STYLE_DEFAULT} />);
    expect(html).toContain("EB Garamond");
    expect(html).toContain("<circle");
    expect(tagOf(html, "ovw-style-preview")).toContain('data-font="garamond"');
    const off = patchLabelStyle(LABEL_STYLE_DEFAULT, { font: "fell", dot: { on: false } });
    const fell = render(<LabelStylePreview style={off} />);
    expect(fell).toContain("IM Fell English SC");
    expect(fell).not.toContain("<circle");
  });

  test("FR-OVW-28 the Select tool's panel shows only with a label selected", () => {
    const items = [label("l"), { ...label("i"), kind: "image" as const }];
    const state = (ids: string[]) => ({
      ...initialEditor,
      items,
      selection: { ...initialEditor.selection, tokenIds: ids },
    });
    expect(selectionHasStylePanel(state([]))).toBe(false);
    expect(selectionHasStylePanel(state(["i"]))).toBe(false);
    expect(selectionHasStylePanel(state(["i", "l"]))).toBe(true);
  });
});

describe("FR-OVW-25 the field", () => {
  const view = { x: 10, y: 20, scale: 2, w: 1000, h: 800 };

  test("FR-OVW-25 at the label's place, through the camera", () => {
    expect(labelFieldSpot({ x: 100, y: 50 }, view)).toEqual({ left: 210, top: 120 });
  });

  test("FR-OVW-25 near the canvas's edges the field stays inside it", () => {
    expect(labelFieldSpot({ x: 490, y: 0 }, view).left).toBe(776);
    expect(labelFieldSpot({ x: -100, y: 0 }, view).left).toBe(0);
  });

  test("FR-OVW-25 no field: nothing drawn", () => {
    expect(render(<LabelFieldOverlay />)).toBe("");
  });
});
