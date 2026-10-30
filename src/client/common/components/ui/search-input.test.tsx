// FR-KIT-108 static renders of the clear ×. Clicking it, in each window: e2e/search-clear.e2e.ts.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "./overlays";
import { SearchInput } from "./search-input";

const render = (value: string, disabled = false) =>
  renderToStaticMarkup(
    <TooltipProvider delayDuration={0} skipDelayDuration={0}>
      <SearchInput
        data-testid="x-search"
        value={value}
        disabled={disabled}
        onChange={() => {}}
        onClear={() => {}}
      />
    </TooltipProvider>,
  );

describe("FR-KIT-108 search field clear", () => {
  test("FR-KIT-108 an empty field shows no ×", () => {
    const html = render("");
    expect(html).toContain('data-testid="x-search"');
    expect(html).not.toContain("x-search-clear");
  });

  test("FR-KIT-108 text shows a labelled × named after the field", () => {
    const html = render("gob");
    expect(html).toContain('data-testid="x-search-clear"');
    expect(html).toContain('aria-label="Clear search"');
  });

  test("FR-KIT-108 a disabled field shows no ×", () => {
    expect(render("gob", true)).not.toContain("x-search-clear");
  });
});
