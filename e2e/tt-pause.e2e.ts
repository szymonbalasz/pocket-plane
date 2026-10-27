// e2e-bundle: table-tools-paused-e2e
// Pause screen (dice-extras §13 T9, T10, T11, T12, T17; FR-SHELL-125–129, -136; FR-CAMP-47): the
// bundle loads paused. Player 1 sees the card from the snapshot, input blocked behind it (Space,
// arrows, Escape, Tab, wheel); a reload keeps it. The DM previews the card in a non-blocking
// Dialog (Escape, ✕; windows stay usable), resumes (the card goes, input works) and pauses again
// from the Popover (the card + the `pause` sound, Chime).
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { pickSelect } from "./support/select";
import { openWindow } from "./support/shell";

/** Is `testId`'s element under an `inert` ancestor (the block of FR-SHELL-112 (2))? */
const inert = (page: Page, testId: string) =>
  page
    .getByTestId(testId)
    .first()
    .evaluate((el) => el.closest("[inert]") !== null);

test("FR-SHELL-125 FR-SHELL-128 FR-SHELL-129 FR-SHELL-136 FR-DICEX-90 pause card blocks input, survives reload; DM preview, resume, pause again", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const { secret, link, recordId } = e2eEnv();
  const mira = recordId("char-mira", "entity");
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const control = dm.getByTestId("ui-pause-open");
  await expect(control).toHaveAttribute("data-state", "paused");
  await expect(control).toContainText("Paused");
  // The DM is never blocked: no card, nothing inert.
  await expect(dm.getByTestId("ui-pause")).toHaveCount(0);

  const player = await rolePage(browser);
  await player.setViewportSize({ width: 1280, height: 720 });
  await player.goto(link("Player 1"));
  const card = player.getByTestId("ui-pause");
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-state", "paused");
  await expect(player.getByTestId("ui-pause-message")).toHaveText("Pizza break, back soon");
  await expect(player.getByTestId("ui-pause-image")).toBeVisible();
  await expect(player.getByTestId("ui-pause-countdown")).toHaveText(/^Back (in \d+:\d\d|soon)$/);
  await expect(player.getByTestId("ui-overlay-layer")).toHaveAttribute("data-blocking", "pause");
  // FR-SHELL-127: the handout present popup (handout-present-1) waits for resume, not over the card.
  await player.waitForTimeout(1000);
  await expect(player.getByTestId("party-present-popup")).toHaveCount(0);

  // T9: nothing behind the card takes input. Focus is in the card; Tab cycles inside it.
  const canvas = player.getByTestId("map-canvas");
  await expect(canvas).toBeAttached();
  expect(await inert(player, "ui-topbar")).toBe(true);
  expect(await inert(player, "map-canvas")).toBe(true);
  const camera = await canvas.getAttribute("data-camera");
  for (const key of ["Tab", "Tab", "Tab", "Escape", "ArrowLeft", "ArrowUp"]) {
    await player.keyboard.press(key);
    expect(
      await player.evaluate(
        () => document.activeElement?.closest('[data-testid="ui-pause"]') !== null,
      ),
    ).toBe(true);
  }
  await player.keyboard.down("Space");
  await expect(canvas).toHaveAttribute("data-space-pan", "false");
  await player.keyboard.up("Space");
  await player.mouse.move(640, 400);
  await player.mouse.wheel(0, -240);
  await player.mouse.click(640, 400);
  await expect(canvas).toHaveAttribute("data-camera", camera ?? "fitted");
  // The card covers the page: the top of the stack at the centre is the card.
  expect(
    await player.evaluate(
      () => document.elementFromPoint(640, 360)?.closest('[data-testid="ui-pause"]') !== null,
    ),
  ).toBe(true);

  // Space on the focused mute toggle presses it (the card's one control): leave it unmuted.
  const mute = player.getByTestId("ui-pause-mute");
  if ((await mute.getAttribute("data-state")) === "muted") await mute.click();
  await expect(mute).toHaveAttribute("data-state", "on");

  // FR-SHELL-136: a reload shows the card again, from the snapshot.
  await player.reload();
  await expect(player.getByTestId("ui-pause")).toBeVisible();
  await expect(player.getByTestId("ui-pause-message")).toHaveText("Pizza break, back soon");

  // T17: Preview = the card in a non-blocking Dialog; Escape, then ✕ close it; windows usable.
  await control.click();
  await expect(dm.getByTestId("ui-pause-form")).toBeVisible();
  await dm.getByTestId("ui-pause-preview").click();
  const preview = dm.getByTestId("ui-pause-preview-dialog");
  await expect(preview).toBeVisible();
  await expect(preview.getByTestId("ui-pause-message")).toHaveText("Pizza break, back soon");
  await dm.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
  await control.click();
  await dm.getByTestId("ui-pause-preview").click();
  await expect(preview).toBeVisible();
  await openWindow(dm, "camp.players");
  await expect(preview).toBeVisible();
  await dm.getByTestId("ui-pause-preview-close").click();
  await expect(preview).toHaveCount(0);

  // T12: Resume → the card goes; input works again.
  await control.click();
  await dm.getByTestId("ui-pause-resume").click();
  await expect(control).toHaveAttribute("data-state", "running");
  await expect(control).toHaveText("Pause");
  await expect(player.getByTestId("ui-pause")).toHaveCount(0);
  await expect(player.getByTestId("ui-overlay-layer")).not.toHaveAttribute("data-blocking", /.*/);
  expect(await inert(player, "ui-topbar")).toBe(false);
  // The deferred present popup shows at resume; closing it hands the page back.
  await expect(player.getByTestId("party-present-popup")).toBeVisible();
  await player.getByTestId("party-present-close").click();
  await expect(player.getByTestId("party-present-popup")).toHaveCount(0);
  await player.getByTestId("ui-topbar").click(); // the first interaction unlocks audio

  // A Radix Popover opened before the pause (the tray's dice settings, portalled to the body):
  // the card covers it and it can't be clicked while paused.
  const tray = await openWindow(player, "dicex.tray");
  await tray.getByTestId("dicex-settings-open").click();
  const display = (v: string) =>
    player.locator(`[data-testid="dicex-settings-display"][data-value="${v}"]`).first();
  const before = await display("flat").getAttribute("data-state");
  const flat = await display("flat").boundingBox();
  if (!flat) throw new Error("no dice settings popover");
  const flatAt = { x: flat.x + flat.width / 2, y: flat.y + flat.height / 2 };

  // T9: Pause from the Popover (message, back in 5 min) → the card and the `pause` sound (Chime).
  await control.click();
  await dm.getByTestId("ui-pause-message-input").fill("Snacks");
  await dm.locator('[data-testid="ui-pause-back-in-item"][data-value="5"]').click();
  await dm.getByTestId("ui-pause-submit").click();
  await expect(control).toHaveAttribute("data-state", "paused");
  await expect(player.getByTestId("ui-pause-message")).toHaveText("Snacks");
  await expect(player.getByTestId("ui-pause-countdown")).toHaveText(/^Back in [45]:\d\d$/);
  await expect(player.getByTestId("ui-topbar")).toHaveAttribute(
    "data-test-last-sound",
    /^pause:(played|fallback):\d+$/,
  );
  // The popover is gone or inert, under the card: a click at its option reaches the card only.
  expect(
    await player.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid="ui-pause"]') !== null,
      flatAt,
    ),
  ).toBe(true);
  expect(
    await player.evaluate(() =>
      [...document.querySelectorAll('[data-testid="dicex-settings-display"]')].every(
        (el) => el.closest("[inert]") !== null,
      ),
    ),
  ).toBe(true);
  await player.mouse.click(flatAt.x, flatAt.y);

  // T10 (FR-DICEX-90): a public 1d20 request to Mira while paused → B: no sound; the prompt
  // waits under the card (inert), nothing over it.
  const topbar = player.getByTestId("ui-topbar");
  const soundBefore = (await topbar.getAttribute("data-test-last-sound")) ?? "";
  const requests = await openWindow(dm, "dicex.requests");
  const fold = requests.getByTestId("dicex-request-fold");
  if ((await fold.getAttribute("data-state")) !== "open") await fold.click();
  await pickSelect(requests, "dicex-request-roll", { value: "custom" });
  await requests.getByTestId("dicex-request-expression").fill("1d20");
  await requests.getByTestId("dicex-request-label").fill("Paused check");
  await requests.locator(`[data-testid="dicex-request-target"][data-record-id="${mira}"]`).click();
  const results = requests.getByTestId("dicex-request-results");
  if ((await results.getAttribute("data-state")) !== "public") await results.click();
  await requests.getByTestId("dicex-request-send").click();
  const pausedPrompt = player
    .locator('[data-testid="note-toast"][data-class="card"]')
    .filter({ hasText: "Paused check" });
  await expect(pausedPrompt).toHaveCount(1);
  expect(await pausedPrompt.evaluate((el) => el.closest("[inert]") !== null)).toBe(true);
  await player.waitForTimeout(500);
  await expect(topbar).toHaveAttribute("data-test-last-sound", soundBefore);
  await expect(card).toBeVisible();

  // The draft is kept for the next pause (DM browser only).
  await dm.keyboard.press("Escape");
  await control.click();
  await expect(dm.getByTestId("ui-pause-message-input")).toHaveValue("Snacks");
  await dm.getByTestId("ui-pause-resume").click();
  await expect(player.getByTestId("ui-pause")).toHaveCount(0);
  // T12: at resume the prompt is there and exactly one sound plays: `request` (no turn).
  const n = Number(soundBefore.split(":")[2] ?? "0") + 1;
  await expect(topbar).toHaveAttribute(
    "data-test-last-sound",
    new RegExp(`^request:(played|fallback):${n}$`),
  );
  await expect(pausedPrompt).toBeVisible();
  await player.waitForTimeout(500);
  await expect(topbar).toHaveAttribute("data-test-last-sound", new RegExp(`:${n}$`));
  // Nothing behind the card changed: the dice display is as before the pause.
  if (!(await display("flat").isVisible())) await tray.getByTestId("dicex-settings-open").click();
  await expect(display("flat")).toHaveAttribute("data-state", before ?? "off");

  await player.context().close();
  await dm.context().close();
});
