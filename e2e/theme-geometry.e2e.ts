// e2e-bundle: theme-gilt
// Theme geometry (theme-system T2: FR-THEME-05, -10 – -15, -19; ADR-0069; §13 E2E). The DM opens
// Initiative (round 3, six combatants), Game log, Mira's sheet and Preferences in Default, then
// switches to Gilt & Stone and back: every `ui-window` and `ui-window-body` rect, the top bar and
// the tool rail stay the same and the launcher shows the same labels; Gilt draws its look (gem
// close, frame, corner pieces, title face, scroll tooltip, gold scrollbars, number face); back in
// Default every key part's computed style is what it was, and equals the page with every gilt
// rule removed (FR-THEME-19). Player-1's sheet at 320 × 440 (P2) keeps its rects too; reduced
// motion drops the tooltip's unroll. Client-only: no records (CON-44 unchanged).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow, shellWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

/** Every window and body rect, the top bar and tool rail, and the launcher's labelled buttons. */
const geometry = (page: Page) =>
  page.evaluate(() => {
    const r = (el: Element | null) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return [b.x, b.y, b.width, b.height].map((n) => Math.round(n * 10) / 10).join(",");
    };
    const out: Record<string, string | null> = {};
    for (const w of document.querySelectorAll('[data-testid="ui-window"]')) {
      const id = w.getAttribute("data-record-id");
      out[`window ${id}`] = r(w);
      out[`body ${id}`] = r(w.querySelector('[data-testid="ui-window-body"]'));
      out[`title ${id}`] = r(w.querySelector('[data-testid="ui-window-title"]'));
    }
    out.topbar = r(document.querySelector('[data-testid="ui-topbar"]'));
    out.rail = r(document.querySelector('[data-testid="map-tool-rail"]'));
    const labelled = [
      ...document.querySelectorAll('[data-testid="ui-launcher-button"][data-compact="false"]'),
    ].map((b) => b.getAttribute("data-record-id"));
    out.launcher = labelled.join(" ");
    out.overflow = document
      .querySelector('[data-testid="ui-launcher-overflow"]')
      ?.getAttribute("data-count") as string;
    return out;
  });

/** The parts FR-THEME-19 compares, by name → a selector the page can find. */
const PARTS: Record<string, string> = {
  window: '[data-testid="ui-window"][data-record-id="cbt.initiative:main"]',
  title: '[data-record-id="cbt.initiative:main"] [data-testid="ui-window-title"]',
  close: '[data-record-id="cbt.initiative:main"] [data-testid="ui-window-close"]',
  minimise: '[data-record-id="cbt.initiative:main"] [data-testid="ui-window-minimise"]',
  body: '[data-record-id="cbt.initiative:main"] [data-testid="ui-window-body"]',
  row: '[data-testid="cbt-init-row"][data-turn="true"]',
  init: '[data-testid="cbt-init-row-init"]',
  button: '[data-record-id="cbt.initiative:main"] [data-slot="button"]',
  topbar: '[data-testid="ui-topbar"]',
  launcher: '[data-testid="ui-launcher"]',
  launcherButton: '[data-testid="ui-launcher-button"]',
  tool: '[data-testid="map-tool-rail"] [data-slot="toggle-group-item"][data-state="off"]',
  toolOn: '[data-testid="map-tool-rail"] [data-slot="toggle-group-item"][data-state="on"]',
  tab: '[data-slot="sheet-tabs"] [data-slot="tabs-trigger"][data-state="active"]',
  box: '[data-slot="sheet-box"]',
  roll: '[data-testid="charx-roll-skill"]',
  pip: '[data-slot="sheet-pip"]',
  logEntry: '[data-testid="dice-log-entry"]',
  option: '[data-testid="theme-option"][data-value="default"]',
};

const PROPS = [
  "color",
  "backgroundColor",
  "backgroundImage",
  "borderTopColor",
  "borderRadius",
  "boxShadow",
  "fontFamily",
  "fontVariantNumeric",
  "outlineStyle",
  "transform",
  "filter",
  "clipPath",
  "animationName",
  "scrollbarColor",
  "scrollbarWidth",
  "textTransform",
] as const;

/** Each part's computed style, its ::before and ::after included (pointer parked first). */
const styles = async (page: Page) => {
  await page.mouse.move(2, 890);
  return page.evaluate(
    ({ parts, props }) => {
      const out: Record<string, string> = {};
      for (const [name, sel] of Object.entries(parts)) {
        const el = document.querySelector(sel);
        if (!el) {
          out[name] = "missing";
          continue;
        }
        for (const pseudo of ["", "::before", "::after"]) {
          const cs = getComputedStyle(el, pseudo || null) as unknown as Record<string, string>;
          out[`${name}${pseudo}`] = props.map((p) => `${p}=${cs[p]}`).join("; ");
          if (pseudo) out[`${name}${pseudo}`] += `; content=${cs.content}`;
        }
      }
      return out;
    },
    { parts: PARTS, props: PROPS as readonly string[] },
  );
};

