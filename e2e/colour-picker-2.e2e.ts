// e2e-bundle: prefs-s6-e2e
// Thin PF2 flows (CAMP FR-CAMP-35, DICEX FR-DICEX-57, -58; play-shell §13 P3–P6, P9, P10, P14),
// DM (A) + player-1 (B) + player-2 (C) in separate contexts on prefs-s6 (DM amber, B jade, C
// lavender). P3: B's Preferences picker blocks Amber (DM), Blue and Sky (C, colour-blind views)
// with the reason in the status line, no Tooltip; Rose + Apply recolours B everywhere. P4: hex
// `#7fd8ff` applied; a drag into the dark bottom stops at the allowed edge and names the reason.
// P5: five refused hexes, Apply disabled, nothing sent. P6: the DM's Popover for C: B's colour
// taken; Yellow applied. P9: Dice section Off → the tray gear shows Off (one store). P10: Dice
// look… opens in place. P14: reload keeps colours, Preferences closed. Restores the bundle's
// colours at the end (prefs-window.e2e.ts shares this server).
import { expect, test } from "@playwright/test";
import { PLAYER_COLORS } from "../src/shared/campaign-management/colors";
import {
  applyHex,
  closePrefs,
  ownPicker,
  pickOwnColour,
  popoverPicker,
  swatch,
} from "./support/colour";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow, shellWindow } from "./support/shell";

const { amber, jade, sky, rose, yellow, blue } = PLAYER_COLORS;
const LAVENDER = "#b388ff";
const PALE_SKY = "#7fd8ff";

