// e2e-bundle: stats-campaign-e2e
// Thin Stats Campaign tab flow (sprint 10 T3: FR-STATS-81–88), DM + player-2 (Thorn) on the
// `stats-b` bundle (expected numbers: `fixtures/units/stats/stats.fixtures.test.ts` header):
// - Stats opens on Campaign (the first tab); the header, Thorn's row and Biggest overkill match
//   the fixture per role: the DM counts the hidden Captain / Goblin 2 kills, the hidden Elite's 9
//   and the hidden nat 20s; the player gets only the healing record (BL-121: the damage records
//   are withheld);
// - at the default 400 × 412 nothing scrolls the window body sideways (the table scrolls in its box);
// - a live public kill (Thorn 25 → Bandit 4) updates both Campaign tabs (trailing refresh);
// - Fight, then close and reopen from the launcher: back on Campaign. Rules: bun test.
import { expect, type Locator, type Page, test } from "@playwright/test";
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

const thornRow = (win: Locator) =>
  win.getByTestId("stats-campaign-row").filter({ hasText: "Thorn" });
const cell = (win: Locator, field: string) => thornRow(win).getByTestId(`stats-campaign-${field}`);

async function expectCampaign(
  win: Locator,
  want: { slain: number; dealt: number; taken: number; kills: number; nat20: number },
) {
  await expect(win.getByTestId("stats-campaign")).toHaveAttribute("data-state", "ok");
  await expect(win.getByTestId("stats-campaign-header")).toHaveAttribute(
    "data-slain",
    String(want.slain),
  );
  await expect(cell(win, "dealt")).toHaveText(String(want.dealt));
  await expect(cell(win, "taken")).toHaveText(String(want.taken));
  await expect(cell(win, "kills")).toHaveText(String(want.kills));
  await expect(cell(win, "nat20")).toHaveText(String(want.nat20));
}

test("FR-STATS-81 FR-STATS-82 FR-STATS-83 FR-STATS-85 FR-STATS-86 FR-STATS-87 Stats opens on Campaign; numbers per role; live refresh; close and reopen lands on Campaign", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { secret, link, recordId } = e2eEnv();
  const thorn = recordId("combat-1", "combatant", 1);
  const bandit4 = recordId("sb-fight-facts", "combatant", 3);

  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const p2 = await rolePage(browser);
  await p2.setViewportSize({ width: 1440, height: 900 });
  await p2.goto(link("Player 2"));
  await live(p2);
  await closePresent(p2);

  const wins: Record<"dm" | "p2", Locator> = {
    dm: await openWindow(dm, "stats.board"),
    p2: await openWindow(p2, "stats.board"),
  };

  await test.step("FR-STATS-85 the first tab is Campaign and the window opens on it", async () => {
    for (const win of Object.values(wins)) {
      await expect(win.getByTestId("stats-tab").first()).toHaveAttribute("data-value", "campaign");
      await expect(win.locator('[data-testid="stats-tab"][data-value="campaign"]')).toHaveAttribute(
        "data-state",
        "active",
      );
      await expect(win.getByTestId("stats-campaign")).toBeVisible();
    }
  });

  await test.step("FR-STATS-82 FR-STATS-83 FR-STATS-86 the fixture's numbers per role", async () => {
    await expectCampaign(wins.dm, { slain: 9, dealt: 93, taken: 209, kills: 4, nat20: 5 });
    await expectCampaign(wins.p2, { slain: 7, dealt: 73, taken: 200, kills: 3, nat20: 3 });
    const overkill = (win: Locator) =>
      win
        .locator('[data-testid="stats-campaign-record"][data-record-id="biggest-overkill"]')
        .getByTestId("stats-campaign-record-value");
    await expect(overkill(wins.dm)).toHaveText("23");
    // BL-121 (sprint 12): the campaign holds party damage players don't see, so their damage
    // records are withheld (no line); Most healing in one fight (Brakka 8) stays.
    await expect(overkill(wins.p2)).toHaveCount(0);
    await expect(wins.p2.getByTestId("stats-campaign-record")).toHaveCount(1);
    await expect(
      wins.p2.locator('[data-testid="stats-campaign-record"][data-record-id="best-fight-healing"]'),
    ).toContainText("Brakka");
    await expect(wins.p2).not.toContainText("Old Crypt");
    await expect(wins.dm).toContainText("Old Crypt");
  });

  await test.step("FR-STATS-88 at 400 × 412 the window body never scrolls sideways", async () => {
    for (const win of Object.values(wins)) {
      const box = await win.boundingBox();
      expect(Math.round(box?.width ?? 0)).toBe(400);
      const body = win.getByTestId("ui-window-body");
      const [scroll, client] = await body.evaluate((el) => [el.scrollWidth, el.clientWidth]);
      expect(scroll).toBeLessThanOrEqual(client);
      // Five-ish rows' worth: the header and the first party row are drawn inside the body.
      await expect(thornRow(win)).toBeInViewport();
    }
  });

  await test.step("FR-STATS-87 a live public kill updates both Campaign tabs (trailing refresh)", async () => {
    await dmIntent(dm, secret, "cbt.applyHp", {
      combatantId: bandit4,
      kind: "damage",
      amount: 25,
      public: true,
      sourceId: thorn,
    });
    await expectCampaign(wins.dm, { slain: 10, dealt: 118, taken: 209, kills: 5, nat20: 5 });
    await expectCampaign(wins.p2, { slain: 8, dealt: 98, taken: 200, kills: 4, nat20: 3 });
  });

  await test.step("FR-STATS-85 Fight, close, reopen from the launcher: back on Campaign", async () => {
    await closeToasts(p2);
    const win = wins.p2;
    await win.locator('[data-testid="stats-tab"][data-value="fight"]').click();
    await expect(win.getByTestId("stats-fight")).toBeVisible();
    await win.getByTestId("ui-window-close").click();
    await expect(shellWindow(p2, "stats.board")).not.toBeVisible();
    await launcherButton(p2, "stats.board").click();
    const again = shellWindow(p2, "stats.board");
    await expect(again.getByTestId("stats-campaign")).toBeVisible();
    await expect(again.locator('[data-testid="stats-tab"][data-value="campaign"]')).toHaveAttribute(
      "data-state",
      "active",
    );
  });
});
