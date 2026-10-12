// e2e-bundle: dice-log
// Thin dice-roll-log flows (DICE §13 E2E): DM + player-1. Player Shift+Enter roll reaches the
// DM; a DM hidden roll never reaches player frames; a DM public roll does. Visibility matrix,
// window, restart: bun test (dice-roll-log sync.test.ts).
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

const entries = (page: Page) => page.getByTestId("dice-log-entry");

async function roll(page: Page, expression: string, opts: { category?: string; label?: string }) {
  const log = await openWindow(page, "dice.log");
  if (opts.category) await log.getByTestId("dice-roll-category").selectOption(opts.category);
  if (opts.label) await log.getByTestId("dice-roll-label").fill(opts.label);
  await log.getByTestId("dice-roll-expression").fill(expression);
  return log;
}

test("FR-DICE-05 FR-DICE-09 FR-DICE-15 player adv roll reaches DM; DM hidden roll stays hidden", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const player = await rolePage(browser);
  const frames: string[] = [];
  player.on("websocket", (ws) => {
    ws.on("framereceived", (f) => frames.push(String(f.payload)));
  });
  await player.goto(link("Player 1"));
  await expect(player.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

  // rolls-1: DM sees e1–e4 (two muted), player-1 only e1 and e4.
  await openWindow(dm, "dice.log");
  await openWindow(player, "dice.log");
  await expect(entries(dm)).toHaveCount(4);
  await expect(dm.locator('[data-testid="dice-log-entry"][data-public="false"]')).toHaveCount(2);
  await expect(entries(player)).toHaveCount(2);
  await expect(entries(player).nth(1).getByTestId("dice-log-entry-manual")).toBeVisible();
  expect(frames.join("\n")).not.toContain("DM-SECRET-ROLL");

  // Player: as Mira, attack, Shift+Enter → advantage; the DM sees it live.
  const plog = await roll(player, "1d20+4", { category: "attack" });
  await plog.getByTestId("dice-roll-actor").selectOption(recordId("char-mira", "entity"));
  await plog.getByTestId("dice-roll-expression").press("Shift+Enter");
  await expect(plog.getByTestId("dice-roll-expression")).toHaveValue("");
  await expect(entries(dm)).toHaveCount(5);
  await expect(entries(dm).nth(4)).toContainText("Mira");
  await expect(entries(dm).nth(4)).toContainText("(adv)");
  await expect(entries(dm).nth(4).locator("s")).toHaveCount(1);
  await expect(entries(player)).toHaveCount(3);

  // DM: hidden roll (Public switched off for this roll) → muted for the DM, absent for players.
  const dlog = await roll(dm, "1d6", { category: "damage", label: "E2E-SECRET" });
  const pub = dlog.getByTestId("dice-roll-public");
  await expect(pub).toHaveAttribute("data-state", "checked");
  await pub.click();
  await expect(pub).toHaveAttribute("data-state", "unchecked");
  await dlog.getByTestId("dice-roll-expression").press("Enter");
  await expect(entries(dm)).toHaveCount(6);
  await expect(entries(dm).nth(5)).toHaveAttribute("data-public", "false");

  // DM: public roll (damage category is on) → the player sees it; the secret never arrived.
  await roll(dm, "2d6", { category: "damage", label: "E2E-PUBLIC" });
  await dlog.getByTestId("dice-roll-submit").click();
  await expect(entries(dm)).toHaveCount(7);
  await expect(entries(player)).toHaveCount(4);
  await expect(entries(player).nth(3)).toContainText("E2E-PUBLIC");
  expect(frames.join("\n")).not.toContain("E2E-SECRET");
  expect(frames.join("\n")).not.toContain("DM-SECRET-ROLL");

  // Later specs share the server: leave nobody online.
  await player.context().close();
  await dm.context().close();
});
