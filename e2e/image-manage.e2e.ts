// e2e-bundle: image-manage-e2e
// Rename / delete an image (ASSET §13.1 E2E, FR-ASSET-62–66, #386): in the New scene picker,
// rename Misc Sketch, delete it (the tile goes), and try to delete the Town map: refused, the
// reject names the scene. Rules and every kind of use: bun test (manage*.test.ts).
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

async function live(page: Page) {
  await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
}

test("FR-ASSET-66 FR-ASSET-62 FR-ASSET-63 FR-ASSET-64 rename and delete an unused image; an image in use is refused with its uses named", async ({
  browser,
}) => {
  const { secret, recordId } = e2eEnv();
  const misc = recordId("image-tags", "asset", 23);
  const town = recordId("images", "asset", 0);
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1280, height: 720 });
  await loginDm(dm, secret);
  await live(dm);

  const scenes = await openWindow(dm, "map.scenes");
  await scenes.getByTestId("map-scene-new").click();
  const dialog = dm.getByRole("dialog", { name: "New scene" });
  const picker = dialog.getByTestId("asset-picker");
  const item = (id: string) =>
    picker.locator(`[data-testid="asset-picker-item"][data-record-id="${id}"]`);

  // Rename Misc Sketch → Old Sketch: the tile and the selected line show it.
  await picker.getByTestId("asset-picker-search").fill("misc");
  await item(misc).click();
  await picker.locator(`[data-testid="asset-rename"][data-record-id="${misc}"]`).click();
  const manage = dm.getByTestId("asset-manage-dialog");
  await manage.getByTestId("asset-rename-name").fill("Old Sketch");
  await manage.getByTestId("asset-manage-confirm").click();
  await expect(manage).toHaveCount(0);
  await expect(picker.getByTestId("asset-picker-selected")).toHaveText("Old Sketch");
  await picker.getByTestId("asset-picker-search").fill("old sketch");
  await expect(item(misc)).toContainText("Old Sketch");

  // Delete it: prompt names it; the tile goes; New scene wasn't submitted.
  await picker.locator(`[data-testid="asset-delete"][data-record-id="${misc}"]`).click();
  await expect(manage.getByTestId("asset-delete-prompt")).toHaveText(
    "Delete Old Sketch? Its links stop working. This can't be undone.",
  );
  await manage.getByTestId("asset-manage-confirm").click();
  await expect(manage).toHaveCount(0);
  await expect(item(misc)).toHaveCount(0);
  await expect(picker.getByTestId("asset-tags-editor")).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("map-scene-new-error")).toHaveCount(0);

  // The Town map is in use: refused, the scene named, the image kept.
  await picker.getByTestId("asset-picker-search").fill("town");
  await item(town).click();
  await picker.locator(`[data-testid="asset-delete"][data-record-id="${town}"]`).click();
  await manage.getByTestId("asset-manage-confirm").click();
  await expect(manage.getByTestId("asset-manage-error")).toContainText("Town (scene map)");
  await dm.keyboard.press("Escape");
  await expect(manage).toHaveCount(0);
  await expect(item(town)).toHaveCount(1);
});
