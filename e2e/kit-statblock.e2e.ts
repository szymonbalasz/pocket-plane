// e2e-bundle: kit-parity
// Kit parity K7 (kit-parity §6.11, §13): the DM stat-block window at 1440×900. Initiative ⋯ on the
// Goblin's row → Stat block: the window opens bound (In combat chip, kit card), at its useful
// size 300 × 360 the core row, abilities and the attack row's buttons show without scrolling;
// Attack + damage → the damage card opens in the DM popup. Player-1 has no stat block launcher
// or window (FR-KIT-107).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { launcherButton, openWindow, shellWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

/** Resizes a window by its handle, as a user would (as useful-size.e2e.ts). */
async function resizeTo(page: Page, win: Locator, w: number, h: number) {
  const box = await win.boundingBox();
  const handle = await win.getByTestId("ui-window-resize").boundingBox();
  if (!box || !handle) throw new Error("window not shown");
  const x = handle.x + handle.width / 2;
  const y = handle.y + handle.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) {
    await page.mouse.move(x + ((w - box.width) * i) / 5, y + ((h - box.height) * i) / 5);
  }
  await page.mouse.up();
  await expect
    .poll(async () => {
      const b = await win.boundingBox();
      return b && [Math.round(b.width), Math.round(b.height)];
    })
    .toEqual([w, h]);
}

test("FR-KIT-101 FR-KIT-103 FR-KIT-105 FR-KIT-107 Initiative ⋯ → Stat block (bound) → Attack + damage → the damage popup; the player has no stat block", async ({
  browser,
}, testInfo) => {
  const { secret, link } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const init = await openWindow(dm, "cbt.initiative");
  const goblin = init.locator('[data-testid="cbt-init-row"]', {
    has: dm.locator('[data-testid="cbt-init-row-name"][data-value="Goblin"]'),
  });
  await goblin.hover();
  await goblin.getByTestId("cbt-init-row-menu").first().click();
  await dm.getByTestId("cbt-init-row-statblock").click();

  // FR-KIT-102 / -103: the one window, titled "Stat block", the Goblin's kit card, bound.
  const sb = shellWindow(dm, "ent.statblock");
  await expect(sb).toHaveAttribute("data-state", "open");
  await expect(sb.getByTestId("ent-statblock-name")).toHaveText("Goblin");
  await expect(sb.getByTestId("ent-statblock-combat")).toBeVisible();
  await expect(sb.getByTestId("ent-statblock-type")).toContainText(/Small/);
  await expect(sb.getByTestId("ent-statblock-ability")).toHaveCount(6);
  await expect(sb.getByTestId("ent-statblock-hp")).toHaveText(/^\d+ \/ \d+$/);
  // Evidence for the walkthrough's kit pair (the default theme, Gilt & Stone).
  await sb.screenshot({ path: testInfo.outputPath("app-statblock-gilt.png") });

  // §7.3 useful size (walkthrough F2): on the Elite (hidden, 2 attacks), name, type line, core
  // row, abilities and both attack rows with their buttons whole at 300 × 360, unscrolled.
  const elite = init.locator('[data-testid="cbt-init-row"]', {
    has: dm.locator('[data-testid="cbt-init-row-name"][data-value^="Elite"]'),
  });
  await elite.hover();
  await elite.getByTestId("cbt-init-row-menu").first().click();
  await dm.getByTestId("cbt-init-row-statblock").click();
  await expect(sb.getByTestId("ent-statblock-name")).toHaveText(/^Elite/);
  await expect(sb.getByTestId("ent-statblock-attack")).toHaveCount(2);
  await resizeTo(dm, sb, 300, 360);
  // The card's own scroll box (re-test: it ends 12 px above the window body's box).
  const scroller = sb.locator('[data-testid="ent-statblock"]').locator("xpath=..");
  const body = await scroller.evaluate((e) => {
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: e.clientHeight };
  });
  const fits = async (id: string) => {
    const b = await sb.getByTestId(id).last().boundingBox();
    return (b?.y ?? 0) + (b?.height ?? 0) <= (body?.y ?? 0) + (body?.height ?? 0) + 0.5;
  };
  const both = await sb
    .getByTestId("ent-statblock-attack")
    .last()
    .getByTestId("ent-statblock-roll-both")
    .boundingBox();
  console.log(
    `useful-size ent.statblock: scroll box ${JSON.stringify(body)} 2nd both ${JSON.stringify(both)}`,
  );
  for (const id of ["ent-statblock-type", "ent-statblock-core", "ent-statblock-abilities"]) {
    expect({ id, fits: await fits(id) }).toEqual({ id, fits: true });
  }
  expect((both?.y ?? 0) + (both?.height ?? 0)).toBeLessThanOrEqual(
    (body?.y ?? 0) + (body?.height ?? 0) + 0.5,
  );
  // Nothing hidden behind a scroll: the content's own scroll box sits at the top.
  expect(await scroller.evaluate((e) => e.scrollTop)).toBe(0);
  await sb.screenshot({ path: testInfo.outputPath("app-statblock-useful-elite.png") });

  // FR-KIT-105: Attack + damage (bound) → cbt.attack → the damage card in the DM popup.
  await goblin.hover();
  await goblin.getByTestId("cbt-init-row-menu").first().click();
  await dm.getByTestId("cbt-init-row-statblock").click();
  await expect(sb.getByTestId("ent-statblock-name")).toHaveText("Goblin");
  await sb.getByTestId("ent-statblock-roll-both").first().click();
  const popup = dm.getByTestId("cbt-popup");
  await expect(popup).toBeVisible();
  await expect(popup.getByTestId("cbt-popup-drag")).toContainText("Goblin");

  // FR-KIT-107: the player has no stat block launcher entry or window.
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1440, height: 900 });
  await p1.goto(link("Player 1"));
  await live(p1);
  await expect(launcherButton(p1, "ent.statblock")).toHaveCount(0);
  await expect(shellWindow(p1, "ent.statblock")).toHaveCount(0);
  await expect(p1.getByTestId("cmp-statblock-open")).toHaveCount(0);
  await dm.context().close();
  await p1.context().close();
});
