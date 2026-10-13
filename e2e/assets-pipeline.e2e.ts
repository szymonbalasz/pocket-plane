// Thin assets-pipeline flows (ASSET §13 E2E): DM uploads via the `asset.test` picker, the item
// appears selected and its thumbnail renders; an unknown asset ID answers 404; a picker hosted in
// a form (New scene) never submits it.
// Bundle: `bun run e2e` loads `sync-probe` (test mode on; no assets yet).
import path from "node:path";
import { expect, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

const MIRA = path.join(import.meta.dirname, "..", "fixtures", "assets", "tokens", "token-mira.svg");

test("FR-ASSET-17 FR-ASSET-19 DM uploads via the asset.test picker; item appears and is selected", async ({
  browser,
}) => {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const win = await openWindow(dm, "asset.test");
  const picker = win.getByTestId("asset-picker");
  await expect(picker).toBeVisible();

  await picker.getByTestId("asset-picker-file-input").setInputFiles(MIRA);
  const item = picker.getByTestId("asset-picker-item").filter({ hasText: "token-mira" });
  await expect(item).toHaveCount(1);
  await expect(item).toHaveAttribute("aria-pressed", "true");
  await expect(item.locator("img[data-state=ready]")).toBeVisible();
  const id = await item.getAttribute("data-record-id");
  expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);

  const thumb = await dm.request.get(`/api/assets/${id}/thumb`);
  expect(thumb.status()).toBe(200);
  expect(thumb.headers()["content-type"]).toBe("image/webp");

  // Same file again → "Already uploaded", still one item.
  await picker.getByTestId("asset-picker-file-input").setInputFiles(MIRA);
  await expect(dm.getByText("Already uploaded")).toBeVisible();
  await expect(picker.getByTestId("asset-picker-item")).toHaveCount(1);

  await picker.getByTestId("asset-picker-select").click();
  await expect(win.getByTestId("asset-test-selected")).toHaveText("token-mira");
});

test("FR-ASSET-17 picker in the New scene form: Upload and Use as map don't submit it", async ({
  browser,
}) => {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const scenes = await openWindow(dm, "map.scenes");
  await scenes.getByTestId("map-scene-new").click();
  const dialog = dm.getByRole("dialog", { name: "New scene" });
  const picker = dialog.getByTestId("asset-picker");
  const chooser = dm.waitForEvent("filechooser");
  await picker.getByTestId("asset-picker-upload").click();
  await (await chooser).setFiles(MIRA);
  const item = picker.getByTestId("asset-picker-item").filter({ hasText: "token-mira" });
  await expect(item).toHaveAttribute("aria-pressed", "true");

  // Name left empty: a submit would show "Name is required" (and, named, create the scene).
  await picker.getByTestId("asset-picker-select").click();
  await expect(dialog.getByText("none chosen")).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("map-scene-new-error")).toHaveCount(0);
  // Cancel: later sync-probe specs expect no scenes.
  await dm.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(scenes.getByTestId("map-scene-row")).toHaveCount(0);
});

test("FR-ASSET-13 unknown asset ID → 404", async ({ browser }) => {
  const page = await rolePage(browser);
  const res = await page.request.get("/api/assets/ZZZZZZZZZZZZZZZZZZZZZZ/display");
  expect(res.status()).toBe(404);
  expect(await res.json()).toEqual({ code: "not_found", message: "Not found" });
});
