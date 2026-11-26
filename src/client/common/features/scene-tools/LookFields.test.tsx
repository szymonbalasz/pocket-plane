// Template looks, panel and styling (SCN FR-SCN-66, -67, -72; #466): the Look / Tint / Cells rows
// for the next placement and for a selected kept template (server-rendered markup), the squares'
// and outline's styling, and the Spell FX template whose Look row is disabled.
import { describe, expect, test } from "bun:test";
import type { TemplateRecordView } from "@shared/scene-tools/schemas";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "../../components/ui/overlays";
import { anchoredPreset, LookFields, TINT_SWATCHES } from "./LookFields";
import { templateStyleOf } from "./template-looks";

const none = { look: null, tint: null, cellOpacity: null };

const render = (
  selected: TemplateRecordView | null,
  settings: { look: null | "mist" | "ripple"; tint: string | null; cellOpacity: number | null },
) =>
  renderToStaticMarkup(
    <TooltipProvider delayDuration={0} skipDelayDuration={0}>
      <LookFields selected={selected} settings={settings} onChange={() => {}} />
    </TooltipProvider>,
  );

const count = (html: string, s: string) => html.split(s).length - 1;

const kept: TemplateRecordView = {
  id: "t1",
  sceneId: "s1",
  shape: "sphere",
  x: 10,
  y: 7,
  size: 20,
  width: null,
  angle: 0,
  label: "Silence",
  placedByPlayerId: null,
  hidden: false,
  look: "ripple",
  tint: "#123456",
  cellOpacity: 30,
};

describe("FR-SCN-66 panel", () => {
  test("FR-SCN-66 None: eight look buttons, no tint row, cells at the 22 % default", () => {
    const html = render(null, none);
    expect(count(html, 'data-testid="scn-aoe-look-')).toBe(8);
    expect(html).toMatch(
      /data-testid="scn-aoe-look-none"[^>]*data-state="on"|data-state="on"[^>]*data-testid="scn-aoe-look-none"/,
    );
    expect(html).not.toContain("scn-aoe-tint-swatch");
    expect(html).toContain('data-value="22"');
  });

  test("FR-SCN-66 Mist for the next placement: its colour first as the default, 7 more, any colour; cells 10 %", () => {
    const html = render(null, { look: "mist", tint: null, cellOpacity: null });
    expect(count(html, 'data-testid="scn-aoe-tint-swatch"')).toBe(1 + TINT_SWATCHES.length);
    expect(html).toContain('data-value="#9aa3ad"');
    expect(html).toContain('data-default="true"');
    expect(html).toContain('data-testid="scn-aoe-tint-custom"');
    expect(html).toContain('data-value="10"');
  });

  test("FR-SCN-66 a selected kept template shows its own look, tint and cells", () => {
    const html = render(kept, { look: "mist", tint: null, cellOpacity: null });
    expect(html).toMatch(
      /data-testid="scn-aoe-look-ripple"[^>]*data-state="on"|data-state="on"[^>]*data-testid="scn-aoe-look-ripple"/,
    );
    expect(html).toContain('value="#123456"');
    expect(html).toContain('data-value="30"');
  });
});

describe("FR-SCN-67 styling", () => {
  const s = { hidden: false, hovered: false, selected: false };
  test("FR-SCN-67 a look: squares in the tint at 10 %, a quiet outline until hovered or selected", () => {
    expect(templateStyleOf({ look: "mist" }, "#ff9900", s)).toEqual({
      tint: "#9aa3ad",
      cellFill: "#9aa3ad",
      cellAlpha: 0.1,
      quiet: true,
    });
    expect(
      templateStyleOf({ look: "mist", tint: "#6f9a3a", cellOpacity: 30 }, "#ff9900", s),
    ).toMatchObject({ cellFill: "#6f9a3a", cellAlpha: 0.3 });
    expect(templateStyleOf({ look: "mist" }, "#ff9900", { ...s, hovered: true }).quiet).toBe(false);
    expect(templateStyleOf({ look: "mist" }, "#ff9900", { ...s, selected: true }).quiet).toBe(
      false,
    );
  });

  test("FR-SCN-67 no look: the placer's colour at 22 % (or its own opacity), cased outline", () => {
    expect(templateStyleOf({}, "#ff9900", s)).toEqual({
      tint: null,
      cellFill: "#ff9900",
      cellAlpha: 0.22,
      quiet: false,
    });
    expect(templateStyleOf({ cellOpacity: 0, tint: "#123456" }, "#ff9900", s)).toMatchObject({
      cellFill: "#ff9900",
      cellAlpha: 0,
    });
  });

  test("FR-SCN-67 hidden styling wins for the squares; an unknown look is none", () => {
    expect(templateStyleOf({ look: "mist" }, "#888888", { ...s, hidden: true }).cellFill).toBe(
      "#888888",
    );
    expect(templateStyleOf({ look: "flames" }, "#ff9900", s)).toMatchObject({
      tint: null,
      quiet: false,
      cellAlpha: 0.22,
    });
  });
});

describe("FR-SCN-72 anchored template", () => {
  test("FR-SCN-72 a template a Spell FX effect draws on names its preset; others none", () => {
    const auras = [
      { templateId: "t1", preset: { label: "Black Tentacles" } },
      { templateId: null, preset: { label: "Spirit Guardians" } },
    ];
    expect(anchoredPreset(auras, "t1")).toBe("Black Tentacles");
    expect(anchoredPreset(auras, "t2")).toBeNull();
    expect(anchoredPreset(auras, null)).toBeNull();
  });
});
