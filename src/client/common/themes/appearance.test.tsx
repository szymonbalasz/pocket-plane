// Preferences "Appearance" section (theme-system FR-THEME-02, -20): two option cards with their test IDs and state; the live
// section reads the page store, and a pick goes through it (stored + applied, no reload).
import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AppearanceSection, appearanceSection } from "./AppearanceSection";
import { THEME_KEY, themeStore } from "./theme";

const g = globalThis as { localStorage?: unknown };
afterEach(() => {
  delete g.localStorage;
});

const options = (html: string) =>
  [...html.matchAll(/<button[^>]*data-testid="theme-option"[^>]*>/g)].map((m) => ({
    value: /data-value="([^"]+)"/.exec(m[0])?.[1],
    state: /data-state="([^"]+)"/.exec(m[0])?.[1],
    checked: /aria-pressed="([^"]+)"/.exec(m[0])?.[1],
  }));

describe("FR-THEME-02 appearance section", () => {
  test('FR-THEME-02 appearance section: theme.appearance "Appearance", always shown (registered by each client: dm/ and player/ features/theme-system)', () => {
    expect([appearanceSection.id, appearanceSection.title]).toEqual([
      "theme.appearance",
      "Appearance",
    ]);
    expect(appearanceSection.available).toBeUndefined();
  });

  test("FR-THEME-02 appearance section: two option cards, the current one on, each with its own-theme preview and the hint", () => {
    for (const current of ["default", "gilt"] as const) {
      const html = renderToStaticMarkup(<AppearanceSection current={current} onPick={() => {}} />);
      expect(html).toContain('data-testid="theme-section"');
      expect(options(html)).toEqual([
        {
          value: "default",
          state: current === "default" ? "on" : "off",
          checked: String(current === "default"),
        },
        {
          value: "gilt",
          state: current === "gilt" ? "on" : "off",
          checked: String(current === "gilt"),
        },
      ]);
      // Each preview carries its theme, so the tokens draw that theme inside any page theme.
      expect([...html.matchAll(/<span data-theme="([^"]+)"/g)].map((m) => m[1])).toEqual([
        "default",
        "gilt",
      ]);
      expect(html).toContain(">Simple Dark<");
      expect(html).not.toContain(">Default<");
      expect(html).toContain(">Gilt &amp; Stone<");
      expect(html).toContain("Only on this browser");
    }
  });

  test("FR-THEME-02 appearance section: the registered section shows the stored choice", () => {
    const data = new Map([[THEME_KEY, '{"theme":"gilt"}']]);
    g.localStorage = { getItem: (k: string) => data.get(k) ?? null, setItem() {} };
    const { Component } = appearanceSection;
    const on = options(renderToStaticMarkup(<Component />)).filter((o) => o.state === "on");
    expect(on.map((o) => o.value)).toEqual(["gilt"]);
    expect(themeStore().read()).toBe("gilt");
  });

  test("FR-THEME-02 appearance section: no stored choice → Gilt & Stone on; a stored `default` → Simple Dark on (DM #355)", () => {
    const data = new Map<string, string>();
    g.localStorage = { getItem: (k: string) => data.get(k) ?? null, setItem() {} };
    const { Component } = appearanceSection;
    const on = () =>
      options(renderToStaticMarkup(<Component />))
        .filter((o) => o.state === "on")
        .map((o) => o.value);
    expect(on()).toEqual(["gilt"]);
    data.set(THEME_KEY, '{"theme":"default"}');
    expect(on()).toEqual(["default"]);
  });
});

describe("FR-THEME-20 test IDs", () => {
  test("FR-THEME-20 test IDs: theme-section, theme-option with data-value = theme id and data-state on | off", () => {
    const html = renderToStaticMarkup(<AppearanceSection current="gilt" onPick={() => {}} />);
    expect(html.match(/data-testid="theme-[a-z-]+"/g)).toEqual([
      'data-testid="theme-section"',
      'data-testid="theme-option"',
      'data-testid="theme-option"',
    ]);
    expect(options(html).map((o) => `${o.value}:${o.state}`)).toEqual(["default:off", "gilt:on"]);
  });
});
