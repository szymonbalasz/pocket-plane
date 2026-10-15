// e2e-bundle: character-sheet-full
// Party at a glance (CAMP §13 walkthrough 9–11, N3): the DM's Players panel lists each player's
// characters with Lvl / AC / HP / PP / Inv / Ins; a player's edit shows ≤ 1 s; a line opens the
// sheet. Players have no Players window. View-model cases: bun test (party-lines).
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { launcherButton, openWindow, shellWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

test("FR-CAMP-21 FR-CAMP-22 party lines: values, live edit, click opens the sheet; DM only", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const miraId = recordId("char-mira", "entity");
  const selaId = recordId("char-sela", "entity");
  const thornId = recordId("char-thorn", "entity");
  const pipId = recordId("char-pip", "entity");
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const p2 = await rolePage(browser);
  await p2.goto(link("Player 2"));
  await live(p2);

  const panel = await openWindow(dm, "camp.players");
  const line = (id: string) =>
    panel.locator(`[data-testid="camp-player-char"][data-record-id="${id}"]`);
  const cell = (id: string, what: string) => line(id).getByTestId(`camp-player-char-${what}`);

  // Mira: PP from the override; Pip: no scores → "—"; Sela marked Draft.
  await expect(cell(miraId, "level")).toHaveText("1");
  await expect(cell(miraId, "ac")).toHaveText("16");
  await expect(cell(miraId, "pp")).toHaveText("14");
  await expect(cell(miraId, "pp")).toHaveAttribute("data-overridden", "true");
  await expect(cell(pipId, "pp")).toHaveText("—");
  await expect(line(selaId).getByTestId("camp-player-char-draft")).toBeVisible();
  await expect(line(thornId).getByTestId("camp-player-char-draft")).toHaveCount(0);

  // Player 2 raises Sela's WIS by 2 → PP and Ins +1 on the DM's line ≤ 1 s.
  const ppBefore = Number(await cell(selaId, "pp").textContent());
  const insBefore = Number(await cell(selaId, "ins").textContent());
  const sheet2 = await openWindow(p2, "char.sheet");
  await expect(sheet2.getByTestId("char-sheet")).toHaveAttribute("data-record-id", selaId);
  await sheet2.getByTestId("charx-edit-toggle").click();
  const wis = sheet2.locator('[data-testid="charx-field"][data-value="abilities.wis"]');
  const w = Number(await wis.inputValue());
  await wis.fill(String(w + 2));
  await wis.press("Enter");
  await expect(cell(selaId, "pp")).toHaveText(String(ppBefore + 1), { timeout: 1000 });
  await expect(cell(selaId, "ins")).toHaveText(String(insBefore + 1));

  // Click Thorn's line → the DM's sheet opens on Thorn.
  await line(thornId).click();
  const sheet = shellWindow(dm, "char.sheet");
  await expect(sheet.getByTestId("char-sheet")).toHaveAttribute("data-record-id", thornId);

  // Players: no Players window in the launcher.
  await expect(launcherButton(p2, "camp.players")).toHaveCount(0);

  for (const page of [p2, dm]) await page.context().close();
});
