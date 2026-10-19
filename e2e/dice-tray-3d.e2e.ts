// e2e-bundle: dice-polish
// The tray preview (D10; FR-DICEX-48, DICEX §13 walkthrough 29). B (player-1, Crimson metal)
// composes d6, d6, d8 + 1: the tray shows three dice (3D stills in its own 2D canvas, or chips
// without WebGL), never the "d6" text badge. Game log dragged over the tray covers the dice: the
// log wins `elementFromPoint` at a die's centre and no Crimson pixel shows there (a still left on
// the topmost dice layer would float above the log). Clicking a d6 removes one.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, rolePage } from "./support/env";
import { openWindow, shellWindow } from "./support/shell";

// Headless Chromium has WebGL only through SwiftShader, which Chrome gates behind a flag.
test.use({ launchOptions: { args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] } });

const hasWebgl = (page: Page) =>
  page.evaluate(() => {
    const c = document.createElement("canvas");
    return (c.getContext("webgl2") ?? c.getContext("webgl")) !== null;
  });

async function centre(el: Locator) {
  const b = await el.boundingBox();
  if (!b) throw new Error("no box");
  return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
}

/** Pixels of the composited page (dice layer included) in a 12 px square at `at` that read as Crimson's body. */
async function crimsonPixels(page: Page, at: { x: number; y: number }): Promise<number> {
  const png = await page.screenshot({ clip: { x: at.x - 6, y: at.y - 6, width: 12, height: 12 } });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d") as CanvasRenderingContext2D;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const [r, g, b] = [d[i] ?? 0, d[i + 1] ?? 0, d[i + 2] ?? 0];
      if (r > 70 && r > 2 * g && r > 2 * b) n++;
    }
    return n;
  }, png.toString("base64"));
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

test("FR-DICEX-48 tray preview: the staged dice drawn in the tray, covered by a window over it", async ({
  browser,
}) => {
  const p1 = await rolePage(browser);
  await p1.goto(e2eEnv().link("Player 1"));
  await expect(p1.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const webgl = await hasWebgl(p1);
  if (webgl) {
    await expect(p1.getByTestId("dicex-screen")).toHaveAttribute("data-chunk", "ready", {
      timeout: 10_000,
    });
  }

  // B: palette d6, d6, d8; constant 1.
  const tray = await openWindow(p1, "dicex.tray");
  for (const f of [6, 6, 8]) {
    await tray.locator(`[data-testid="dicex-tray-palette"][data-value="${f}"]`).click();
  }
  await tray.getByTestId("dicex-tray-constant").fill("1");
  const preview = tray.getByTestId("dicex-tray-preview");
  await expect(preview).toHaveAttribute("data-mode", webgl ? "3d" : "chips");
  const dice = tray.getByTestId("dicex-tray-die");
  await expect(dice).toHaveCount(3);
  await expect(dice.nth(0)).toHaveAttribute("data-faces", "6");
  await expect(dice.nth(0)).toHaveAttribute("data-value", "6");
  await expect(dice.nth(2)).toHaveAttribute("data-faces", "8");
  await expect(dice.nth(2)).toHaveAttribute("data-value", "8");
  for (let i = 0; i < 3; i++) await expect(dice.nth(i)).not.toContainText(/d\d/);
  await expect(tray).toContainText("+1");

  // The dice show in the owner's look at the die's centre (the tray's own canvas, or the chip).
  const at = await centre(dice.nth(0));
  await expect.poll(() => crimsonPixels(p1, at), { timeout: 5_000 }).toBeGreaterThan(0);
  if (webgl) {
    const painted = await preview.evaluate((c: HTMLCanvasElement, p) => {
      const o = c.getBoundingClientRect();
      const k = c.width / Math.max(1, c.clientWidth);
      const px = c
        .getContext("2d")
        ?.getImageData(Math.round((p.x - o.left) * k), Math.round((p.y - o.top) * k), 1, 1).data;
      return px?.[3] ?? 0;
    }, at);
    expect(painted).toBeGreaterThan(0);
  }

  // Drag Game log over the tray: the log covers the dice (they keep the window's z-order).
  const log = await openWindow(p1, "dice.log");
  const title = log.getByTestId("ui-window-title");
  const t = await title.boundingBox();
  if (!t) throw new Error("no title");
  const grab = { x: t.x + 40, y: t.y + t.height / 2 };
  await drag(p1, grab, { x: at.x - 60 + 40, y: at.y - 60 + t.height / 2 });
  const top = await p1.evaluate(
    (p) =>
      document
        .elementFromPoint(p.x, p.y)
        ?.closest('[data-testid="ui-window"]')
        ?.getAttribute("data-record-id") ?? null,
    at,
  );
  expect(top).toBe("dice.log:main");
  expect(await crimsonPixels(p1, at)).toBe(0);

  // Close the log; click a d6 → one d6 left; add it back.
  await log.getByTestId("ui-window-close").click();
  await expect(shellWindow(p1, "dice.log")).toHaveCount(0);
  await dice.nth(0).click();
  await expect(dice).toHaveCount(2);
  await expect(tray.locator('[data-testid="dicex-tray-die"][data-faces="6"]')).toHaveCount(1);
  await tray.locator('[data-testid="dicex-tray-palette"][data-value="6"]').click();
  await expect(tray.locator('[data-testid="dicex-tray-die"][data-faces="6"]')).toHaveCount(2);
  await expect(tray.getByTestId("dicex-tray-expression")).toHaveValue("2d6+1d8+1");
  await expect(preview).toHaveAttribute("data-mode", webgl ? "3d" : "chips");
});
