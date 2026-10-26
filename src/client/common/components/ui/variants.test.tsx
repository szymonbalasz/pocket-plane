// FR-KIT-06 (BL-127): variants as data. Button carries `data-variant` / `data-size`, the two
// ToggleGroups and Switches say which family they are, and gilt.css reads those attributes, never
// a variant off the utility classes. Static server render.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { Button, type ButtonSize, type ButtonVariant } from "./button";
import * as controls from "./controls";
import * as menus from "./menus";

/** Attributes of the first element with `data-slot=slot`. */
function attrs(markup: string, slot: string): Map<string, string> {
  const tag = new RegExp(`<\\w+[^>]*data-slot="${slot}"[^>]*>`).exec(markup)?.[0] ?? "";
  return new Map([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1] ?? "", m[2] ?? ""]));
}
const html = (el: React.ReactElement) => renderToStaticMarkup(el);

const VARIANTS: ButtonVariant[] = [
  "default",
  "outline",
  "ghost",
  "secondary",
  "destructive",
  "link",
];
const SIZES: ButtonSize[] = ["default", "sm", "icon"];

describe("FR-KIT-06 variant attributes", () => {
  test("FR-KIT-06 variant attributes: Button carries data-variant and data-size (default when omitted)", () => {
    for (const v of VARIANTS) {
      expect(attrs(html(<Button variant={v}>b</Button>), "button").get("data-variant")).toBe(v);
    }
    for (const s of SIZES) {
      expect(attrs(html(<Button size={s}>b</Button>), "button").get("data-size")).toBe(s);
    }
    const plain = attrs(html(<Button>b</Button>), "button");
    expect([plain.get("data-variant"), plain.get("data-size")]).toEqual(["default", "default"]);
    // A caller's slot (the sheet's roll buttons) keeps the variant data.
    const roll = attrs(html(<Button data-slot="sheet-roll" variant="ghost" />), "sheet-roll");
    expect(roll.get("data-variant")).toBe("ghost");
    // asChild: the attributes land on the child.
    const child = html(
      <Button asChild variant="outline" size="sm">
        <a href="#x">a</a>
      </Button>,
    );
    expect(child).toMatch(/^<a [^>]*data-variant="outline"[^>]*data-size="sm"/);
  });

  test("FR-KIT-06 variant attributes: ToggleGroup items are segmented (controls) or tool (menus); so are the groups and Switches", () => {
    const seg = html(
      <controls.ToggleGroup type="single" value="a">
        <controls.ToggleGroupItem value="a">a</controls.ToggleGroupItem>
      </controls.ToggleGroup>,
    );
    expect(attrs(seg, "toggle-group").get("data-variant")).toBe("segmented");
    expect(attrs(seg, "toggle-group-item").get("data-variant")).toBe("segmented");
    const tool = html(
      <menus.ToggleGroup type="single" value="a">
        <menus.ToggleGroupItem value="a">a</menus.ToggleGroupItem>
      </menus.ToggleGroup>,
    );
    expect(attrs(tool, "toggle-group").get("data-variant")).toBe("tool");
    expect(attrs(tool, "toggle-group-item").get("data-variant")).toBe("tool");
    expect(attrs(html(<controls.Switch />), "switch").get("data-variant")).toBe("default");
    expect(attrs(html(<menus.Switch />), "switch").get("data-variant")).toBe("tool");
    // The menu's portal renders nothing on the server: render its content in place.
    const item = (variant?: "destructive") => {
      const content = menus.DropdownMenuContent({
        children: <menus.DropdownMenuItem variant={variant}>i</menus.DropdownMenuItem>,
      }) as React.ReactElement<{ children: React.ReactNode }>;
      return html(<menus.DropdownMenu open>{content.props.children}</menus.DropdownMenu>);
    };
    expect(attrs(item(), "dropdown-menu-item").get("data-variant")).toBe("default");
    expect(attrs(item("destructive"), "dropdown-menu-item").get("data-variant")).toBe(
      "destructive",
    );
  });

  test("FR-KIT-06 variant attributes: gilt.css reads data-variant, never a variant utility class", () => {
    const css = readFileSync(join(import.meta.dir, "../../themes/gilt.css"), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    const selectors = [...css.matchAll(/([^{}]+)\{/g)].map((m) => (m[1] ?? "").trim());
    const classy = selectors.filter((s) =>
      /\.(bg-(primary|secondary|destructive|accent|muted|transparent)|border|rounded-md|size-9|h-[89])\b/.test(
        s,
      ),
    );
    expect(classy).toEqual([]);
    for (const v of ["default", "outline", "ghost", "secondary", "destructive"])
      expect(css).toMatch(new RegExp(`\\[data-slot="button"\\][^{,]*\\[data-variant="${v}"\\]`));
    expect(css).toContain('[data-slot="sheet-roll"][data-variant="default"]');
  });
});
