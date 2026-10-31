// e2e-bundle: kit-library
// Full text (the DM's decision: an error message must be readable): the server refuses a pet's
// turn mode with a long message; it shows whole on its own line under the companion row, which
// grows, the name and the menu staying where they were. Markup: bun test (`RowError.test.tsx`).
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";
import { closeToasts } from "./support/toasts";

const MESSAGE =
  "The server refused this change because the pet was edited elsewhere a moment ago; reopen the row and try again.";
const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

test("full text: a companion row's error shows whole under the row, which grows; no sideways overflow", async ({
  browser,
}) => {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const board = await openWindow(dm, "party.board");
  await closeToasts(dm);
  await board.locator('[data-testid="party-tab"][data-value="status"]').click();
  const row = board.getByTestId("party-companion-row").first();
  await expect(row).toBeVisible();
  const before = await row.boundingBox();
  const name = await row.getByTestId("party-companion-name").boundingBox();

  await dm.route("**/api/**", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ code: "conflict", message: MESSAGE }),
        })
      : route.continue(),
  );
  await row.getByTestId("party-companion-menu").click();
  await dm.getByRole("menuitem", { name: "Turn mode" }).click();
  await dm.locator('[data-testid="party-companion-mode"][data-state="unchecked"]').first().click();
  await dm.keyboard.press("Escape");

  const alert = row.getByRole("alert");
  await expect(alert).toHaveText(MESSAGE);
  const shown = await alert.evaluate((e) => ({
    clipped: e.scrollWidth > e.clientWidth + 1,
    ellipsis: getComputedStyle(e).textOverflow === "ellipsis",
    title: e.getAttribute("title"),
  }));
  expect(shown).toEqual({ clipped: false, ellipsis: false, title: null });
  // The row grew; the message sits under the name line; the name and the menu kept their place.
  const after = await row.boundingBox();
  const box = await alert.boundingBox();
  const nameAfter = await row.getByTestId("party-companion-name").boundingBox();
  const menu = await row.getByTestId("party-companion-menu").boundingBox();
  expect(after?.height ?? 0).toBeGreaterThan((before?.height ?? 0) + 8);
  expect(box?.y ?? 0).toBeGreaterThanOrEqual((nameAfter?.y ?? 0) + (nameAfter?.height ?? 0) - 1);
  expect(nameAfter?.width).toBe(name?.width);
  expect((menu?.x ?? 0) + (menu?.width ?? 0)).toBeLessThanOrEqual(
    (after?.x ?? 0) + (after?.width ?? 0) + 1,
  );
  const body = board.getByTestId("ui-window-body");
  expect(await body.evaluate((b) => b.scrollWidth - b.clientWidth)).toBeLessThanOrEqual(0);
  await board.screenshot({ path: ".verify/sheet-full-text/companion-error.png" });
});
