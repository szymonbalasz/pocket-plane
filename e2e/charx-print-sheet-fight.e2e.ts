// e2e-bundle: mid-combat
// CS walkthrough F1 (FR-CHARX-48 with the printed sheet): the DM's sheet of a locked PC in a
// started fight ("In combat" + "Locked" badges, Unlock / Edit) rendered "This window failed to
// render." (React #185): the full header was taller than the compact parts, so the pinned part
// flipped full ↔ compact for ever. Now it settles and the sheet renders.
import { expect, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { pickSheet } from "./support/sheet";
import { openWindow } from "./support/shell";

test("FR-CHARX-48 FR-CHARX-106 DM sheet of a locked PC in a started fight renders; the pinned part settles", async ({
  browser,
}) => {
  const { secret, recordId } = e2eEnv();
  const dm = await rolePage(browser);
  const errors: string[] = [];
  dm.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await dm.setViewportSize({ width: 1600, height: 900 });
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const win = await openWindow(dm, "char.sheet");
  await pickSheet(win, recordId("char-mira", "entity"));
  await expect(win.getByTestId("char-sheet-combat")).toBeVisible();
  await win.getByTestId("charx-lock-toggle").click();
  await expect(win.getByTestId("charx-locked")).toBeVisible();
  const header = win.getByTestId("charx-header");
  const part = await header.getAttribute("data-pinned-part");
  await dm.waitForTimeout(1_000);
  await expect(header).toHaveAttribute("data-pinned-part", part ?? "");
  await expect(win.getByTestId("ui-window-reload")).toHaveCount(0);
  await expect(win.getByTestId("charx-box").first()).toBeVisible();
  // Unlock again for the bundle's other specs (shared server).
  await win.getByTestId("charx-lock-toggle").click();
  await expect(win.getByTestId("charx-locked")).toHaveCount(0);
  expect(errors.filter((e) => e.includes("#185") || e.includes("Maximum update depth"))).toEqual(
    [],
  );
  await dm.context().close();
});
