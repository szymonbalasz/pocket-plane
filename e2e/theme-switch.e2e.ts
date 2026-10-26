// e2e-bundle: base
// Theme switch (theme-system FR-THEME-01–04, -16; §13 D2, D4, P1; DM #355 default). The DM (A)
// opens a fresh browser: the login page and the play page are in Gilt & Stone before first paint
// (no flash of Simple Dark), the fonts arrive once as hashed, immutable built assets and a reload
// takes them from the cache. A switches to Simple Dark and back at once, no reload, every window
// rect unchanged. Player-1 (B, fresh) renders with the fonts held back, and the window rects stay
// put when they land. Player-1 on a browser with a stored `default` (C) stays Simple Dark, with no
// font fetched; their picks don't touch A's. Client-only: nothing is sent.
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, rolePage } from "./support/env";
import { shellWindow } from "./support/shell";
import { storedTheme } from "./support/theme";

const GILT_BG = "rgb(7, 10, 10)";
const SIMPLE_DARK_BG = "oklch(0.145 0 0)";

async function live(page: Page) {
  await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
}

/**
 * Records `data-theme` on <html> when <body> is first parsed (first paint can't come earlier) and
 * when React first renders into #root (FR-THEME-04), on every load of the page.
 */
async function watchBoot(page: Page) {
  await page.addInitScript(() => {
    const w = window as { __themeAtBody?: string | null; __themeAtMount?: string | null };
    const attr = () => document.documentElement.getAttribute("data-theme");
    new MutationObserver((_, obs) => {
      if (document.body && w.__themeAtBody === undefined) w.__themeAtBody = attr();
      if ((document.getElementById("root")?.childElementCount ?? 0) === 0) return;
      w.__themeAtMount = attr();
      obs.disconnect();
    }).observe(document, { childList: true, subtree: true });
  });
}

const boot = (page: Page) =>
  page.evaluate(() => {
    const w = window as { __themeAtBody?: string | null; __themeAtMount?: string | null };
    return { body: w.__themeAtBody, mount: w.__themeAtMount };
  });

const fontRequests = (page: Page) => {
  const urls: string[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith(".woff2")) urls.push(new URL(r.url()).pathname);
  });
  return urls;
};

/** Font files this page load used, with the bytes it took over the network (0 = from cache). */
const fontEntries = (page: Page) =>
  page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .filter((e) => e.name.endsWith(".woff2"))
      .map((e) => ({
        path: new URL(e.name).pathname,
        transfer: (e as PerformanceResourceTiming).transferSize,
      })),
  );

const themeWarnings = (page: Page) => {
  const out: string[] = [];
  page.on("console", (m) => {
    if (m.text().startsWith("theme:")) out.push(m.text());
  });
  return out;
};

const rects = (page: Page) =>
  page.getByTestId("ui-window").evaluateAll((ws) =>
    ws.map((w) => {
      const r = w.getBoundingClientRect();
      return `${w.getAttribute("data-record-id")} ${r.x},${r.y} ${r.width}×${r.height}`;
    }),
  );

const look = (page: Page) =>
  page.evaluate(() => {
    const b = getComputedStyle(document.body);
    return {
      bg: b.backgroundColor,
      font: b.fontFamily,
      theme: document.documentElement.dataset.theme,
    };
  });

async function openAppearance(page: Page) {
  await page.getByTestId("ui-prefs-open").click();
  const prefs = shellWindow(page, "shell.prefs");
  await prefs.waitFor({ state: "visible" });
  return prefs.getByTestId("theme-section");
}

const option = (section: ReturnType<Page["getByTestId"]>, id: string) =>
  section.locator(`[data-testid="theme-option"][data-value="${id}"]`);

