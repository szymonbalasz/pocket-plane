// e2e-bundle: assets-window-e2e
// Assets window (ASSET §13.3, FR-ASSET-67–70, #394): the launcher opens it; Images: the Town map
// shows "Used in: Town (scene map)", double-click previews it full size; Sounds: Chime shows its
// alerts and can't be deleted; an uploaded sound is renamed and deleted. Rules, uses and
// visibility: bun test (manage*.test.ts, assets-window.test.tsx).
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

async function live(page: Page) {
  await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
}

/** A silent 16-bit mono PCM WAV, `ms` long (a fresh upload, never the fixture's bytes). */
function silentWav(ms: number, rate = 8000): Buffer {
  const data = Math.round((rate * ms) / 1000) * 2;
  const b = Buffer.alloc(44 + data);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + data, 4);
  b.write("WAVE", 8);
  b.write("fmt ", 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(data, 40);
  return b;
}

test("FR-ASSET-69 FR-ASSET-70 FR-ASSET-67 Assets window: Images used-in and preview; Sounds: alerts shown, a picked sound refused, an upload renamed and deleted", async ({
  browser,
}) => {
  const { secret, recordId } = e2eEnv();
  const town = recordId("images", "asset", 0);
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1280, height: 720 });
  await loginDm(dm, secret);
  await live(dm);

  const win = await openWindow(dm, "asset.library");
  await expect(win.getByTestId("asset-picker")).toBeVisible();
  await expect(win.getByTestId("asset-picker-select")).toHaveCount(0);

  // Images: the Town map's uses, then a full-size preview on double-click.
  await win.getByTestId("asset-picker-search").fill("town");
  const tile = win.locator(`[data-testid="asset-picker-item"][data-record-id="${town}"]`);
  await tile.click();
  const used = win.getByTestId("asset-lib-used");
  await expect(used).toHaveAttribute("data-state", "ready");
  await expect(used).toContainText("Town (scene map)");
  await tile.dblclick();
  const preview = dm.getByTestId("asset-lib-preview");
  await expect(preview).toHaveAttribute("data-record-id", town);
  await expect(preview.locator('img[data-state="ready"]')).toBeVisible();
  await dm.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);

  // Sounds: Chime is picked for two alerts.
  await win.locator('[data-testid="asset-lib-tab"][data-value="sounds"]').click();
  const chime = win.getByTestId("asset-lib-sound").filter({ hasText: "Chime" });
  await expect(chime.getByTestId("asset-lib-sound-used")).toContainText("0.4 s · Alert:");
  await expect(chime.getByTestId("asset-lib-sound-used")).toContainText("Pause");
  await chime.getByTestId("asset-delete").click();
  const manage = dm.getByTestId("asset-manage-dialog");
  await manage.getByTestId("asset-manage-confirm").click();
  await expect(manage.getByTestId("asset-manage-error")).toContainText("Pause (alert sound)");
  await dm.keyboard.press("Escape");
  await expect(chime).toHaveCount(1);

  // Upload a sound → rename it → delete it.
  await win.getByTestId("asset-lib-sound-file").setInputFiles({
    name: "Bell.wav",
    mimeType: "audio/wav",
    buffer: silentWav(300),
  });
  const bell = win.getByTestId("asset-lib-sound").filter({ hasText: "Bell" });
  await expect(bell.getByTestId("asset-lib-sound-used")).toHaveText("0.3 s");
  await bell.getByTestId("asset-rename").click();
  await manage.getByTestId("asset-rename-name").fill("Door Bell");
  await manage.getByTestId("asset-manage-confirm").click();
  await expect(manage).toHaveCount(0);
  const doorBell = win.getByTestId("asset-lib-sound").filter({ hasText: "Door Bell" });
  await expect(doorBell).toHaveCount(1);
  await doorBell.getByTestId("asset-delete").click();
  await expect(manage.getByTestId("asset-delete-prompt")).toContainText("Delete Door Bell?");
  await manage.getByTestId("asset-manage-confirm").click();
  await expect(manage).toHaveCount(0);
  await expect(doorBell).toHaveCount(0);
  await expect(chime).toHaveCount(1);
});
