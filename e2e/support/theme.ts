import type { Page } from "@playwright/test";

/**
 * A browser that already chose `theme` (theme-system FR-THEME-03): stores `pp.theme.v1` before the
 * page's own scripts run, so the boot script applies it before first paint. Only while nothing is
 * stored, so a pick made in the page survives a reload. For specs about Simple Dark (`default`);
 * a fresh browser opens in Gilt & Stone (DM #355).
 */
export async function storedTheme(page: Page, theme: "default" | "gilt") {
  await page.addInitScript((t) => {
    if (localStorage.getItem("pp.theme.v1") === null)
      localStorage.setItem("pp.theme.v1", JSON.stringify({ theme: t }));
  }, theme);
}
