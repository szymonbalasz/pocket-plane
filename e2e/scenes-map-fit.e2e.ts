// e2e-bundle: session-sim
// R1 map fit (MAP §13 step 12, FR-MAP-44/45, FR-SHELL-34), DM + player-1: Goblin Ambush opens
// with no token centre under a window at 1440×900 and 1280×720 (DM incl. hidden Wolf / Elite);
// a pan marks the camera moved, Fit refits; the player's Initiative appearing on Start refits.
// G2 (FR-MAP-46): cells never below 48 px; at the floor only the PCs (Mira, Thorn) must be clear.
// G3 (FR-MAP-47): a viewport resize refits while fitted, never once the camera moved.
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { konvaNodes } from "./support/konva";
import { showToPlayers } from "./support/scenes";
import { launcherButton, openWindow, shellWindow } from "./support/shell";

const WIDE = { width: 1440, height: 900 };
const LAPTOP = { width: 1280, height: 720 };

/** Tokens drawn (count) and those whose centre lies inside a rendered window. */
async function coverage(page: Page) {
  const tokens = await konvaNodes(page, "map-token");
  const shown = page.locator('[data-testid="ui-window"]:not([data-state="minimised"])');
  const wins = await shown.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    }),
  );
  const covered = tokens
    .filter((t) => wins.some((r) => t.x > r.x && t.x < r.x + r.w && t.y > r.y && t.y < r.y + r.h))
    .map((t) => t.id);
  return { count: tokens.length, covered };
}

/** Fitted, cells ≥ 48 px, and no token centre under a window (at the floor: no PC's). */
async function expectUncovered(page: Page, count: number, pcs: readonly string[]) {
  const canvas = page.getByTestId("map-canvas");
  await expect(canvas).toHaveAttribute("data-camera", "fitted");
  // FR-MAP-59 (#256): the 48 px floor yields down to 24 px only to keep every token visible ("all").
  const min = (await canvas.getAttribute("data-fit-visible")) === "all" ? 24 : 48;
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-cell-px")))
    .toBeGreaterThanOrEqual(min);
  await expect
    .poll(async () => {
      const { count: n, covered } = await coverage(page);
      const floor = (await canvas.getAttribute("data-fit-floor")) === "true";
      return { count: n, covered: floor ? covered.filter((id) => pcs.includes(id)) : covered };
    })
    .toEqual({ count, covered: [] });
}

/** Pan by dragging empty canvas just below the top bar (above the fitted content box). */
async function pan(page: Page) {
  const vp = page.viewportSize() ?? WIDE;
  const at = { x: vp.width / 2, y: 56 };
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x - 200, at.y + 150, { steps: 8 });
  await page.mouse.up();
}

