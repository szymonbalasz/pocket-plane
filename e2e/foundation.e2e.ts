// Thin critical flows (SYNC §13, CAMP §13): DM + players in separate contexts, live
// reveal/hide, player edit, reload survives, invalid link. Bundle: sync-probe.
import { expect, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

test("DM and players: login, join, presence, reveal/hide, edit, reload, invalid link", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();
  const dm = await rolePage(browser);
  const p1 = await rolePage(browser);
  const p2 = await rolePage(browser);

  // DM: wrong secret → error; fixture secret → Fixture Campaign, both players, 3 probes.
  await dm.goto("/");
  await dm.getByTestId("camp-login-secret").fill("definitely-wrong");
  await dm.getByTestId("camp-login-submit").click();
  await expect(dm.getByTestId("camp-login-error")).toBeVisible();
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  await expect(dm.getByTestId("camp-campaign-name")).toHaveText("Fixture Campaign");
  await openWindow(dm, "camp.players"); // closed by default (map-first, #162)
  await expect(dm.getByTestId("camp-player-name")).toHaveText(["Player 1", "Player 2"]);
  await openWindow(dm, "sync.probes"); // probe panel is a play-shell window (FR-SHELL-21)
  await expect(dm.getByTestId("sync-probe-row")).toHaveCount(3);
  await expect(dm.locator('[data-testid="sync-probe-row"][data-hidden="true"]')).toHaveCount(1);
  await expect(dm.locator('[data-testid="camp-player-online"][data-online="true"]')).toHaveCount(0);

  // Players join with no input.
  await p1.goto(link("Player 1"));
  await expect(p1.getByTestId("camp-player-joined")).toHaveText(
    "Fixture Campaign · playing as Player 1",
  );
  await p2.goto(link("Player 2"));
  await expect(p2.getByTestId("camp-player-joined")).toBeVisible();
  await openWindow(p1, "sync.probes");
  await openWindow(p2, "sync.probes");
  await expect(dm.locator('[data-testid="camp-player-online"][data-online="true"]')).toHaveCount(2);
  await expect(p1.getByTestId("sync-probe-row")).toHaveCount(2);
  await expect(p2.getByTestId("sync-probe-row")).toHaveCount(1);

  // Reveal, then hide, the secret probe.
  const secretRow = dm.locator('[data-testid="sync-probe-row"][data-hidden="true"]');
  await secretRow.getByTestId("sync-probe-toggle-hidden").click();
  await expect(p2.getByTestId("sync-probe-row")).toHaveCount(2);
  await expect(p2.getByTestId("sync-probe-text").nth(1)).toHaveValue("SECRET-PROBE");
  await dm.getByTestId("sync-probe-row").nth(1).getByTestId("sync-probe-toggle-hidden").click();
  await expect(p2.getByTestId("sync-probe-row")).toHaveCount(1);

  // Player 1 edits their own probe; DM sees it.
  const mine = p1.getByTestId("sync-probe-row").nth(1);
  await mine.getByTestId("sync-probe-text").fill("mine (edited)");
  await mine.getByTestId("sync-probe-save").click();
  await expect(dm.getByTestId("sync-probe-text").nth(2)).toHaveValue("mine (edited)");

  // Reload survives: DM stays logged in, player stays joined, state intact.
  await dm.reload();
  await p1.reload();
  await expect(dm.getByTestId("camp-campaign-name")).toHaveText("Fixture Campaign");
  await expect(p1.getByTestId("camp-player-joined")).toBeVisible();
  await expect(p1.getByTestId("sync-probe-text").nth(1)).toHaveValue("mine (edited)");

  // Mangled link → invalid-link screen (CAMP §7 wording).
  const p4 = await rolePage(browser);
  await p4.goto(`${link("Player 1").slice(0, -3)}xyz`);
  await expect(p4.getByTestId("camp-invalid-link")).toHaveText(
    "This link isn't recognised. Check that you opened the whole link your DM sent.",
  );
});

test("CAMP §7 Players window at default size: both rows, Add player and the loopback warning fully shown", async ({
  browser,
}) => {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  for (const [width, height] of [
    [1280, 720],
    [1600, 900],
  ] as const) {
    await dm.setViewportSize({ width, height });
    if (width === 1280) await loginDm(dm, secret);
    else await dm.reload();
    await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
    const win = await openWindow(dm, "camp.players");
    await expect(win.getByTestId("camp-player-row")).toHaveCount(2);
    // The e2e server listens on 127.0.0.1, so the warning is on.
    await expect(win.getByTestId("camp-players-loopback-warning")).toBeVisible();
    const clipped = await win.evaluate(
      (w, ids) => {
        const box = w.getBoundingClientRect();
        return ids.flatMap((id) =>
          [...w.querySelectorAll(`[data-testid='${id}']`)]
            .filter((el) => {
              const r = el.getBoundingClientRect();
              return r.height === 0 || r.top < box.top - 0.5 || r.bottom > box.bottom + 0.5;
            })
            .map(() => id),
        );
      },
      [
        "camp-player-row",
        "camp-player-add-name",
        "camp-player-add-submit",
        "camp-players-loopback-warning",
      ],
    );
    expect(clipped).toEqual([]);
  }
  await dm.context().close();
});
