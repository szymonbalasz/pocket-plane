// e2e-bundle: player-colours
// Thin colour picker on the sprint-5 bundle (CAMP §13 K1, K2, K10, K11; sprint 6: the FR-CAMP-35
// picker), DM + player-1 + player-2 in separate contexts. K1: the DM's Players panel shows DM
// amber, Player 1 jade, Player 2 blue; the players' chips jade / blue. K2: player-1's Preferences
// picker has blue blocked by Player 2 and amber by the DM (reason in the status line, no Tooltip);
// rose + Apply recolours the DM's row swatch and the chip. K10: the DM's Player 2 Popover has rose
// blocked by Player 1; the DM picks yellow for themself. K11: player-1's socket is held down →
// Apply disabled; back live → a pick works.
import { expect, test } from "@playwright/test";
import { PLAYER_COLORS } from "../src/shared/campaign-management/colors";
import { closePrefs, ownPicker, popoverPicker, swatch } from "./support/colour";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

const { amber, jade, sky, rose, yellow, blue } = PLAYER_COLORS;

test("FR-CAMP-35 picker: Preferences picker and DM Players panel Popovers on the sprint-5 bundle (K1, K2, K10, K11)", async ({
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

  // K1: DM amber, Player 1 jade, Player 2 blue; the chips jade / blue; no header dot.
  await expect(dmSwatch).toHaveAttribute("data-value", amber);
  await expect(rowSwatch(p1Id)).toHaveAttribute("data-value", jade);
  await expect(rowSwatch(p2Id)).toHaveAttribute("data-value", blue);
  const p1Dot = p1.getByTestId("ui-prefs-chip-dot");
  await expect(p1Dot).toHaveAttribute("data-color", jade);
  await expect(p2.getByTestId("ui-prefs-chip-dot")).toHaveAttribute("data-color", blue);
  await expect(p1.getByTestId("camp-my-color")).toHaveCount(0);
  await expect(p1.getByTestId("camp-player-joined")).toHaveText(/ · playing as Player 1$/);

  // K2: player-1's picker: 8 swatches, own checked, blue / amber blocked with reasons.
  let picker = await ownPicker(p1);
  await expect(picker.getByTestId("camp-color-swatch")).toHaveCount(8);
  await expect(swatch(picker, jade)).toHaveAttribute("data-state", "checked");
  await expect(swatch(picker, blue)).toHaveAttribute("data-blocked-by", p2Id);
  await expect(swatch(picker, blue)).toBeDisabled();
  await expect(swatch(picker, amber)).toHaveAttribute("data-blocked-by", "dm");
  const status = picker.getByTestId("camp-color-status");
  await swatch(picker, amber).hover();
  await expect(status).toHaveText("Taken by DM");
  await expect(status).toHaveAttribute("data-reason", "taken");
  await swatch(picker, blue).hover();
  await expect(status).toHaveText("Taken by Player 2");
  // BL-36: the reason lives in the status line; no Tooltip opens over the row.
  await expect(p1.getByTestId("ui-tooltip")).toHaveCount(0);
  await swatch(picker, rose).click();
  await picker.getByTestId("camp-color-apply").click();
  await expect(p1Dot).toHaveAttribute("data-color", rose);
  await expect(rowSwatch(p1Id)).toHaveAttribute("data-value", rose);
  await closePrefs(p1);

  // K10: the DM's Popover for Player 2: rose blocked by Player 1, own blue checked, amber by DM.
  await rowSwatch(p2Id).click();
  let dmPicker = popoverPicker(dm);
  await expect(dm.getByTestId("camp-color-popover")).toContainText("Colour for Player 2");
  await expect(dmPicker).toHaveAttribute("data-target", p2Id);
  await expect(swatch(dmPicker, rose)).toHaveAttribute("data-blocked-by", p1Id);
  await expect(swatch(dmPicker, blue)).toHaveAttribute("data-state", "checked");
  await expect(swatch(dmPicker, amber)).toHaveAttribute("data-blocked-by", "dm");
  await dm.keyboard.press("Escape");
  await expect(dm.getByTestId("camp-color-popover")).toHaveCount(0);
  // The DM's own swatch → yellow; player-1 then sees yellow blocked by the DM.
  await dmSwatch.click();
  dmPicker = popoverPicker(dm);
  await expect(dmPicker).toHaveAttribute("data-target", "dm");
  await expect(swatch(dmPicker, amber)).toHaveAttribute("data-state", "checked");
  await expect(swatch(dmPicker, rose)).toHaveAttribute("data-blocked-by", p1Id);
  await swatch(dmPicker, yellow).click();
  await dmPicker.getByTestId("camp-color-apply").click();
  await expect(dmSwatch).toHaveAttribute("data-value", yellow);
  await dm.keyboard.press("Escape");
  picker = await ownPicker(p1);
  await expect(swatch(picker, yellow)).toHaveAttribute("data-blocked-by", "dm");
  await expect(swatch(picker, amber)).not.toHaveAttribute("data-blocked-by", /.+/);

  // K11: held down → the picker still works as a draft, Apply disabled, the chip keeps rose.
  hold = true;
  await sockets.at(-1)?.close();
  await expect(p1Status).not.toHaveAttribute("data-state", "live");
  await swatch(picker, sky).click();
  await expect(swatch(picker, sky)).toHaveAttribute("data-state", "checked");
  await expect(picker.getByTestId("camp-color-apply")).toBeDisabled();
  await expect(p1Dot).toHaveAttribute("data-color", rose);
  // Back live → Apply works (the draft was kept).
  hold = false;
  await sockets.at(-1)?.close();
  await expect(p1Status).toHaveAttribute("data-state", "live", { timeout: 15_000 });
  await expect(picker.getByTestId("camp-color-apply")).toBeEnabled();
  await picker.getByTestId("camp-color-apply").click();
  await expect(rowSwatch(p1Id)).toHaveAttribute("data-value", sky);
  await expect(p2.getByTestId("ui-prefs-chip-dot")).toHaveAttribute("data-color", blue);

  // Leave the bundle as loaded (Player 1 jade, DM amber) for a rerun on this server.
  await swatch(picker, jade).click();
  await picker.getByTestId("camp-color-apply").click();
  await expect(rowSwatch(p1Id)).toHaveAttribute("data-value", jade);
  await closePrefs(p1);
  await dmSwatch.click();
  dmPicker = popoverPicker(dm);
  await swatch(dmPicker, amber).click();
  await dmPicker.getByTestId("camp-color-apply").click();
  await expect(p1Dot).toHaveAttribute("data-color", jade);
  await expect(dmSwatch).toHaveAttribute("data-value", amber);

  expect(errors).toEqual([]);
  await p2.context().close();
  await p1.context().close();
  await dm.context().close();
});
