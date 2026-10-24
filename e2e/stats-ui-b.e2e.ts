// e2e-bundle: stats-b-ui-e2e
// Thin stats tier-B UI flow (SB1 + SB2: FR-STATS-28, -34, -36, -41, FR-CHARX-97), DM + player-1
// (Mira, Owlbear) + player-2 (Thorn) on the `stats-b` bundle's running Goblin Ambush:
// - one two-target apply (two event frames) = ONE kill-feed toast per client naming both targets;
//   the DM's with the overkill amounts, player-2's without;
// - Luck · Campaign: the DM's `dm-dice` row only for the DM;
// - Player-1's Trophies tab on Mira's sheet;
// - End at 1280×720 (DM, and player-1 with the companion card open): "Fight summary" and Stats
//   opens on that fight with Highlights; players' Kills omit the hidden Captain; the DM sees Still
//   standing. Rules: bun test.
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { launcherButton, openWindow, shellWindow } from "./support/shell";
import { closeToasts } from "./support/toasts";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

/** One DM intent over a socket of its own (hello → snapshot → intent → ack result). */
function dmIntent(page: Page, secret: string, name: string, payload: unknown) {
  return page.evaluate(
    ([secret, name, payload]) =>
      new Promise<unknown>((resolve, reject) => {
        const ws = new WebSocket(`${location.origin.replace(/^http/, "ws")}/ws`);
        ws.onopen = () =>
          ws.send(JSON.stringify({ type: "hello", credential: { role: "dm", secret } }));
        let sent = false;
        ws.onmessage = (m) => {
          const f = JSON.parse(String(m.data)) as { type: string; result?: unknown };
          if (f.type === "snapshot" && !sent) {
            sent = true;
            ws.send(
              JSON.stringify({ type: "intent", intentId: crypto.randomUUID(), name, payload }),
            );
          } else if (f.type === "ack") {
            ws.close();
            resolve(f.result);
          } else if (f.type === "reject") {
            ws.close();
            reject(new Error(String(m.data)));
          }
        };
      }),
    [secret, name, payload] as const,
  );
}

/** Closes the handout a bundle may present to a player at load. */
async function closePresent(page: Page) {
  const close = page.getByTestId("party-present-close");
  if (await close.isVisible()) await close.click();
}

