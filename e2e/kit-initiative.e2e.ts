// e2e-bundle: kit-initiative
// Kit parity K2 (kit-parity §6.3, §13): the Initiative rows on the kit grid at 1440×900. DM: Next
// turn in the footer moves the turn gem; a row's ⋯ is hidden until hover, then Damage / heal…
// opens the HP dialog; the window menu's End encounter… confirms with Keep fighting (kept: the
// fight goes on). Player-1: round centred, Mira's HP bar with numbers, no row actions.
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { initMenu } from "./support/initiative";
import { openWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

test("FR-KIT-22 FR-KIT-29 FR-KIT-20 FR-KIT-72 FR-KIT-26 Next turn in the footer, hover ⋯ → Damage / heal, End → Keep fighting; the player's rows", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const init = await openWindow(dm, "cbt.initiative");
  const turnRow = init.locator('[data-testid="cbt-init-row"][data-turn="true"]');
  await expect(turnRow).toHaveCount(1);
  await expect(turnRow.locator('[data-slot="init-turn"]')).toHaveAttribute(
    "aria-label",
    "Current turn",
  );
  const first = await turnRow.getAttribute("data-record-id");

  // FR-KIT-22: Next turn sits in the footer, under the list; the gem moves to the next row.
  const footer = init.getByTestId("cbt-init-footer");
  await expect(footer.getByTestId("cbt-init-next")).toHaveText("Next turn");
  await footer.getByTestId("cbt-init-next").click();
  await expect(turnRow).not.toHaveAttribute("data-record-id", first ?? "");
  const listBox = await init.getByTestId("cbt-init-list").boundingBox();
  const footBox = await footer.boundingBox();
  expect((footBox?.y ?? 0) + 0.5).toBeGreaterThanOrEqual(
    (listBox?.y ?? 0) + (listBox?.height ?? 0),
  );

  // FR-KIT-29: another row's actions are invisible until hover; hover → ⋯ → Damage / heal….
  const row = init
    .locator('[data-testid="cbt-init-row"][data-turn="false"]:not([data-removed])')
    .first();
  const actions = row.locator('[data-slot="init-actions"]').first();
  await dm.mouse.move(5, 450);
  await expect(actions).toHaveCSS("opacity", "0");
  await row.hover();
  await expect(actions).toHaveCSS("opacity", "1");
  await row.getByTestId("cbt-init-row-menu").first().click();
  await dm.getByTestId("cbt-init-row-hp-adjust").click();
  await expect(dm.getByTestId("cbt-hp")).toBeVisible();
  await dm.keyboard.press("Escape");
  await expect(dm.getByTestId("cbt-hp")).toHaveCount(0);

  // FR-KIT-20 / -72: End encounter… from the window menu; Keep fighting closes, the fight stays.
  await initMenu(dm, init, "cbt-init-end");
  const keep = dm.getByRole("button", { name: "Keep fighting" });
  await expect(keep).toBeVisible();
  await expect(dm.getByTestId("cbt-init-end-confirm")).toHaveText("End encounter");
  await keep.click();
  await expect(dm.getByTestId("cbt-init-end-confirm")).toHaveCount(0);
  await expect(init.getByTestId("cbt-init-row")).not.toHaveCount(0);

  // FR-KIT-26 / -30: player-1's rows: Mira's HP bar with numbers, no actions or grip.
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1440, height: 900 });
  await p1.goto(link("Player 1"));
  await live(p1);
  const pInit = await openWindow(p1, "cbt.initiative");
  await expect(pInit.getByTestId("cbt-init-round")).toHaveText(/^Round \d+$/);
  const mira = pInit.locator('[data-testid="cbt-init-row"]', {
    has: p1.locator('[data-testid="cbt-init-row-name"][data-value="Mira"]'),
  });
  await expect(mira.locator('[data-testid="cbt-init-row-hp"][data-slot="kit-hpbar"]')).toHaveText(
    /^\d+ \/ \d+$/,
  );
  for (const id of [
    "cbt-init-row-menu",
    "cbt-init-row-attack",
    "cbtx-init-row-grip",
    "cbt-init-menu",
  ]) {
    await expect(pInit.getByTestId(id)).toHaveCount(0);
  }
  await dm.context().close();
  await p1.context().close();
});
