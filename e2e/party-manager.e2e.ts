// e2e-bundle: pm-memory-e2e
// Sprint 9 PM2 (party-board FR-PARTY-59–64, play-shell FR-SHELL-155–157; walkthrough M0, M1, M13):
// the launcher says "Party Manager" and has no "Party status" button; Party Manager opens on the
// Party status tab, 600 wide where that fits (BL-106; ≥ 440 otherwise), with each owner's companions under
// their PC (Owlbear under Mira, the Drake under Brakka); an old layout with `party.summary` open
// loads Party Manager open on Party status and is written without `party.summary`. Rows per viewer
// and visibility: bun test (`status-tab.test.tsx`, `party-manager.test.ts`).
import { type Browser, expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, rolePage } from "./support/env";
import { launcherButton, openWindow, shellWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

async function player(browser: Browser, name: string, w: number, h: number): Promise<Page> {
  const { link } = e2eEnv();
  const page = await rolePage(browser);
  await page.setViewportSize({ width: w, height: h });
  await page.goto(link(name));
  await live(page);
  // sim-11 presents an image to the party: close the popup first.
  const popup = page.getByTestId("party-present-popup");
  if (await popup.count()) {
    await page.getByTestId("party-present-close").click();
    await expect(popup).toHaveCount(0);
  }
  return page;
}

const statusTab = (win: Locator) => win.locator('[data-testid="party-tab"][data-value="status"]');

/** The group of the PC named `pc` (its row and the companions under it, FR-PARTY-61). */
const groupOf = (win: Locator, pc: string) =>
  win.getByTestId("party-companion-group").filter({
    has: win.page().getByTestId("party-summary-name").getByText(pc, { exact: true }),
  });

test("FR-PARTY-59 FR-PARTY-60 FR-PARTY-61 Party Manager: launcher label, no Party status button; opens on Party status 600 wide (BL-106; ≥ 440 where placed smaller); companions under their owners", async ({
  browser,
}) => {
  const p1 = await player(browser, "Player 1", 1280, 720);
  // The launcher entry is named "Party Manager"; in the top bar at 1280 it may show as an icon
  // (FR-SHELL-43, FR-KIT-14, DM #358), its name then in the aria-label and Tooltip.
  await expect(launcherButton(p1, "party.board")).toHaveAttribute("aria-label", "Party Manager");
  await expect(launcherButton(p1, "party.summary")).toHaveCount(0);
  await expect(shellWindow(p1, "party.summary")).toHaveCount(0);
  const win = await openWindow(p1, "party.board");
  await expect(win.getByTestId("ui-window-title")).toHaveText("Party Manager");
  await expect(statusTab(win)).toHaveAttribute("aria-selected", "true");
  const tabs = await win
    .getByTestId("party-tab")
    .evaluateAll((els) => els.map((e) => e.textContent ?? ""));
  expect(tabs).toEqual(["Party status", "Handouts", "Inventory", "Loot", "Reminders"]);
  const w = Math.round((await win.boundingBox())?.width ?? 0);
  expect(w).toBeGreaterThanOrEqual(440);
  expect(w).toBeLessThanOrEqual(600);
  // The owner's pets under their PCs, with numbers.
  const owl = groupOf(win, "Mira")
    .getByTestId("party-companion-row")
    .filter({ hasText: "Owlbear" });
  await expect(owl).toBeVisible();
  await expect(owl.getByTestId("party-companion-hp")).toHaveAttribute("data-value", /^\d+\/\d+$/);
  await expect(
    groupOf(win, "Brakka").getByTestId("party-companion-row").filter({ hasText: "Drake" }),
  ).toBeVisible();
  // Monsters never.
  for (const name of ["Goblin", "Wolf"]) {
    await expect(
      win.getByTestId("party-companion-name").getByText(name, { exact: true }),
    ).toHaveCount(0);
  }
  await p1.context().close();

  // A wide screen: 600 (BL-106).
  const wide = await player(browser, "Player 1", 1600, 900);
  const big = await openWindow(wide, "party.board");
  await expect.poll(async () => Math.round((await big.boundingBox())?.width ?? 0)).toBe(600);
  await wide.context().close();
});

test("FR-SHELL-155 FR-PARTY-64 an old layout with party.summary open loads Party Manager open on Party status; the entry is written without party.summary", async ({
  browser,
}) => {
  const p2 = await player(browser, "Player 2", 1280, 800);
  // M13's helper: rewrite this browser's stored layout as a sprint-8 page left it (a layout is
  // written on the first change: open and close Party Manager once).
  const first = await openWindow(p2, "party.board");
  await first.getByTestId("ui-window-close").click();
  await expect(first).toHaveCount(0);
  await expect
    .poll(() =>
      p2.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith("pp.layout.v1."))),
    )
    .toBe(true);
  await p2.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("pp.layout.v1.")) as string;
    const entry = JSON.parse(localStorage.getItem(key) as string) as {
      windows: { kind: string; z: number }[];
    };
    const z = Math.max(0, ...entry.windows.map((w) => w.z)) + 1;
    entry.windows = [
      ...entry.windows.filter((w) => w.kind !== "party.board" && w.kind !== "party.summary"),
      { kind: "party.summary", instance: "main", state: "open", x: 400, y: 80, w: 280, h: 260, z },
    ] as typeof entry.windows;
    localStorage.setItem(key, JSON.stringify(entry));
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith("pp.party.tab.v1.")) localStorage.removeItem(k);
    }
  });
  await p2.reload();
  await live(p2);
  const win = shellWindow(p2, "party.board");
  await expect(win).toHaveAttribute("data-state", "open");
  await expect(statusTab(win)).toHaveAttribute("aria-selected", "true");
  await expect(win.getByTestId("party-summary-row").first()).toBeVisible();
  await expect(shellWindow(p2, "party.summary")).toHaveCount(0);
  await expect
    .poll(() =>
      p2.evaluate(() => {
        const key = Object.keys(localStorage).find((k) => k.startsWith("pp.layout.v1.")) as string;
        const kinds = (
          JSON.parse(localStorage.getItem(key) as string) as { windows: { kind: string }[] }
        ).windows.map((w) => w.kind);
        return { summary: kinds.includes("party.summary"), board: kinds.includes("party.board") };
      }),
    )
    .toEqual({ summary: false, board: true });
  await p2.context().close();
});
