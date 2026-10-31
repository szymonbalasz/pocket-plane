// e2e-bundle: party-board
// Full text (the DM's decision: an error message must be readable): a handout row's error shows
// whole on its own line and the row grows. Handout actions are WS intents that the server rarely
// refuses, so this places the same element `RowError` draws into a real row and measures the built
// CSS. That it is the element the menu renders: bun test (`RowError.test.tsx`).
import { expect, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

const MESSAGE =
  "The server refused this change because the handout was edited elsewhere a moment ago; reopen it and try again.";

test("full text: a handout row's error shows whole under the row, which grows; the menu stays put", async ({
  browser,
}) => {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const board = await openWindow(dm, "party.board");
  await board.locator('[data-testid="party-tab"][data-value="handouts"]').click();
  const row = board.getByTestId("party-handout-row").first();
  await expect(row).toBeVisible();
  const before = await row.boundingBox();
  const menuBefore = await row.getByTestId("party-handout-menu").boundingBox();

  await row.evaluate((li, text) => {
    const e = document.createElement("span");
    e.setAttribute("role", "alert");
    e.dataset.slot = "party-row-error";
    e.className = "order-last w-full basis-full break-words text-xs text-destructive";
    e.textContent = text;
    li.insertBefore(e, li.lastElementChild);
  }, MESSAGE);

  const alert = row.getByRole("alert");
  await expect(alert).toHaveText(MESSAGE);
  const after = await row.boundingBox();
  const box = await alert.boundingBox();
  const menu = await row.getByTestId("party-handout-menu").boundingBox();
  expect(after?.height ?? 0).toBeGreaterThan((before?.height ?? 0) + 8);
  expect(box?.y ?? 0).toBeGreaterThanOrEqual((menu?.y ?? 0) + (menu?.height ?? 0) - 1);
  expect(menu?.x).toBe(menuBefore?.x);
  expect(await alert.evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(0);
});