/** Removes every CSS rule that names `data-theme="gilt"` (nested in layers / media too). */
const dropGiltRules = (page: Page) =>
  page.evaluate(() => {
    let n = 0;
    const strip = (list: CSSRuleList, owner: CSSStyleSheet | CSSGroupingRule) => {
      for (let i = list.length - 1; i >= 0; i--) {
        const rule = list[i] as CSSRule;
        if ("cssRules" in rule && !(rule instanceof CSSStyleRule)) {
          strip((rule as CSSGroupingRule).cssRules, rule as CSSGroupingRule);
          continue;
        }
        if (rule instanceof CSSStyleRule && rule.selectorText.includes('data-theme="gilt"')) {
          owner.deleteRule(i);
          n++;
        }
      }
    };
    for (const sheet of document.styleSheets) strip(sheet.cssRules, sheet);
    return n;
  });

const option = (page: Page, id: string) =>
  page.locator(`[data-testid="theme-option"][data-value="${id}"]`);

/** Picks a theme in Preferences and waits until its fonts are in and the layout settled. */
async function pick(page: Page, id: "default" | "gilt") {
  await option(page, id).click();
  if (id === "gilt") await expect(page.locator("html")).toHaveAttribute("data-theme", "gilt");
  else await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}

/**
 * The rail's tools: the base three plus the canvas registry's for this client. Registry tools join
 * the rail only once the lazy MapCanvas chunk mounts (it sets the tool store's client), so a
 * measure taken before then sees a shorter rail; wait for them first.
 */
const RAIL_TOOLS = {
  dm: ["select", "ruler", "ping", "structure", "props", "aoe", "fog"],
  player: ["select", "ruler", "ping", "aoe"],
};
async function railReady(page: Page, client: keyof typeof RAIL_TOOLS) {
  const items = page.locator('[data-testid="map-tool-rail"] [data-slot="toggle-group-item"]');
  await expect(items).toHaveCount(RAIL_TOOLS[client].length);
  for (const id of RAIL_TOOLS[client])
    await expect(page.getByTestId(`map-tool-${id}`)).toBeVisible();
}

/** The rail's height: equal under both themes (FR-THEME-05). */
const railHeight = (page: Page) =>
  page.getByTestId("map-tool-rail").evaluate((el) => el.getBoundingClientRect().height);

/** Waits for fonts and the layout to stop moving (grown windows settle after a font swap). */
async function settled(page: Page) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  let last = "";
  await expect
    .poll(
      async () => {
        const now = JSON.stringify(await geometry(page));
        const same = now === last;
        last = now;
        return same;
      },
      { intervals: [200, 200, 300, 500] },
    )
    .toBe(true);
  return geometry(page);
}

async function pickMira(win: Locator) {
  const miraId = e2eEnv().recordId("char-mira", "entity");
  const picker = win.getByTestId("char-sheet-picker");
  if (await picker.count()) await picker.selectOption(miraId);
  await expect(win.getByTestId("char-sheet")).toHaveAttribute("data-record-id", miraId);
}