test("FR-THEME-01–04, -16: a fresh browser opens in Gilt & Stone with no flash, fonts cached; switch to Simple Dark and back at once; a stored default stays Simple Dark (D2, D4, P1)", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();
  const a = await rolePage(browser);
  const sent: string[] = [];
  a.on("websocket", (ws) => ws.on("framesent", (f) => sent.push(String(f.payload))));
  const aFonts = fontRequests(a);
  const aWarnings = themeWarnings(a);
  const fontHeaders: string[] = [];
  a.on("response", (r) => {
    if (r.url().endsWith(".woff2")) fontHeaders.push(r.headers()["cache-control"] ?? "");
  });
  await watchBoot(a);

  // The login page (pre-play): Gilt & Stone from the first parsed <body>.
  await a.goto("/");
  await expect(a.getByTestId("camp-login-secret")).toBeVisible();
  expect(await boot(a)).toEqual({ body: "gilt", mount: "gilt" });
  expect(await look(a)).toMatchObject({ theme: "gilt", bg: GILT_BG });
  await a.getByTestId("camp-login-secret").fill(secret);
  await a.getByTestId("camp-login-submit").click();
  await live(a);
  const gilt = await look(a);
  expect(gilt).toMatchObject({ theme: "gilt", bg: GILT_BG });
  expect(gilt.font).toContain("Alegreya Sans");

  // Preferences: Gilt & Stone on; the original look is offered as "Simple Dark".
  const section = await openAppearance(a);
  await expect(option(section, "gilt")).toHaveAttribute("data-state", "on");
  await expect(option(section, "default")).toHaveAttribute("data-state", "off");
  await expect(option(section, "default")).toContainText("Simple Dark");
  await expect(option(section, "gilt")).toContainText("Gilt & Stone");
  expect(await a.evaluate(() => localStorage.getItem("pp.theme.v1"))).toBeNull();

  // FR-THEME-16: the fonts arrive as hashed built assets, cached for a year, each fetched once.
  await expect.poll(() => aFonts.some((u) => u.includes("alegreya-sans-400"))).toBe(true);
  await a.waitForLoadState("networkidle");
  await a.evaluate(() => document.fonts.ready);
  for (const u of aFonts) expect(u).toMatch(/^\/assets\/[a-z0-9-]+\.latin-[\w-]+\.woff2$/);
  expect(new Set(aFonts).size).toBe(aFonts.length);
  for (const h of fontHeaders) expect(h).toBe("public, max-age=31536000, immutable");
  const firstFonts = [...aFonts].sort();

  // D2: Simple Dark at once, the same page (no reload), same window rects; and back.
  const before = await rects(a);
  await a.evaluate(() => {
    (window as { __samePage?: boolean }).__samePage = true;
  });
  const sentBefore = sent.length;
  await option(section, "default").click();
  await expect(a.locator("html")).not.toHaveAttribute("data-theme", /.*/);
  await expect(option(section, "default")).toHaveAttribute("data-state", "on");
  await expect(option(section, "gilt")).toHaveAttribute("data-state", "off");
  expect((await look(a)).bg).toBe(SIMPLE_DARK_BG);
  expect(await rects(a)).toEqual(before);
  expect(await a.evaluate(() => localStorage.getItem("pp.theme.v1"))).toBe('{"theme":"default"}');
  await option(section, "gilt").click();
  await expect(a.locator("html")).toHaveAttribute("data-theme", "gilt");
  await expect(option(section, "gilt")).toHaveAttribute("data-state", "on");
  expect((await look(a)).bg).toBe(GILT_BG);
  expect(await rects(a)).toEqual(before);
  expect(await a.evaluate(() => (window as { __samePage?: boolean }).__samePage)).toBe(true);
  expect(await a.evaluate(() => localStorage.getItem("pp.theme.v1"))).toBe('{"theme":"gilt"}');
  expect(sent.length).toBe(sentBefore); // never sent (FR-THEME-03)

  // D4: reload keeps gilt, set before first paint; the fonts come from the cache.
  await a.reload();
  await live(a);
  expect(await boot(a)).toEqual({ body: "gilt", mount: "gilt" });
  await a.evaluate(() => document.fonts.ready);
  const cached = await fontEntries(a);
  expect(cached.length).toBeGreaterThan(0);
  for (const e of cached) expect(e).toEqual({ path: e.path, transfer: 0 });
  expect([...new Set(aFonts)].sort()).toEqual(firstFonts);
  expect(aWarnings).toEqual([]);

  // B: player-1, fresh browser, the fonts held back: the page renders in gilt on its fallback
  // stack, and nothing moves but glyphs when the fonts land.
  const b = await rolePage(browser);
  let release = () => {};
  const held = new Promise<void>((r) => {
    release = r;
  });
  await b.route("**/*.woff2", async (route) => {
    await held;
    await route.continue();
  });
  await watchBoot(b);
  await b.goto(link("Player 1"));
  await live(b);
  expect(await boot(b)).toEqual({ body: "gilt", mount: "gilt" });
  await expect(b.getByTestId("ui-topbar")).toBeVisible();
  await openAppearance(b);
  expect(await b.evaluate(() => document.fonts.status)).toBe("loading");
  const bBefore = await rects(b);
  const bar = await b.getByTestId("ui-topbar").boundingBox();
  release();
  await b.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  expect(await b.evaluate(() => document.fonts.status)).toBe("loaded");
  expect(await rects(b)).toEqual(bBefore);
  expect(await b.getByTestId("ui-topbar").boundingBox()).toEqual(bar);

  // C: player-1 on a browser that stored `default` keeps Simple Dark: no attribute, no font.
  const c = await rolePage(browser);
  await storedTheme(c, "default");
  const cFonts = fontRequests(c);
  await watchBoot(c);
  await c.goto(link("Player 1"));
  await live(c);
  expect(await boot(c)).toEqual({ body: null, mount: null });
  expect(await look(c)).toMatchObject({ theme: undefined, bg: SIMPLE_DARK_BG });
  const cSection = await openAppearance(c);
  await expect(option(cSection, "default")).toHaveAttribute("data-state", "on");
  await c.waitForLoadState("networkidle");
  expect(cFonts).toEqual([]);
  await c.reload();
  await live(c);
  expect(await boot(c)).toEqual({ body: null, mount: null });
  // P1: their own picks don't touch the DM's browser.
  const cSection2 = await openAppearance(c);
  await option(cSection2, "gilt").click();
  await expect(c.locator("html")).toHaveAttribute("data-theme", "gilt");
  await option(cSection2, "default").click();
  await expect(c.locator("html")).not.toHaveAttribute("data-theme", /.*/);
  expect(await c.evaluate(() => localStorage.getItem("pp.theme.v1"))).toBe('{"theme":"default"}');
  await expect(a.locator("html")).toHaveAttribute("data-theme", "gilt");
});
