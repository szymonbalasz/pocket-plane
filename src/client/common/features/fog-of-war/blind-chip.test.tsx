// FR-FOG-36, FOG §13 step 9: the blind chip sits below the play frame's top bar (z-20), so the
// canvas chrome never covers it, at any width.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TOP_BAR_H } from "../play-shell/geometry";
import { BLIND_CHIP_TOP, FogBlindChip } from "./BlindChip";
import { BLIND_TEXT } from "./blind";

describe("FR-FOG-36 blind chip", () => {
  test("FR-FOG-36 the chip's top offset clears the top bar", () => {
    expect(BLIND_CHIP_TOP).toBeGreaterThanOrEqual(TOP_BAR_H);
    const html = renderToStaticMarkup(<FogBlindChip blind />);
    expect(html).toContain(`top:${BLIND_CHIP_TOP}px`);
    expect(html).not.toMatch(/\btop-\d/);
    expect(html).toContain('data-testid="fog-blind"');
    expect(html).toContain(BLIND_TEXT.replace("'", "&#x27;"));
  });

  test("FR-FOG-36 no chip while the player sees", () => {
    expect(renderToStaticMarkup(<FogBlindChip blind={false} />)).toBe("");
  });
});
