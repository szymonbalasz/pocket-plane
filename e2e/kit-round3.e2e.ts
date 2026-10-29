// e2e-bundle: kit-round3
// Thin kit-parity K13 flow (round 3, DM #363) under Gilt & Stone (a fresh browser's theme): the
// DM's sheet on Mira mid-fight at 320 (level line on one line, the tab strip's faded end, the
// effects menu beside the last chip) and enlarged to the kit's 680 (Main shows Attacks, Spells with
// slot pips and Limited uses under the passives); the compendium's 30-px body-type rows; the top
// bar's stone identity chip, plain status text and red-gem badge; Party Manager's whole New pet…
// button. Screenshots go to `.verify/k13-shots/` next to the kit page's pieces. Markup, test IDs
// and every detail: bun test (`print-sheet.test.tsx`, `views.test.tsx`, `prefs.test.tsx`, …).
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { pickSheet } from "./support/sheet";
import { openWindow } from "./support/shell";

const SHOTS = resolve(".verify/k13-shots");
const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

/** Drags the window's resize grip until the window is `w × h`. */
async function resizeTo(page: Page, win: Locator, w: number, h: number) {
  const box = await win.boundingBox();
  const grip = await win.getByTestId("ui-window-resize").boundingBox();
  if (!box || !grip) throw new Error("window not shown");
  const x = grip.x + grip.width / 2;
  const y = grip.y + grip.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++)
    await page.mouse.move(x + ((w - box.width) * i) / 5, y + ((h - box.height) * i) / 5);
  await page.mouse.up();
  await expect
    .poll(async () => {
      const b = await win.boundingBox();
      return b && [Math.round(b.width), Math.round(b.height)];
    })
    .toEqual([w, h]);
}

/** Moves the window by its title bar so its top-left lands near (x, y). */
async function moveTo(page: Page, win: Locator, x: number, y: number) {
  const t = await win.getByTestId("ui-window-title").boundingBox();
  const b = await win.boundingBox();
  if (!t || !b) throw new Error("no title bar");
  await page.mouse.move(t.x + 40, t.y + t.height / 2);
  await page.mouse.down();
  await page.mouse.move(x + 40 + (t.x - b.x), y + t.height / 2 + (t.y - b.y), { steps: 5 });
  await page.mouse.up();
}

