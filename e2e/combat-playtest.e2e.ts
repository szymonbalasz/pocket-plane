// e2e-bundle: mid-combat
// Playtest polish (CBT §13 E2E, mid-combat: round 1, Wolf's turn). DM Initiative row menu: the
// Check ▸ / Save ▸ submenus stay open while the mouse crosses to an ability (FR-CBT-44). Turn
// alert: Next to Mira's turn → player-1's flash renders and runs its full ≈ 1.2 s (FR-CBT-41).
import { expect, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

interface FlashRun {
  id: string | null;
  added: number;
  removed: number;
  peak: number;
}

test("FR-CBT-44 Save ▸ submenu: a mouse move from Save to Dexterity picks it", async ({
  browser,
}) => {
  const { secret, recordId } = e2eEnv();
  const goblin = recordId("combat-1", "combatant", 2);
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1600, height: 900 });
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const init = await openWindow(dm, "cbt.initiative");
  const log = await openWindow(dm, "dice.log");
  const before = await log.getByTestId("dice-log-entry").count();
  await init.locator(`[data-testid="cbt-init-row-menu"][data-record-id="${goblin}"]`).click();
  const save = dm.locator(`[data-testid="cbt-init-row-save"][data-record-id="${goblin}"]`);
  await save.hover();
  const dex = dm.locator(
    `[data-testid="cbt-init-row-save-option"][data-record-id="${goblin}"][data-value="dex"]`,
  );
  await expect(dex).toBeVisible();
  // At the right edge the submenu opens on the left: a direct move (no steps) from "Save" to
  // "Dexterity" used to close it (playtest regression).
  await dex.click();
  await expect(log.getByTestId("dice-log-entry")).toHaveCount(before + 1);
  await expect(log.getByTestId("dice-log-entry").last()).toContainText("Goblin");
  await expect(log.getByTestId("dice-log-entry").last()).toContainText("Dexterity save");
  await dm.context().close();
});

test("FR-CBT-44 Check ▸ submenu: stepped move from Check to Wisdom picks it; the menu then closes", async ({
  browser,
}) => {
  const { secret, recordId } = e2eEnv();
  const goblin2 = recordId("combat-1", "combatant", 3);
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1600, height: 900 });
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const init = await openWindow(dm, "cbt.initiative");
  const log = await openWindow(dm, "dice.log");
  const before = await log.getByTestId("dice-log-entry").count();
  await init.locator(`[data-testid="cbt-init-row-menu"][data-record-id="${goblin2}"]`).click();
  const check = dm.locator(`[data-testid="cbt-init-row-check"][data-record-id="${goblin2}"]`);
  await check.hover();
  const wis = dm.locator(
    `[data-testid="cbt-init-row-check-option"][data-record-id="${goblin2}"][data-value="wis"]`,
  );
  await expect(wis).toBeVisible();
  const from = await check.boundingBox();
  const to = await wis.boundingBox();
  if (!from || !to) throw new Error("no boxes");
  await dm.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await dm.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await dm.mouse.down();
  await dm.mouse.up();
  await expect(log.getByTestId("dice-log-entry")).toHaveCount(before + 1);
  await expect(log.getByTestId("dice-log-entry").last()).toContainText("Wisdom check");
  await expect(dm.getByRole("menu")).toHaveCount(0);
  await dm.context().close();
});

test("FR-CBT-41 FR-SHELL-22 Next to Mira's turn: player-1's flash renders, runs ≈ 1.2 s, with the Toast", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const mira = recordId("combat-1", "combatant", 0);
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const player = await rolePage(browser);
  await player.goto(link("Player 1"));
  await expect(player.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  // Record each flash: when it is added and removed, and its peak opacity (sampled per frame);
  // the walkthrough sampled it only once.
  await player.evaluate(() => {
    const w = window as unknown as { __flash: FlashRun[] };
    w.__flash = [];
    new MutationObserver((records) => {
      for (const r of records) {
        for (const n of r.addedNodes) {
          if (!(n instanceof HTMLElement) || n.dataset.testid !== "ui-alert-flash") continue;
          const run = {
            id: n.dataset.alertId ?? null,
            added: performance.now(),
            removed: 0,
            peak: 0,
          };
          w.__flash.push(run);
          const sample = () => {
            if (!n.isConnected) return;
            run.peak = Math.max(run.peak, Number(getComputedStyle(n).opacity));
            requestAnimationFrame(sample);
          };
          sample();
        }
        for (const n of r.removedNodes) {
          if (!(n instanceof HTMLElement) || n.dataset.testid !== "ui-alert-flash") continue;
          const open = w.__flash.find((f) => f.removed === 0);
          if (open) open.removed = performance.now();
        }
      }
    }).observe(document.body, { childList: true });
  });
  const init = await openWindow(dm, "cbt.initiative");
  await expect(init.locator('[data-testid="cbt-init-row"][data-turn="true"]')).not.toHaveAttribute(
    "data-record-id",
    mira,
  );
  await init.getByTestId("cbt-init-next").click();
  await expect(init.locator('[data-testid="cbt-init-row"][data-turn="true"]')).toHaveAttribute(
    "data-record-id",
    mira,
  );
  const flash = player.getByTestId("ui-alert-flash");
  await expect(flash).toHaveAttribute("data-alert-id", "cbt.turn");
  await expect(player.getByTestId("ui-alert-toast")).toContainText("Mira");
  await expect(flash).toHaveCount(0); // ends by itself
  const runs = await player.evaluate(() => (window as unknown as { __flash: FlashRun[] }).__flash);
  expect(runs.map((r) => r.id)).toEqual(["cbt.turn"]);
  const run = runs[0];
  if (!run) throw new Error("no flash");
  expect(run.removed - run.added).toBeGreaterThan(1000);
  expect(run.peak).toBeGreaterThan(0.5); // it actually shows, not just mounts
  await player.context().close();
  await dm.context().close();
});