const box = async (page: Page, kind: string) => {
  const b = await shellWindow(page, kind).boundingBox();
  if (!b) throw new Error(`${kind} not drawn`);
  return b;
};
const overlaps = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test("FR-STATS-28 FR-STATS-34 FR-STATS-36 FR-STATS-41 FR-CHARX-97 one feed toast per apply, Luck, Trophies, End opens Highlights at 1280×720", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { secret, link, recordId } = e2eEnv();
  const mira = recordId("combat-1", "combatant", 0);
  const bandit2 = recordId("sb-fight-facts", "combatant", 1);
  const bandit4 = recordId("sb-fight-facts", "combatant", 3);

  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1280, height: 720 });
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1280, height: 720 });
  await p1.goto(link("Player 1"));
  await live(p1);
  await closePresent(p1);
  const p2 = await rolePage(browser);
  await p2.setViewportSize({ width: 1440, height: 900 });
  await p2.goto(link("Player 2"));
  await live(p2);
  await closePresent(p2);

  await test.step("FR-STATS-28 Mira's card on Bandit 2 + Bandit 4, 30 each: one toast per client naming both", async () => {
    const card = (await dmIntent(dm, secret, "cbt.rollDamage", {
      attackerId: mira,
      manual: { diceTotal: 5 },
    })) as { cardId: string; rollIds: string[] };
    await dmIntent(dm, secret, "cbt.applyCard", {
      cardId: card.cardId,
      damageTotal: 30,
      damageRollId: card.rollIds[0],
      partRollIds: { toHit: null, extra: [] },
      targets: [bandit2, bandit4].map((targetId) => ({
        targetId,
        hit: true,
        multiplier: "normal",
      })),
      public: true,
    });
    for (const page of [dm, p1, p2]) {
      const toast = page.getByTestId("stats-feed-toast");
      await expect(toast).toHaveCount(1);
      await expect(toast.getByTestId("stats-feed-line")).toHaveCount(2);
      await expect(toast).toContainText("Overkill! Mira finished Bandit 2");
      await expect(toast).toContainText("Overkill! Mira finished Bandit 4");
    }
    await expect(dm.getByTestId("stats-feed-toast")).toContainText(", overkill 19");
    await expect(p2.getByTestId("stats-feed-toast")).not.toContainText("overkill 19");
  });

  await test.step("FR-STATS-41 Luck · Campaign: rows for both; only the DM has DM dice", async () => {
    for (const page of [dm, p2]) {
      const stats = await openWindow(page, "stats.board");
      await closeToasts(page); // FR-NOTE-70, -71: the stack may sit on this window's body, below its first row
      await stats.locator('[data-testid="stats-tab"][data-value="luck"]').click();
      await stats.getByTestId("stats-luck-scope").click();
      await page
        .locator('[data-testid="stats-luck-scope-option"][data-record-id="campaign"]')
        .click();
      await expect(stats.getByTestId("stats-luck")).toHaveAttribute("data-state", "ok");
      await expect(stats.getByTestId("stats-luck-row").filter({ hasText: "Mira" })).toHaveCount(1);
    }
    await expect(
      dm.locator('[data-testid="stats-luck-row"][data-record-id="dm-dice"]'),
    ).toHaveCount(1);
    await expect(
      p2.locator('[data-testid="stats-luck-row"][data-record-id="dm-dice"]'),
    ).toHaveCount(0);
    // Back to the Fight tab for End.
    for (const page of [dm, p2]) {
      await shellWindow(page, "stats.board")
        .locator('[data-testid="stats-tab"][data-value="fight"]')
        .click();
      await launcherButton(page, "stats.board").click(); // minimise (FR-SHELL-09)
    }
  });

  await test.step("FR-CHARX-97 Player 1's Trophies tab on their sheet: last tab, the character's numbers", async () => {
    const sheet = await openWindow(p1, "char.sheet");
    const tabs = sheet.getByTestId("charx-tab");
    await expect(tabs.last()).toHaveAttribute("data-value", "section:stats.trophies");
    await tabs.last().click();
    const trophies = sheet.getByTestId("stats-trophies");
    // The sheet's character (player-1's own; another's sheet never has the tab).
    const shown = await sheet.getByTestId("char-sheet").getAttribute("data-record-id");
    await expect(trophies).toHaveAttribute("data-record-id", shown ?? "");
    await expect(trophies).toHaveAttribute("data-state", "ok");
    const dealt = trophies.locator('[data-testid="stats-trophy"][data-record-id="dealt"]');
    await expect(dealt).not.toHaveAttribute("data-value", "—");
    await expect(trophies).not.toContainText("Includes hidden rolls and fights");
    await launcherButton(p1, "char.sheet").click(); // minimise
  });

  await test.step("FR-STATS-34 FR-STATS-36 End at 1280×720: the summary opens Stats on that fight with Highlights (DM after Initiative minimises; player-1 with the companion card open)", async () => {
    await openWindow(p1, "charx.companion");
    const init = await openWindow(dm, "cbt.initiative");
    await init.getByTestId("cbt-init-end").click();
    await dm.getByTestId("cbt-init-end-confirm").click();
    await expect(launcherButton(dm, "cbt.initiative")).not.toHaveAttribute("data-state", "open");
    for (const page of [dm, p1, p2]) {
      const stats = shellWindow(page, "stats.board");
      await expect(stats).toHaveAttribute("data-state", "open");
      await expect(stats.getByTestId("stats-highlights")).toHaveAttribute("data-state", "open");
      await expect(stats.getByTestId("stats-fight-status")).toHaveText("Ended");
      await expect(
        stats.locator('[data-testid="stats-highlight"][data-record-id="kills"]'),
      ).toContainText("Mira finished Bandit 2");
    }
    for (const page of [dm, p1]) {
      const b = await box(page, "stats.board");
      expect(b.x >= 0 && b.y >= 0 && b.x + b.width <= 1280 && b.y + b.height <= 720).toBe(true);
    }
    // The placer's ladder (FR-SHELL-97) may put the companion card away for it; Stats never
    // covers a window left open.
    const card = shellWindow(p1, "charx.companion");
    if ((await card.getAttribute("data-state")) === "open") {
      expect(overlaps(await box(p1, "stats.board"), await box(p1, "charx.companion"))).toBe(false);
    }
    // Players: no hidden Captain, no Still standing; the DM: Still standing.
    for (const page of [p1, p2]) {
      const hl = shellWindow(page, "stats.board").getByTestId("stats-highlights");
      await expect(hl).not.toContainText("Captain");
      await expect(hl.locator('[data-record-id="standing"]')).toHaveCount(0);
    }
    await expect(
      shellWindow(dm, "stats.board").locator(
        '[data-testid="stats-highlight"][data-record-id="standing"]',
      ),
    ).toHaveCount(1);
  });

  for (const page of [p1, p2, dm]) await page.context().close();
});