test("FR-CAMP-35 picker, FR-DICEX-57/58: Preferences colour + dice, DM Players panel Popover (P3–P6, P9, P10, P14)", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const p1Id = recordId("player-1", "player");
  const p2Id = recordId("player-2", "player");
  const errors: string[] = [];

  const a = await rolePage(browser);
  await loginDm(a, secret);
  await expect(a.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const b = await rolePage(browser);
  // B's sent frames: a refused colour never reaches the server (P5).
  const sent: string[] = [];
  b.on("websocket", (ws) => ws.on("framesent", (f) => sent.push(String(f.payload))));
  await b.goto(link("Player 1"));
  const c = await rolePage(browser);
  await c.goto(link("Player 2"));
  for (const page of [a, b, c]) {
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  }
  const bDot = b.getByTestId("ui-prefs-chip-dot");
  const cDot = c.getByTestId("ui-prefs-chip-dot");
  await expect(bDot).toHaveAttribute("data-color", jade);
  await expect(cDot).toHaveAttribute("data-color", LAVENDER);
  const panel = await openWindow(a, "camp.players");
  const row = (id: string) =>
    panel.locator(`[data-testid="camp-player-color"][data-record-id="${id}"]`);

  // P3: the palette row; blocked swatches name their reason in the status line, no Tooltip.
  const picker = await ownPicker(b);
  await expect(picker.getByTestId("camp-color-swatch")).toHaveCount(8);
  await expect(swatch(picker, jade)).toHaveAttribute("data-state", "checked");
  await expect(swatch(picker, amber)).toHaveAttribute("data-blocked-by", "dm");
  await expect(swatch(picker, blue)).toHaveAttribute("data-blocked-by", p2Id);
  await expect(swatch(picker, sky)).toHaveAttribute("data-blocked-by", p2Id);
  await expect(picker.getByTestId("camp-color-others")).toHaveText("● DM · ● Player 2");
  const status = picker.getByTestId("camp-color-status");
  await swatch(picker, blue).hover();
  await expect(status).toHaveText("Too close to Player 2's colour for colour-blind players");
  await expect(status).toHaveAttribute("data-reason", "too-close");
  await swatch(picker, amber).hover();
  await expect(status).toHaveText("Taken by DM");
  await expect(b.getByTestId("ui-tooltip")).toHaveCount(0);
  const apply = picker.getByTestId("camp-color-apply");
  await expect(apply).toBeDisabled(); // unchanged draft
  await swatch(picker, rose).click();
  await apply.click();
  await expect(bDot).toHaveAttribute("data-color", rose, { timeout: 1_000 });
  await expect(row(p1Id)).toHaveAttribute("data-value", rose, { timeout: 1_000 });

  // P4: a hex, applied everywhere; then a drag into the dark bottom stops at the allowed edge.
  await applyHex(picker, PALE_SKY);
  await expect(bDot).toHaveAttribute("data-color", PALE_SKY, { timeout: 1_000 });
  await expect(row(p1Id)).toHaveAttribute("data-value", PALE_SKY, { timeout: 1_000 });
  const sv = picker.getByTestId("camp-color-sv");
  const box = await sv.boundingBox();
  if (!box) throw new Error("no square");
  await b.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await b.mouse.down();
  await b.mouse.move(box.x + box.width / 2, box.y + box.height - 1, { steps: 4 });
  await expect(status).toHaveAttribute("data-reason", "too-dark");
  const held = (await sv.getAttribute("aria-valuetext")) ?? "";
  const v = Number(/brightness (\d+) %/.exec(held)?.[1]);
  expect(v).toBeGreaterThan(30);
  await b.mouse.up();
  await expect(status).not.toHaveAttribute("data-reason", /.+/);
  await expect(apply).toBeEnabled(); // the clamped colour is allowed

  // P5: refused hexes: the reason, Apply disabled, nothing sent.
  const before = sent.filter((f) => f.includes("camp.setColor")).length;
  const hex = picker.getByTestId("camp-color-hex");
  for (const [value, text] of [
    ["#a0c814", "Too close to DM's colour for colour-blind players"],
    [LAVENDER, "Taken by Player 2"],
    ["#3d6ec9", "Too dark to read on the map"],
    ["#9e9e9e", "Too grey"],
    ["#f05555", "Too close to the danger red"],
  ] as const) {
    await hex.fill(value);
    await expect(status).toHaveText(text);
    await expect(apply).toBeDisabled();
    await apply.click({ force: true });
  }
  await hex.fill("#12");
  await expect(status).toHaveAttribute("data-reason", "bad-hex");
  await expect(apply).toBeDisabled();
  expect(sent.filter((f) => f.includes("camp.setColor")).length).toBe(before);
  await closePrefs(b);

  // P6: the DM's Popover for Player 2: B's pale sky is taken; Yellow applies.
  await row(p2Id).click();
  const dmPicker = popoverPicker(a);
  await expect(a.getByTestId("camp-color-popover")).toContainText("Colour for Player 2");
  await dmPicker.getByTestId("camp-color-hex").fill(PALE_SKY);
  await expect(dmPicker.getByTestId("camp-color-status")).toHaveText("Taken by Player 1");
  await expect(dmPicker.getByTestId("camp-color-apply")).toBeDisabled();
  await swatch(dmPicker, yellow).click();
  await dmPicker.getByTestId("camp-color-apply").click();
  await expect(cDot).toHaveAttribute("data-color", yellow, { timeout: 1_000 });
  await a.keyboard.press("Escape");

  // P9: B's Dice section Off → the tray gear's panel shows Off too (one store).
  const bPrefs = shellWindow(b, "shell.prefs");
  await ownPicker(b);
  const dice = bPrefs.locator('[data-testid="ui-prefs-section"][data-record-id="dicex.dice"]');
  const off = dice.locator('[data-testid="dicex-settings-display"][data-value="off"]');
  await off.click();
  await expect(off).toHaveAttribute("data-state", "on");
  await closePrefs(b);
  const tray = await openWindow(b, "dicex.tray");
  await tray.getByTestId("dicex-settings-open").click();
  await expect(
    b.locator('[data-testid="dicex-settings-display"][data-value="off"]').first(),
  ).toHaveAttribute("data-state", "on");
  await b.keyboard.press("Escape");

  // P10: the DM's Dice section: Dice look… opens the look pane in place; Back returns.
  await ownPicker(a);
  const aDice = shellWindow(a, "shell.prefs").locator(
    '[data-testid="ui-prefs-section"][data-record-id="dicex.dice"]',
  );
  await aDice.getByTestId("dicex-look-open").click();
  await expect(aDice.getByTestId("dicex-look")).toBeVisible();
  await aDice.getByTestId("dicex-look-back").click();
  await expect(aDice.getByTestId("dicex-settings-display")).toHaveCount(4);
  await closePrefs(a);

  // P14: reload: colours kept, Preferences closed.
  for (const page of [b, c]) await page.reload();
  for (const page of [b, c]) {
    await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
    await expect(page.getByTestId("ui-prefs-open")).toHaveAttribute("data-state", "closed");
  }
  await expect(bDot).toHaveAttribute("data-color", PALE_SKY);
  await expect(cDot).toHaveAttribute("data-color", yellow);

  // Back to the bundle's colours (B jade, C lavender) for prefs-window.e2e.ts and reruns.
  await pickOwnColour(b, jade);
  await row(p2Id).click();
  await applyHex(popoverPicker(a), LAVENDER);
  await expect(cDot).toHaveAttribute("data-color", LAVENDER, { timeout: 1_000 });
  await a.keyboard.press("Escape");

  expect(errors).toEqual([]);
  for (const page of [c, b, a]) await page.context().close();
});
