// e2e-bundle: h4-recap-e2e
// Sprint 10 H4 (BL-104, FR-RECAP-06): the DM's open Recap on the newest session refreshes ≤ 2 s
// after a live game-log line (sim-13 g measured 2.1 s). The fixture clock is months back, so the
// line starts a new session and the Recap moves to it (RC5).
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

test("FR-RECAP-06 BL-104 the DM's open Recap shows a live line's session ≤ 2 s after it", async ({
  browser,
}) => {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const log = await openWindow(dm, "dice.log");
  await dm.getByTestId("map-canvas").focus();
  await dm.keyboard.press("Control+k");
  await dm.keyboard.type("recap");
  await expect(
    dm.locator('[data-testid="ui-palette-item"][data-record-id="recap.open"]'),
  ).toBeVisible();
  await dm.keyboard.press("Enter");
  await expect(dm.getByTestId("recap-window")).toHaveAttribute("data-state", "ok");
  const fights = dm.locator('[data-testid="recap-fight"]');
  await expect(fights).toHaveCount(3);

  await log.getByTestId("dice-roll-expression").fill("1d20");
  const t0 = Date.now();
  await log.getByTestId("dice-roll-expression").press("Enter");
  await expect(fights).toHaveCount(0, { timeout: 5_000 });
  const took = Date.now() - t0;
  console.log(`recap live refresh: ${took} ms`);
  expect(took).toBeLessThanOrEqual(2_000);
});
