// e2e-bundle: prefs-s6-e2e
// Thin Preferences flows (SHELL FR-SHELL-70–74, CAMP FR-CAMP-35 Account; §13 PF P1, P2, P11,
// P12), DM + player-1 in separate contexts: the identity chip in the colour of each viewer opens
// Preferences; a minimised Preferences is restored by the chip; Reset layout closes it; the DM's
// Log out lives in the Account section, not the top bar.
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { shellWindow } from "./support/shell";

const sectionIds = (page: Page) =>
  page
    .getByTestId("ui-prefs-section")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-record-id")));

test("FR-SHELL-70/71/72/74 chip opens Preferences; minimised → restored by the chip; Reset layout closes it (player-1)", async ({
  browser,
}) => {
  const { link } = e2eEnv();
  const p = await rolePage(browser);
  await p.goto(link("Player 1"));
  const chip = p.getByTestId("ui-prefs-open");
  await expect(chip).toContainText("Player 1");
  await expect(p.getByTestId("ui-prefs-chip-dot")).toHaveAttribute("data-color", "#19b98a");
  await expect(chip).toHaveAttribute("data-state", "closed");
  await expect(p.getByTestId("ui-sound-button")).toHaveCount(0);
  const bar = await p.getByTestId("ui-topbar").boundingBox();
  expect(bar?.height).toBe(48);

  await chip.click();
  const prefs = shellWindow(p, "shell.prefs");
  await expect(prefs.getByTestId("ui-prefs-window")).toBeVisible();
  await expect(chip).toHaveAttribute("data-state", "open");
  expect(await sectionIds(p)).toEqual(["camp.color", "shell.sound", "dicex.dice", "shell.layout"]);

  // Minimised from its title bar: no launcher button, so the chip restores it (rulings-b 27).
  const before = await prefs.boundingBox();
  await prefs.getByTestId("ui-window-minimise").click();
  await expect(chip).toHaveAttribute("data-state", "minimised");
  await chip.click();
  await expect(chip).toHaveAttribute("data-state", "open");
  expect(await prefs.boundingBox()).toEqual(before);

  await p.getByTestId("ui-prefs-reset-layout").click();
  await expect(chip).toHaveAttribute("data-state", "closed");
  await expect(prefs).toHaveCount(0);
  await expect(shellWindow(p, "char.sheet")).toBeVisible(); // the default layout
});

test("FR-SHELL-70/72, FR-CAMP-35 DM chip and Account: no Log out in the top bar; Log out from Preferences; log in again", async ({
  browser,
}) => {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  const chip = dm.getByTestId("ui-prefs-open");
  await expect(chip).toContainText("DM");
  await expect(dm.getByTestId("ui-prefs-chip-dot")).toHaveAttribute("data-color", "#e69f00");
  await expect(dm.getByTestId("ui-topbar").getByTestId("camp-logout")).toHaveCount(0);

  await chip.click();
  await expect(dm.getByTestId("ui-prefs-window")).toBeVisible();
  expect(await sectionIds(dm)).toEqual([
    "camp.color",
    "dicex.dice",
    "shell.layout",
    "camp.account",
  ]);
  await dm.getByTestId("camp-logout").click();
  await expect(dm.getByTestId("camp-login-secret")).toBeVisible();

  await loginDm(dm, secret);
  await expect(dm.getByTestId("ui-prefs-open")).toBeVisible();
  await expect(dm.getByTestId("ui-prefs-open")).toHaveAttribute("data-state", "closed");
});
