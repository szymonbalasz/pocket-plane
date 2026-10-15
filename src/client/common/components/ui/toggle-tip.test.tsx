// FR-SHELL-30 hover hints on toggle items (rail tools, Structure modes, AoE shapes): the Tooltip's
// own `data-state` must not overwrite the item's on / off, so the active item keeps its highlight.
// Static server render.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ToggleGroup, ToggleGroupItem } from "./menus";
import { Tooltip, TooltipProvider } from "./overlays";
import { ToggleTip } from "./toggle-tip";

/** The `data-state` of the button with `data-testid=id`. */
function stateOf(html: string, id: string): string | null {
  const tag = html.match(new RegExp(`<button[^>]*data-testid="${id}"[^>]*>`))?.[0] ?? "";
  return tag.match(/data-state="([^"]*)"/)?.[1] ?? null;
}

function group(Tip: typeof ToggleTip | typeof Tooltip, disabled = false) {
  return renderToStaticMarkup(
    <TooltipProvider delayDuration={0} skipDelayDuration={0}>
      <ToggleGroup type="single" value="ruler">
        {["select", "ruler"].map((v) => (
          <Tip key={v} content={v}>
            <ToggleGroupItem value={v} data-testid={`map-tool-${v}`} disabled={disabled}>
              {v}
            </ToggleGroupItem>
          </Tip>
        ))}
      </ToggleGroup>
    </TooltipProvider>,
  );
}

describe("FR-SHELL-30 toggle items keep their on / off under a hover hint", () => {
  test("FR-SHELL-30 the bare Tooltip overwrites the item's data-state (the bug ToggleTip avoids)", () => {
    expect(stateOf(group(Tooltip), "map-tool-ruler")).toBe("closed");
  });

  test("FR-SHELL-30 ToggleTip: the active item is on, the others off; the hint sits on the wrapper", () => {
    const html = group(ToggleTip);
    expect(stateOf(html, "map-tool-ruler")).toBe("on");
    expect(stateOf(html, "map-tool-select")).toBe("off");
    expect(html).toMatch(
      /<span[^>]*data-state="closed"[^>]*class="inline-flex"|<span[^>]*class="inline-flex"[^>]*data-state="closed"/,
    );
  });

  test("FR-SHELL-30 a disabled item keeps on / off; its wrapper carries the off test ID", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        <ToggleGroup type="single" value="ping">
          <ToggleTip content="Ping" offTestId="map-tool-ping-off">
            <ToggleGroupItem value="ping" data-testid="map-tool-ping" disabled>
              p
            </ToggleGroupItem>
          </ToggleTip>
        </ToggleGroup>
      </TooltipProvider>,
    );
    expect(stateOf(html, "map-tool-ping")).toBe("on");
    expect(html).toContain('data-testid="map-tool-ping-off"');
    expect(group(ToggleTip, true)).not.toContain("-off");
  });
});
