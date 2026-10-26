// e2e-bundle: base
// Theme switch (theme-system T1: FR-THEME-01–04, -16; §13 D2, D4, P1). DM (A) and player-1 (B) in
// separate contexts. A starts in Default (no `data-theme`, no theme font fetched, Preferences'
// Gilt & Stone preview included); picks Gilt & Stone: the page restyles at once with no reload,
// every window rect unchanged, `pp.theme.v1` stored, the fonts fetched as hashed built assets.
// Reload: gilt is on <html> before React mounts. B stays Default meanwhile, then picks gilt on
// its own browser. Client-only: nothing is sent.
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { shellWindow } from "./support/shell";

async function live(page: Page) {
  await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
}

/** Records the `data-theme` on <html> when React first renders into #root (FR-THEME-04). */
async function watchMount(page: Page) {
  await page.addInitScript(() => {
    const w = window as { __themeAtMount?: string | null };
    new MutationObserver((_, obs) => {
      if ((document.getElementById("root")?.childElementCount ?? 0) === 0) return;
      w.__themeAtMount = document.documentElement.getAttribute("data-theme");
      obs.disconnect();
    }).observe(document, { childList: true, subtree: true });
  });
}

const fontRequests = (page: Page) => {
  const urls: string[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith(".woff2")) urls.push(new URL(r.url()).pathname);
  });
  return urls;
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

test("FR-THEME-01–04, -16: switch to Gilt & Stone at once, no reload, rects unchanged, kept on reload, per browser (D2, D4, P1)", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();
  const a = await rolePage(browser);
  const sent: string[] = [];
  a.on("websocket", (ws) => ws.on("framesent", (f) => sent.push(String(f.payload))));
  const aFonts = fontRequests(a);
  await watchMount(a);
  await loginDm(a, secret);
  await live(a);
  expect(await look(a)).toMatchObject({ theme: undefined, bg: "oklch(0.145 0 0)" });

  // Default: Preferences shows both cards; the Gilt preview uses fallbacks, no font fetched.
  const section = await openAppearance(a);
  await expect(option(section, "default")).toHaveAttribute("data-state", "on");
  await expect(option(section, "gilt")).toHaveAttribute("data-state", "off");
  await a.waitForLoadState("networkidle");
  expect(aFonts).toEqual([]);

  // D2: pick Gilt & Stone → everything at once, the same page (no reload), same window rects.
  const before = await rects(a);
  await a.evaluate(() => {
    (window as { __samePage?: boolean }).__samePage = true;
  });
  const sentBefore = sent.length;
  await option(section, "gilt").click();
  await expect(a.locator("html")).toHaveAttribute("data-theme", "gilt");
  await expect(option(section, "gilt")).toHaveAttribute("data-state", "on");
  await expect(option(section, "default")).toHaveAttribute("data-state", "off");
  expect(await a.evaluate(() => (window as { __samePage?: boolean }).__samePage)).toBe(true);
  const gilt = await look(a);
  expect(gilt.bg).toBe("rgb(7, 10, 10)");
  expect(gilt.font).toContain("Alegreya Sans");
  expect(await rects(a)).toEqual(before);
  expect(await a.evaluate(() => localStorage.getItem("pp.theme.v1"))).toBe('{"theme":"gilt"}');
  // FR-THEME-16: the fonts arrive as hashed built assets, only now.
  await expect.poll(() => aFonts.some((u) => u.includes("alegreya-sans-400"))).toBe(true);
  for (const u of aFonts) expect(u).toMatch(/^\/assets\/[a-z0-9-]+\.latin-[\w-]+\.woff2$/);
  expect(sent.length).toBe(sentBefore); // never sent (FR-THEME-03)

  // D4: reload keeps gilt, set before React mounts.
  await a.reload();
  await live(a);
  expect(await a.evaluate(() => (window as { __themeAtMount?: string }).__themeAtMount)).toBe(
    "gilt",
  );
  await expect(a.locator("html")).toHaveAttribute("data-theme", "gilt");

  // P1: player-1's browser keeps Default; their own pick doesn't touch the DM's.
  const b = await rolePage(browser);
  const bFonts = fontRequests(b);
  await b.goto(link("Player 1"));
  await live(b);
  expect((await look(b)).theme).toBeUndefined();
  const bSection = await openAppearance(b);
  await expect(option(bSection, "default")).toHaveAttribute("data-state", "on");
  await b.waitForLoadState("networkidle");
  expect(bFonts).toEqual([]);
  await option(bSection, "gilt").click();
  await expect(b.locator("html")).toHaveAttribute("data-theme", "gilt");
  await option(bSection, "default").click();
  await expect(b.locator("html")).not.toHaveAttribute("data-theme", /.*/);
  expect(await b.evaluate(() => localStorage.getItem("pp.theme.v1"))).toBe('{"theme":"default"}');
  await expect(a.locator("html")).toHaveAttribute("data-theme", "gilt");
});
