// e2e-bundle: player-colours
// Thin colour picker (CAMP FR-CAMP-27; §13 K1, K2, K10, K11), DM + player-1 + player-2 in separate
// contexts. K1: the DM's Players panel shows DM amber, Player 1 jade, Player 2 blue; the players'
// header dots jade / blue. K2: player-1 opens the header Popover, blue "taken by Player 2" and
// amber "taken by DM" are disabled, a click on rose recolours the DM's row swatch and the dot.
// K10: the DM's Player 2 Popover has rose taken by Player 1; the DM picks yellow for themself.
// K11: player-1's socket is held down → swatches disabled; back live → a pick works.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

const swatch = (page: Page, key: string) =>
  page
    .getByTestId("camp-color-popover")
    .locator(`[data-testid="camp-color-swatch"][data-value="${key}"]`);

/** Hover a swatch's Tooltip wrapper (a disabled swatch takes no pointer events) → its Tooltip. */
async function tooltipOf(page: Page, key: string, text: string): Promise<Locator> {
  await swatch(page, key).locator("..").hover();
  return page.getByTestId("ui-tooltip").filter({ hasText: text });
}

test("FR-CAMP-27 picker: player header dot and DM Players panel swatches (K1, K2, K10, K11)", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const p1Id = recordId("player-1", "player");
  const p2Id = recordId("player-2", "player");

  const dm = await rolePage(browser);
  const errors: string[] = [];
  dm.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const panel = await openWindow(dm, "camp.players");
  const dmSwatch = panel.getByTestId("camp-color-dm");
  const rowSwatch = (id: string) =>
    panel.locator(`[data-testid="camp-player-color"][data-record-id="${id}"]`);

  // player-1's socket goes through a route that can hold it down (K11).
  const p1 = await rolePage(browser);
  let hold = false;
  const sockets: { close(): Promise<void> }[] = [];
  await p1.routeWebSocket(/\/ws/, (ws) => {
    if (hold) {
      // Held: the page's socket opens but nothing answers, so the client stays not live.
      sockets.push({ close: () => ws.close({ code: 4000, reason: "held" }) });
      return;
    }
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => ws.send(m));
    sockets.push({
      close: async () => {
        await ws.close({ code: 4000, reason: "cut" });
        await server.close();
      },
    });
  });
  await p1.goto(link("Player 1"));
  const p1Status = p1.getByTestId("sync-connection-status");
  await expect(p1Status).toHaveAttribute("data-state", "live");
  const p2 = await rolePage(browser);
  await p2.goto(link("Player 2"));
  await expect(p2.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

  // K1: DM amber, Player 1 jade, Player 2 blue; header dots jade / blue.
  await expect(dmSwatch).toHaveAttribute("data-value", "amber");
  await expect(rowSwatch(p1Id)).toHaveAttribute("data-value", "jade");
  await expect(rowSwatch(p2Id)).toHaveAttribute("data-value", "blue");
  const p1Dot = p1.getByTestId("camp-my-color");
  await expect(p1Dot).toHaveAttribute("data-value", "jade");
  await expect(p2.getByTestId("camp-my-color")).toHaveAttribute("data-value", "blue");
  await expect(p1.getByTestId("camp-player-joined")).toHaveText(/^Playing as Player 1 in /);

  // K2: player-1's Popover: 8 swatches, own checked, blue / amber taken and disabled.
  await p1Dot.click();
  await expect(p1.getByTestId("camp-color-popover")).toBeVisible();
  await expect(p1.getByTestId("camp-color-swatch")).toHaveCount(8);
  await expect(swatch(p1, "jade")).toHaveAttribute("data-state", "checked");
  await expect(swatch(p1, "blue")).toBeDisabled();
  await expect(swatch(p1, "blue")).toHaveAttribute("data-taken-by", p2Id);
  await expect(swatch(p1, "amber")).toBeDisabled();
  await expect(swatch(p1, "amber")).toHaveAttribute("data-taken-by", "dm");
  // Amber (top row) first: its Tooltip opens above the grid, clear of the blue swatch below.
  await expect(await tooltipOf(p1, "amber", "Amber — taken by DM")).toBeVisible();
  await expect(await tooltipOf(p1, "blue", "Blue — taken by Player 2")).toBeVisible();
  // Pointer off the grid: the Tooltip closes (it sits over the top row).
  await p1.mouse.move(0, 0);
  await expect(p1.getByTestId("ui-tooltip")).toHaveCount(0);
  await swatch(p1, "rose").click();
  await expect(p1.getByTestId("camp-color-popover")).toHaveCount(0);
  await expect(p1Dot).toHaveAttribute("data-value", "rose", { timeout: 1_000 });
  await expect(rowSwatch(p1Id)).toHaveAttribute("data-value", "rose", { timeout: 1_000 });

  // K10: the DM's Popover for Player 2: rose taken by Player 1, own blue checked, amber by DM.
  await rowSwatch(p2Id).click();
  await expect(swatch(dm, "rose")).toBeDisabled();
  await expect(swatch(dm, "rose")).toHaveAttribute("data-taken-by", p1Id);
  await expect(swatch(dm, "blue")).toHaveAttribute("data-state", "checked");
  await expect(swatch(dm, "amber")).toHaveAttribute("data-taken-by", "dm");
  await dm.keyboard.press("Escape");
  await expect(dm.getByTestId("camp-color-popover")).toHaveCount(0);
  // The DM's own swatch → yellow; player-1 then sees yellow taken by the DM.
  await dmSwatch.click();
  await expect(swatch(dm, "amber")).toHaveAttribute("data-state", "checked");
  await expect(swatch(dm, "rose")).toHaveAttribute("data-taken-by", p1Id);
  await swatch(dm, "yellow").click();
  await expect(dmSwatch).toHaveAttribute("data-value", "yellow", { timeout: 1_000 });
  await p1Dot.click();
  await expect(swatch(p1, "yellow")).toHaveAttribute("data-taken-by", "dm");
  await expect(swatch(p1, "amber")).toBeEnabled();
  await p1.keyboard.press("Escape");

  // K11: held down → the Popover still opens, every swatch disabled, the dot keeps rose.
  hold = true;
  await sockets.at(-1)?.close();
  await expect(p1Status).not.toHaveAttribute("data-state", "live");
  await p1Dot.click();
  await expect(p1.getByTestId("camp-color-swatch")).toHaveCount(8);
  for (const s of await p1.getByTestId("camp-color-swatch").all()) await expect(s).toBeDisabled();
  await expect(p1Dot).toHaveAttribute("data-value", "rose");
  await p1.keyboard.press("Escape");
  // Back live → the picker works again.
  hold = false;
  await sockets.at(-1)?.close();
  await expect(p1Status).toHaveAttribute("data-state", "live", { timeout: 15_000 });
  await p1Dot.click();
  await expect(swatch(p1, "sky")).toBeEnabled();
  await swatch(p1, "sky").click();
  await expect(rowSwatch(p1Id)).toHaveAttribute("data-value", "sky", { timeout: 1_000 });
  await expect(p2.getByTestId("camp-my-color")).toHaveAttribute("data-value", "blue");

  // Leave the bundle as loaded (Player 1 jade, DM amber) for a rerun on this server.
  await p1Dot.click();
  await swatch(p1, "jade").click();
  await expect(rowSwatch(p1Id)).toHaveAttribute("data-value", "jade");
  await dmSwatch.click();
  await swatch(dm, "amber").click();
  await expect(p1Dot).toHaveAttribute("data-value", "jade");
  await expect(dmSwatch).toHaveAttribute("data-value", "amber");

  expect(errors).toEqual([]);
  await p2.context().close();
  await p1.context().close();
  await dm.context().close();
});