test("FR-MAP-44 / -45 FR-SHELL-34 fit to the free area: open, reload, pan + Fit, Initiative appears (DM + player-1)", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const ambush = recordId("battlemap", "scene");
  const encounterId = recordId("encounter-1", "encounter");
  const pcs = [recordId("battlemap", "token"), recordId("thorn-battlemap", "token")];

  const dm = await rolePage(browser);
  await dm.setViewportSize(WIDE);
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  await expect(dm.getByTestId("map-tool-fit")).toBeVisible();
  const scenes = await openWindow(dm, "map.scenes");
  await scenes
    .locator(`[data-testid="map-scene-row"][data-record-id="${ambush}"] button`)
    .first()
    .click();
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  await showToPlayers(dm, "Goblin Ambush");
  await expect(dm.getByTestId("map-not-shown-badge")).toHaveCount(0);
  await shellWindow(dm, "map.scenes").getByTestId("ui-window-close").click();
  // P3 glitch 3: no encounter running → the empty Initiative opened minimised (launcher keeps it).
  await expect(launcherButton(dm, "cbt.initiative")).toHaveAttribute("data-state", "minimised");
  // Six tokens, the hidden Wolf and Elite included.
  await expectUncovered(dm, 6, pcs);

  const player = await rolePage(browser);
  await player.setViewportSize(WIDE);
  await player.goto(link("Player 1"));
  await expect(player.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  await expect(player.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  await expectUncovered(player, 4, pcs);

  // Pan away → moved; Fit → fitted, tokens uncovered again.
  await pan(player);
  await expect(player.getByTestId("map-canvas")).toHaveAttribute("data-camera", "moved");
  await player.getByTestId("map-tool-fit").click();
  await expectUncovered(player, 4, pcs);

  // G3 (FR-MAP-47): a resize to 1280×720 while fitted refits, no Fit click.
  for (const [page, count] of [
    [dm, 6],
    [player, 4],
  ] as const) {
    await page.setViewportSize(LAPTOP);
    await expectUncovered(page, count, pcs);
  }
  // A wheel zoom marks the camera moved: the resize back leaves it alone.
  await dm.mouse.move(400, 200);
  await dm.mouse.wheel(0, -100);
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-camera", "moved");
  const zoomed = await konvaNodes(dm, "map-token");
  await dm.setViewportSize(WIDE);
  await dm.waitForTimeout(600); // > the 200 ms settle
  expect(await konvaNodes(dm, "map-token")).toEqual(zoomed);
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-camera", "moved");

  // The same at 1280×720 after a reload.
  for (const page of [dm, player]) {
    await page.setViewportSize(LAPTOP);
    await page.reload();
    await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
    await expect(page.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  }
  await expectUncovered(dm, 6, pcs);
  await expectUncovered(player, 4, pcs);
  // P3 glitch 10: a cut map label ("Elite Goblin Wa…") shows the full name on hover.
  // With the wide Game log (FR-DICE-38) the 1280×720 fit keeps the PCs and the top row in the
  // strip right of the log, so the Elite may lie off-screen right (every token visible is FR-MAP-59,
  // W2): park the log (minimising never refits) and pan it into view for the hover.
  await shellWindow(dm, "dice.log").getByTestId("ui-window-minimise").click();
  const findCut = async () =>
    (await konvaNodes(dm, "map-token-label")).find((l) => l.text?.endsWith("…"));
  const first = await findCut();
  if (!first) throw new Error("no cut label at 1280×720");
  if (first.x > LAPTOP.width - 120) {
    await dm.mouse.move(640, 56);
    await dm.mouse.down();
    await dm.mouse.move(640 - (first.x - 900), 56, { steps: 8 });
    await dm.mouse.up();
  }
  const cut = await findCut();
  if (!cut) throw new Error("no cut label at 1280×720");
  await dm.mouse.move(cut.x, cut.y);
  const title = () =>
    dm.evaluate(() => {
      const K = (window as unknown as { Konva?: { stages: { container(): HTMLElement }[] } }).Konva;
      return K?.stages.find((st) => st.container().isConnected)?.container().title ?? null;
    });
  await expect.poll(title).toBe("Elite Goblin Warrior");
  await dm.mouse.move(5, 300);
  await expect.poll(title).toBe("");
  await openWindow(dm, "dice.log");
  await pan(dm);
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-camera", "moved");
  await dm.getByTestId("map-tool-fit").click();
  await expectUncovered(dm, 6, pcs);

  // Start: the player's Initiative appears (FR-SHELL-18) and, the camera still fitted, the map
  // refits around it (FR-MAP-44 (b)).
  const enc = await openWindow(dm, "cbt.encounters");
  await enc.locator(`[data-testid="cbt-enc-row"][data-record-id="${encounterId}"]`).click();
  await enc.getByTestId("cbt-enc-start").click();
  await dm.getByTestId("cbt-enc-start-confirm").click();
  // FR-CBT-60: the DM's own Start minimises Encounters once acked.
  await expect(launcherButton(dm, "cbt.encounters")).toHaveAttribute("data-state", "minimised");
  await expect(shellWindow(player, "cbt.initiative")).toBeVisible();
  await expectUncovered(player, 4, pcs);
});