test("FR-THEME-05 FR-THEME-10 FR-THEME-11 FR-THEME-12 FR-THEME-13 FR-THEME-14 FR-THEME-15 FR-THEME-19 theme geometry: windows unchanged across themes, Gilt's look drawn, Default exactly as before", async ({
  browser,
}) => {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1600, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const init = await openWindow(dm, "cbt.initiative");
  await expect(init.getByTestId("cbt-init-round")).toHaveAttribute("data-value", "3");
  await expect(init.getByTestId("cbt-init-row")).toHaveCount(6);
  await openWindow(dm, "dice.log");
  await expect(dm.getByTestId("dice-log-entry").first()).toBeVisible();
  await pickMira(await openWindow(dm, "char.sheet"));
  await dm.getByTestId("ui-prefs-open").click();
  await shellWindow(dm, "shell.prefs").waitFor({ state: "visible" });
  await expect(option(dm, "default")).toHaveAttribute("data-state", "on");
  await railReady(dm, "dm");

  const before = await settled(dm);
  const rail = await railHeight(dm);
  expect(
    Object.keys(before)
      .filter((k) => k.startsWith("window "))
      .sort(),
  ).toEqual([
    "window cbt.initiative:main",
    "window char.sheet:main",
    "window dice.log:main",
    "window shell.prefs:main",
  ]);
  const defaultLook = await styles(dm);
  expect(Object.entries(defaultLook).filter(([, v]) => v === "missing")).toEqual([]);

  // Gilt & Stone: the same boxes everywhere.
  await pick(dm, "gilt");
  expect(await settled(dm)).toEqual(before);
  await railReady(dm, "dm");
  expect(await railHeight(dm)).toBe(rail);

  // FR-THEME-10: frame, corner pieces, title face, gem close, stone minimise.
  const look = await styles(dm);
  expect(look["window::before"]).toContain("inset");
  expect(look["window::after"]?.match(/url\(/g)?.length).toBe(4);
  expect(look.title).toContain("IM Fell English SC");
  expect(look.close).toMatch(/backgroundImage=radial-gradient/);
  expect(look.close).toContain("borderRadius=50%");
  expect(look.minimise).toMatch(/backgroundImage=url\(.*linear-gradient/);
  // FR-THEME-11: stone buttons and tools, the active tab's gem underline + diamond.
  expect(look.launcherButton).toMatch(/backgroundImage=url\(.*linear-gradient/);
  expect(look.tool).toMatch(/backgroundImage=url\(.*linear-gradient/);
  expect(look.toolOn).toMatch(/backgroundImage=radial-gradient/);
  expect(look["tab::after"]).toMatch(/backgroundImage=linear-gradient/);
  expect(look["tab::before"]).toContain("transform=matrix(0.707107, 0.707107"); // 45°
  expect(look.box).toContain("clipPath=polygon");
  // FR-THEME-14: gold thumb on a dark track; FR-THEME-15: the number face, lining figures.
  expect(look.body).toContain("scrollbarColor=rgb(176, 138, 74) rgb(10, 12, 12)");
  expect(look.body).toContain("scrollbarWidth=thin");
  expect(look.init).toContain("EB Garamond");
  expect(look.init).toMatch(/fontVariantNumeric=[^;]*lining-nums/);
  expect(look.roll).toContain("EB Garamond");

  // FR-THEME-12: hovering a log line unrolls the parchment after the shared delay.
  await dm.getByTestId("dice-log-entry-text").first().hover();
  const tip = dm.getByTestId("ui-tooltip");
  await expect(tip).toBeVisible();
  const tipLook = await tip.evaluate((el) => {
    const cs = getComputedStyle(el);
    const end = getComputedStyle(el, "::after");
    return {
      bg: cs.backgroundColor,
      ink: cs.color,
      font: cs.fontFamily,
      anim: `${cs.animationName} ${cs.animationDuration}`,
      end: end.content !== "none" && end.position === "absolute",
    };
  });
  expect(tipLook).toMatchObject({
    bg: "rgb(232, 214, 168)",
    ink: "rgb(43, 29, 14)",
    anim: "gs-unroll 0.26s",
    end: true,
  });
  expect(tipLook.font).toContain("EB Garamond");

  // Default again restores every part exactly (FR-THEME-19).
  await pick(dm, "default");
  expect(await settled(dm)).toEqual(before);
  expect(await railHeight(dm)).toBe(rail);
  expect(await styles(dm)).toEqual(defaultLook);
  // … and equals the page with every gilt rule removed: gilt adds nothing under Default.
  expect(await dropGiltRules(dm)).toBeGreaterThan(100);
  expect(await styles(dm)).toEqual(defaultLook);
  expect(await geometry(dm)).toEqual(before);
});

test("FR-THEME-05 FR-THEME-12 FR-THEME-14 theme geometry (P2): player-1's sheet at 320 × 440 keeps its rects; the tab strip's arrows and gold scrollbar; reduced motion → no unroll", async ({
  browser,
}) => {
  const { link } = e2eEnv();
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1440, height: 900 });
  await p1.emulateMedia({ reducedMotion: "reduce" });
  await p1.goto(link("Player 1"));
  await live(p1);
  const sheet = await openWindow(p1, "char.sheet");
  await pickMira(sheet);
  expect(await sheet.boundingBox()).toMatchObject({ width: 320, height: 440 });
  await openWindow(p1, "dice.log");
  await p1.getByTestId("ui-prefs-open").click();
  await shellWindow(p1, "shell.prefs").waitFor({ state: "visible" });
  await railReady(p1, "player");
  const before = await settled(p1);
  const rail = await railHeight(p1);

  await pick(p1, "gilt");
  expect(await settled(p1)).toEqual(before);
  await railReady(p1, "player");
  expect(await railHeight(p1)).toBe(rail);
  // P2: the strip overflows at 320: the next arrow shows; its scrollbar is the gold one.
  await expect(sheet.getByTestId("charx-tabs-next")).toBeVisible();
  const strip = await sheet
    .locator('[data-slot="sheet-tabs"] [data-slot="tabs-list"]')
    .evaluate((el) => {
      const s = getComputedStyle(el.parentElement as Element);
      return { color: s.scrollbarColor, width: s.scrollbarWidth };
    });
  expect(strip).toEqual({ color: "rgb(176, 138, 74) rgb(10, 12, 12)", width: "thin" });
  // Reduced motion: the tooltip appears without the unroll.
  await sheet.getByTestId("charx-roll-skill").first().hover();
  const tip = p1.getByTestId("ui-tooltip");
  await expect(tip).toBeVisible();
  expect(await tip.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
});
