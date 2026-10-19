// e2e-bundle: cmp-images
// Thin entry images flow (CMP §13.1 E2E, C5 UI): the DM makes a new item "E2E Lamp", uploads
// lantern.svg and pastes a PNG into the text (the control inside the form Dialog's portal; the
// text unchanged; the same PNG again → "Already in this entry"), moves the pasted one to Main,
// shares and saves; the DM's view shows main + 1 tile and the lightbox steps "1 / 2" → "2 / 2".
// Player-1 searches "lamp", opens it: the main image loads (`naturalWidth > 0`). Slot rules,
// dedupe, gallery states, the player's same markup: bun test (homebrew-images.test.tsx,
// gallery.test.tsx); leaks and refusals: the server's image tests.
import path from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { pasteInto } from "./support/clipboard";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

const LANTERN = path.join(import.meta.dirname, "..", "fixtures", "assets", "items", "lantern.svg");
const NAME = "E2E Lamp";
const TEXT = "A lamp that never goes out.";

async function live(page: Page) {
  await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
}

const tileIds = (form: Locator) =>
  form
    .getByTestId("cmp-form-image")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-record-id")));

async function mainLoaded(win: Locator) {
  const img = win.getByTestId("cmp-entry-image-main").locator("img");
  await expect(img).toHaveAttribute("data-state", "ready");
  await expect
    .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
}

test("FR-CMP-50 FR-CMP-51 FR-CMP-48 DM uploads and pastes images into a new shared item; player-1 sees its main image", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const win = await openWindow(dm, "cmp.compendium");

  await win.getByTestId("cmp-new").click();
  const form = dm.getByTestId("cmp-form");
  const control = form.locator('[data-testid="asset-attach"][data-owner="cmp-form"]');
  await expect(form.getByTestId("cmp-form-images")).toHaveAttribute("data-value", "0");
  await form.getByTestId("cmp-form-name").fill(NAME);
  await form.getByTestId("cmp-form-text").fill(TEXT);

  // Upload → tile 1, "Main".
  const chooser = dm.waitForEvent("filechooser");
  await control.getByTestId("asset-attach-upload").click();
  await (await chooser).setFiles(LANTERN);
  await expect(form.getByTestId("cmp-form-image")).toHaveCount(1);
  const [lantern] = await tileIds(form);

  // Paste a PNG into the text Textarea → tile 2; the text unchanged.
  expect(await pasteInto(form.getByTestId("cmp-form-text"), [{ png: "#3a6" }])).toBe(true);
  await expect(form.getByTestId("cmp-form-image")).toHaveCount(2);
  await expect(form.getByTestId("cmp-form-text")).toHaveValue(TEXT);
  const [, pasted] = await tileIds(form);
  expect(pasted).not.toBe(lantern);

  // The same PNG again → same id → "Already in this entry", still 2.
  await pasteInto(form.getByTestId("cmp-form-name"), [{ png: "#3a6" }]);
  await expect(form.getByTestId("cmp-form-image-dup")).toHaveText("Already in this entry");
  await expect(form.getByTestId("cmp-form-image")).toHaveCount(2);
  await expect(form.getByTestId("cmp-form-name")).toHaveValue(NAME);

  // Move the pasted one left → it is Main.
  await form
    .locator(`[data-testid="cmp-form-image"][data-record-id="${pasted}"]`)
    .getByTestId("cmp-form-image-left")
    .click();
  expect(await tileIds(form)).toEqual([pasted, lantern]);
  await expect(
    form
      .locator(`[data-testid="cmp-form-image"][data-value="1"]`)
      .getByTestId("cmp-form-image-main"),
  ).toBeVisible();

  await form.getByTestId("cmp-form-shared").click();
  await form.getByTestId("cmp-form-save").click();
  await expect(form).toHaveCount(0);

  // The DM's view: main + 1 tile; the lightbox steps and closes.
  const entry = win.getByTestId("cmp-entry");
  await expect(entry.getByTestId("cmp-entry-header")).toContainText(NAME);
  await expect(entry.getByTestId("cmp-entry-image-main")).toHaveAttribute(
    "data-record-id",
    pasted ?? "",
  );
  await expect(entry.getByTestId("cmp-entry-image")).toHaveAttribute(
    "data-record-id",
    lantern ?? "",
  );
  await mainLoaded(win);
  await entry.getByTestId("cmp-entry-image-main").click();
  const box = dm.getByTestId("cmp-lightbox");
  await expect(box.getByTestId("cmp-lightbox-count")).toHaveText("1 / 2");
  await box.getByTestId("cmp-lightbox-next").click();
  await expect(box.getByTestId("cmp-lightbox-count")).toHaveText("2 / 2");
  await expect(box.locator("img")).toHaveAttribute("src", `/api/assets/${lantern}/display`);
  await box.getByTestId("cmp-lightbox-next").click();
  await expect(box.getByTestId("cmp-lightbox-count")).toHaveText("1 / 2");
  await dm.keyboard.press("Escape");
  await expect(box).toHaveCount(0);

  // Player-1: search "lamp", open → the main image loads.
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);
  const pw = await openWindow(p1, "cmp.compendium");
  await pw.getByTestId("cmp-search").fill("lamp");
  await pw.getByTestId("cmp-result").filter({ hasText: NAME }).first().click();
  await expect(pw.getByTestId("cmp-entry-header")).toContainText(NAME);
  await expect(pw.getByTestId("cmp-entry-image-main")).toHaveAttribute(
    "data-record-id",
    pasted ?? "",
  );
  await mainLoaded(pw);
});