async function shoot(target: Locator, name: string) {
  await target.page().mouse.move(0, 0);
  await target.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** Lines an element's text takes (its height over its line height). */
const lines = (l: Locator) =>
  l.evaluate((e) => {
    const r = e.getBoundingClientRect();
    return Math.round(r.height / Number.parseFloat(getComputedStyle(e).lineHeight));
  });

test("FR-CHARX-114 FR-KIT-76 FR-KIT-13 K13 round 3: wide sheet boxes, narrow nits, compendium rows, top bar, New pet", async ({
  browser,
}) => {
  const { secret, recordId } = e2eEnv();
  const miraId = recordId("char-mira", "entity");

  // The kit's pieces, for the side-by-side (read-only page).
  const kit = await rolePage(browser);
  await kit.setViewportSize({ width: 1440, height: 1000 });
  await kit.goto(pathToFileURL(resolve("docs/design/art/kit/gilt-stone.html")).href);
  await kit.locator(".sheet.narrow").screenshot({ path: `${SHOTS}/kit-sheet-narrow.png` });
  await kit.locator(".sheet.full").screenshot({ path: `${SHOTS}/kit-sheet-wide.png` });
  await kit
    .locator(".appbar")
    .first()
    .screenshot({ path: `${SHOTS}/kit-topbar.png` });
  await kit
    .locator(".tbl")
    .first()
    .screenshot({ path: `${SHOTS}/kit-compendium.png` });
  await kit.context().close();

  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);

  // Top bar: the identity chip is a 30-px stone (outline) chip with the gear inside; the status is
  // plain text (no frame); a launcher badge is the red gem with its count kept.
  const chip = dm.getByTestId("ui-prefs-open");
  await expect(chip).toHaveAttribute("data-variant", "outline");
  expect(Math.round((await chip.boundingBox())?.height ?? 0)).toBe(30);
  await expect(chip.locator("svg.lucide-settings")).toBeVisible();
  const status = dm.getByTestId("ui-topbar-status");
  await expect(status).toContainText("Live");
  expect(
    await status.evaluate((e) => {
      const s = getComputedStyle(e);
      return [s.borderTopWidth, s.backgroundImage, s.boxShadow];
    }),
  ).toEqual(["0px", "none", "none"]);
  const badge = dm.locator('[data-slot="launcher-badge"]').first();
  await expect(badge).toBeVisible();
  expect(await badge.textContent()).toMatch(/^\d+\+?$/);
  expect(await badge.evaluate((e) => getComputedStyle(e, "::before").rotate)).toBe("45deg");
  await shoot(dm.getByTestId("ui-topbar"), "app-topbar");

  // The sheet at 320: Mira mid-fight.
  const win = await openWindow(dm, "char.sheet");
  await pickSheet(win, miraId);
  await expect(win.getByTestId("char-sheet")).toHaveAttribute("data-record-id", miraId);
  await expect(win.getByTestId("char-sheet-combat")).toBeVisible();
  expect(await win.boundingBox()).toMatchObject({ width: 320, height: 440 });
  // "Level 1 Fighter · Human" on one line; the strip's hidden end fades; no wide boxes.
  await expect(win.getByTestId("char-sheet-level")).toHaveText("Level 1 Fighter · Human");
  expect(await lines(win.getByTestId("char-sheet-level"))).toBe(1);
  await expect(win.locator('[data-slot="sheet-tabs"] [data-fade]')).toHaveAttribute(
    "data-fade",
    "end",
  );
  await expect(win.getByTestId("charx-main-actions")).toHaveCount(0);
  // The effects menu comes last, right beside the last chip on its line (the chip gap less its
  // 4-px inset), never past the line's end.
  const fit = await win.getByTestId("charx-header-chips").evaluate((line) => {
    const m = line
      .querySelector('[data-testid="cbtx-sheet-effects-menu"]')
      ?.getBoundingClientRect();
    const chips = [
      ...line.querySelectorAll('[data-testid="cbtx-sheet-effect"], [data-slot="sheet-chip"]'),
    ].map((c) => c.getBoundingClientRect());
    const last = chips.sort((a, b) => a.bottom - b.bottom || a.right - b.right).at(-1);
    if (!m || !last) return null;
    const mid = m.top + m.height / 2;
    return {
      gap: Math.round(m.left - last.right),
      sameLine: last.top <= mid && mid <= last.bottom,
      inside: m.right <= line.getBoundingClientRect().right + 0.5,
    };
  });
  expect(fit).toEqual({ gap: 2, sameLine: true, inside: true });
  await shoot(win, "app-sheet-narrow");

  // Enlarged to the kit's 680: Main shows Attacks, Spells (slot pips) and Limited uses under the
  // passives, each repeated control scoped to Main; nothing overflows sideways.
  await moveTo(dm, win, 300, 70);
  await resizeTo(dm, win, 680, 800);
  const boxes = win.getByTestId("charx-main-actions");
  await expect(boxes).toBeVisible();
  for (const key of ["attacks", "spells", "uses"])
    await expect(
      boxes.locator(`[data-testid="charx-box"][data-value="${key}"][data-scope="main"]`),
    ).toBeVisible();
  await expect(boxes.locator('[data-testid="charx-slot"][data-scope="main"]')).toHaveCount(2);
  await expect(boxes.locator('[data-testid="charx-roll-damage"][data-scope="main"]')).toHaveCount(
    2,
  );
  const passives = await win
    .locator('[data-testid="charx-box"][data-value="passives"]')
    .boundingBox();
  const attacks = await boxes.locator('[data-value="attacks"]').boundingBox();
  expect((attacks?.y ?? 0) > (passives?.y ?? 0)).toBe(true);
  // The boxes span both columns (kit wide sheet): from the abilities' left edge to the passives'
  // right edge, below the lower of the two columns.
  const ability = await win.getByTestId("char-sheet-ability").last().boundingBox();
  expect(Math.abs((attacks?.x ?? 0) - (ability?.x ?? 0))).toBeLessThanOrEqual(1);
  expect(
    Math.abs(
      (attacks?.x ?? 0) + (attacks?.width ?? 0) - (passives?.x ?? 0) - (passives?.width ?? 0),
    ),
  ).toBeLessThanOrEqual(1);
  expect(attacks?.y ?? 0).toBeGreaterThan((ability?.y ?? 0) + (ability?.height ?? 0));
  // Kit rows: small stone buttons left under the numbers; slots "1st" ◆◇ "1 / 2".
  const atk = boxes.locator('[data-testid="charx-roll-attack"]').first();
  expect(Math.round((await atk.boundingBox())?.height ?? 0)).toBe(24);
  expect(Math.abs(((await atk.boundingBox())?.x ?? 0) - (attacks?.x ?? 0))).toBeLessThan(16);
  await expect(boxes.locator('[data-testid="charx-slot-count"][data-value="1"]')).toHaveText(
    "1 / 2",
  );
  expect(
    await win.getByTestId("charx-content").evaluate((c) => c.scrollWidth - c.clientWidth),
  ).toBe(0);
  await boxes.scrollIntoViewIfNeeded();
  await shoot(win, "app-sheet-wide");
  // The Actions tab is unchanged: no scope there.
  await win.locator('[data-testid="charx-tab"][data-value="actions"]').click();
  await expect(win.locator('[data-testid="charx-attack"]').first()).toBeVisible();
  await expect(win.locator("[data-scope]")).toHaveCount(0);
  await win.getByTestId("ui-window-close").click();

  // Compendium: kit 30-px rows, body type in every cell, a long name's whole text in its Tooltip.
  const cmp = await openWindow(dm, "cmp.compendium");
  await cmp.getByTestId("cmp-search").fill("goblin");
  const goblin = cmp
    .getByTestId("cmp-result")
    .filter({ has: dm.getByTestId("cmp-result-name").getByText("Goblin", { exact: true }) })
    .first();
  await expect(goblin).toContainText("CR 1/4");
  const h = Math.round((await goblin.boundingBox())?.height ?? 0);
  expect(h).toBeGreaterThanOrEqual(28);
  expect(h).toBeLessThanOrEqual(32);
  const fonts = await goblin.evaluate((row) =>
    [...row.querySelectorAll<HTMLElement>(":scope > span")].map(
      (c) => getComputedStyle(c).fontFamily.split(",")[0],
    ),
  );
  expect(fonts.slice(0, 2)).toEqual(['"Alegreya Sans"', '"Alegreya Sans"']);
  await cmp.getByTestId("cmp-search").fill("");
  await expect(cmp.getByTestId("cmp-result").nth(5)).toBeVisible();
  await shoot(cmp, "app-compendium");
  // Keyboard (walkthrough step 4): each row is one Tab stop; focus on it shows the whole name.
  const rows = cmp.locator('[data-testid="cmp-results"] li > :is(button, div > button)');
  await rows.first().focus();
  for (let i = 1; i <= 4; i++) {
    await dm.keyboard.press("Tab");
    await expect(rows.nth(i)).toBeFocused();
  }
  const focusedName = (await rows.nth(4).getByTestId("cmp-result-name").textContent()) ?? "";
  await expect(dm.getByRole("tooltip").filter({ hasText: focusedName })).toBeVisible();
  await expect(cmp.locator('[data-testid="cmp-results"] [tabindex="0"]:not(button)')).toHaveCount(
    0,
  );

  // Party Manager: New pet… whole in its button.
  const board = await openWindow(dm, "party.board");
  const newPet = board.getByTestId("party-companion-new");
  await expect(newPet).toBeVisible();
  expect(await newPet.evaluate((b) => b.scrollWidth - b.clientWidth)).toBeLessThanOrEqual(0);
  await shoot(newPet, "app-new-pet");
  await dm.context().close();
});
