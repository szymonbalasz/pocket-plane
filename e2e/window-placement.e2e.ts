// e2e-bundle: party-board
// Thin sprint-4 window placement flows (SHELL §13 sprint 4 E2E): the handout viewer doesn't come
// back after a reload (FR-SHELL-42); the DM launcher fits 1280×720 and overflows into "⋯" when
// narrower (FR-SHELL-43). Placement scoring, keep-out and feature opens: bun test (placement,
// manager, windows tests). (`map-tools` isn't built yet; any bundle serves the launcher check.)
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow, shellWindow } from "./support/shell";

async function live(page: Page) {
  await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
}

test("FR-SHELL-42 player-1 opens a handout, reloads → no viewer window, Party restored; reopening shows the viewer at its last geometry", async ({
  browser,
}) => {
  const { link, recordId } = e2eEnv();
  const mayor = recordId("handouts-1", "handout", 0);
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1280, height: 800 });
  await p1.goto(link("Player 1"));
  await live(p1);

  const board = await openWindow(p1, "party.board");
  const row = board.locator(`[data-testid="party-handout-row"][data-record-id="${mayor}"]`);
  await row.locator("button").first().click();
  const viewer = shellWindow(p1, "party.handout");
  await expect(viewer.getByTestId("party-handout-view")).toHaveAttribute("data-record-id", mayor);
  const before = await viewer.boundingBox();
  // The 640-wide viewer finds no clear spot beside Party at 1280×800: Party is auto-minimised to
  // make room (FR-SHELL-47) and comes back from the launcher; at its useful size it then
  // auto-minimises the viewer, the least recently used (sprint 7, FR-SHELL-77, -78).
  const boardState = await board.getAttribute("data-state");
  if (boardState === "minimised") await openWindow(p1, "party.board");
  const boardBox = await board.boundingBox();
  if ((await viewer.getAttribute("data-state")) === "minimised") {
    await expect(viewer).toHaveAttribute("data-auto-minimised-for", "party.board");
  } else {
    await expect(viewer).toBeVisible();
  }

  await p1.reload();
  await live(p1);
  await expect(shellWindow(p1, "party.board")).toBeVisible();
  expect(await shellWindow(p1, "party.board").boundingBox()).toEqual(boardBox);
  await expect(shellWindow(p1, "party.handout")).toHaveCount(0);

  await shellWindow(p1, "party.board")
    .locator(`[data-testid="party-handout-row"][data-record-id="${mayor}"] button`)
    .first()
    .click();
  await expect(viewer).toBeVisible();
  expect(await viewer.boundingBox()).toEqual(before);
});

test("FR-SHELL-43 DM at 1280×720: no launcher button outside the viewport; narrower → icon only, then the ⋯ menu holds the rest", async ({
  browser,
}) => {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1280, height: 720 });
  await loginDm(dm, secret);
  await live(dm);

  const launcher = dm.getByTestId("ui-launcher");
  // Polled: after a resize the bar re-fits over a frame or two (compact first, then overflow).
  const inside = (width: number) =>
    expect
      .poll(async () => {
        const bar = await launcher.boundingBox();
        if (!(bar && bar.x >= 8 && bar.x + bar.width <= width - 8)) return "bar outside";
        for (const b of await dm.getByTestId("ui-launcher-button").all()) {
          const r = await b.boundingBox();
          if (!(r && r.x >= 0 && r.x + r.width <= width)) return "button outside";
        }
        return "ok";
      })
      .toBe("ok");
  await inside(1280);
  await expect(dm.getByTestId("ui-launcher-overflow")).toHaveAttribute("data-count", "0");

  // Narrow: icon only, some buttons in the menu.
  await dm.setViewportSize({ width: 480, height: 720 });
  await expect(launcher).toHaveAttribute("data-compact", "true");
  await inside(480);
  const overflow = dm.getByTestId("ui-launcher-overflow");
  const count = Number(await overflow.getAttribute("data-count"));
  expect(count).toBeGreaterThan(0);
  await dm.getByTestId("ui-launcher-menu").click();
  const items = dm.getByTestId("ui-launcher-overflow-item");
  await expect(items).toHaveCount(count);
  const first = items.first();
  const kind = await first.getAttribute("data-record-id");
  await first.click();
  await expect(shellWindow(dm, kind ?? "")).toBeVisible();
  // Still in the menu until the next resize (FR-SHELL-43), now marked open.
  await dm.getByTestId("ui-launcher-menu").click();
  await expect(
    dm.locator(`[data-testid="ui-launcher-overflow-item"][data-record-id="${kind}"]`),
  ).toHaveAttribute("data-state", "open");
  await dm.keyboard.press("Escape");

  // Wide again: labels back, menu empty.
  await dm.setViewportSize({ width: 1600, height: 900 });
  await expect(launcher).toHaveAttribute("data-compact", "false");
  await expect(overflow).toHaveAttribute("data-count", "0");
});
