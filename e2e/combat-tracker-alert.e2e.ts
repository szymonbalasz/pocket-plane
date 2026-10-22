// e2e-bundle: mid-combat
// Turn alert after a reload (walkthrough note 12a, FR-CBT-41 / FR-SHELL-22/25): player-1 gets
// "Your turn — Mira", reloads (audio locked again, no interaction since), and the next turn
// alert still shows its Toast within 1 s, beside the `ping:locked` sound outcome.
import { expect, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

test("FR-CBT-41 FR-SHELL-25 turn alert Toast after a player reload with audio locked", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const mira = recordId("combat-1", "combatant", 0);
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const player = await rolePage(browser);
  await player.goto(link("Player 1"));
  const live = player.getByTestId("sync-connection-status");
  await expect(live).toHaveAttribute("data-state", "live");

  const init = await openWindow(dm, "cbt.initiative");
  const turn = init.locator('[data-testid="cbt-init-row"][data-turn="true"]');
  const toast = player.getByTestId("ui-alert-toast");
  /** Step the turn onto Mira from someone else's (the bundle's turn depends on earlier specs). */
  const toMira = async () => {
    if ((await turn.getAttribute("data-record-id")) === mira) {
      await init.getByTestId("cbt-init-prev").click();
      await expect(turn).not.toHaveAttribute("data-record-id", mira);
    }
    for (let i = 0; i < 10; i++) {
      const before = await turn.getAttribute("data-record-id");
      await init.getByTestId("cbt-init-next").click();
      await expect(turn).not.toHaveAttribute("data-record-id", before ?? "");
      if ((await turn.getAttribute("data-record-id")) === mira) return;
    }
    throw new Error("Mira's turn never came");
  };
  await toMira();
  await expect(toast).toContainText("Your turn — Mira", { timeout: 1000 });

  // Reload: a fresh page, audio locked until an interaction (none follows).
  await player.reload();
  await expect(live).toHaveAttribute("data-state", "live");
  await expect(toast).toHaveCount(0);
  await toMira();
  await expect(toast).toContainText("Your turn — Mira", { timeout: 1000 });
  await expect(player.getByTestId("ui-topbar")).toHaveAttribute(
    "data-test-last-sound",
    /^turn:locked:/,
  );
  // Still there a second later (sonner's 4 s default), not a flicker.
  await player.waitForTimeout(1000);
  await expect(toast).toBeVisible();
  await player.context().close();
  await dm.context().close();
});
