// e2e-bundle: kit-parity
// Kit parity K9 (polish after K6, #360) at 1440×900 in Gilt & Stone: the DM's Initiative HP bars
// on the kit's fixed 120-px track (they line up), the Pending cards as compact body-type lines;
// the Notifications headings in label type; the stat block's ability labels as small capitals.
// Player-1: the roll-request toast's Roll + Decline right of its text, Decline a small stone
// button, the time line under the text.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow, shellWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

/** Each fixed HP track's width in `win`, px (rounded). */
const trackWidths = (win: Locator) =>
  win
    .locator('[data-testid="cbt-init-row-hp"][data-track="fixed"] [data-slot="kit-hpbar-track"]')
    .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));

/** K9 walkthrough F1: one track width for the whole list, never under the readable 36 px. */
async function oneTrack(win: Locator, label: string) {
  await expect
    .poll(
      async () => {
        const w = await trackWidths(win);
        return w.length >= 2 && new Set(w).size === 1 && (w[0] ?? 0) >= 36 && (w[0] ?? 0) <= 120;
      },
      { message: `${label}: ${JSON.stringify(await trackWidths(win))}` },
    )
    .toBe(true);
}

/** Resizes a window by its handle (as useful-size.e2e.ts). */
async function resizeTo(page: Page, win: Locator, w: number, h: number) {
  const box = await win.boundingBox();
  const handle = await win.getByTestId("ui-window-resize").boundingBox();
  if (!box || !handle) throw new Error("window not shown");
  const x = handle.x + handle.width / 2;
  const y = handle.y + handle.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) {
    await page.mouse.move(x + ((w - box.width) * i) / 5, y + ((h - box.height) * i) / 5);
  }
  await page.mouse.up();
}

test("FR-KIT-25 FR-KIT-21 FR-KIT-55 FR-KIT-57 FR-KIT-103 fixed HP track, pending lines, Notifications headings, stat-block labels; the player's prompt toast", async ({
  browser,
}, testInfo) => {
  const { secret, link } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const init = await openWindow(dm, "cbt.initiative");

  // FR-KIT-25 (K6 gap 3, walkthrough F1): ONE track width for the list at 400, rows with chips
  // and temp HP included; at the DM's 320 minimum too (chips icon-only there). A folded tail is
  // inert (out of the tab order).
  await oneTrack(init, "DM 400");
  const folded = init.locator('[data-tail][data-folded="true"]').first();
  await expect(folded).toHaveAttribute("inert", "");
  // FR-KIT-21 (K6 gap 4): a pending card is one compact line in body type, not a stone button.
  const card = init.getByTestId("cbt-init-card").first();
  await expect(card).toHaveAttribute("data-slot", "init-pending");
  expect((await card.boundingBox())?.height ?? 99).toBeLessThanOrEqual(33);
  expect(await card.evaluate((e) => getComputedStyle(e).fontFamily)).toContain("Alegreya Sans");
  expect(await card.evaluate((e) => getComputedStyle(e).textTransform)).toBe("none");
  await init.screenshot({ path: testInfo.outputPath("app-initiative-k9.png") });
  const box = await init.boundingBox();
  await resizeTo(dm, init, 320, Math.round(box?.height ?? 500));
  await expect.poll(async () => Math.round((await init.boundingBox())?.width ?? 0)).toBe(320);
  await oneTrack(init, "DM 320");
  await init.screenshot({ path: testInfo.outputPath("app-initiative-320-k9.png") });

  // FR-KIT-103 (K6 gap 13): ability labels lower-cased in the small-caps label face, gold.
  const goblin = init.locator('[data-testid="cbt-init-row"]', {
    has: dm.locator('[data-testid="cbt-init-row-name"][data-value="Goblin"]'),
  });
  await goblin.hover();
  await goblin.getByTestId("cbt-init-row-menu").first().click();
  await dm.getByTestId("cbt-init-row-statblock").click();
  const sb = shellWindow(dm, "ent.statblock");
  await expect(sb).toHaveAttribute("data-state", "open");
  const label = sb.locator(
    '[data-testid="ent-statblock-ability"][data-value="str"] [data-slot="statblock-label"]',
  );
  expect(await label.evaluate((e) => getComputedStyle(e).textTransform)).toBe("lowercase");
  expect(await label.evaluate((e) => getComputedStyle(e).fontFamily)).toContain("IM Fell");
  await sb.screenshot({ path: testInfo.outputPath("app-statblock-k9.png") });

  // K6 §5: the Notifications window's rows are toast cards; the headings in label type.
  const notes = await openWindow(dm, "note.history");
  await expect(notes.getByTestId("note-history-row").first()).toHaveAttribute(
    "data-slot",
    "toast-card",
  );
  const heading = notes.locator('[data-slot="note-heading"]').first();
  expect(await heading.evaluate((e) => getComputedStyle(e).fontFamily)).toContain("IM Fell");
  await notes.screenshot({ path: testInfo.outputPath("app-notifications-k9.png") });

  // Player-1 (FR-KIT-57, K6 gap 9): the open Perception prompt re-toasts on load; Roll + Decline
  // sit right of the text, the time under the text; Decline a small stone (outline) button.
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1440, height: 900 });
  await p1.goto(link("Player 1"));
  await live(p1);
  const toast = p1.getByTestId("note-toast").filter({ has: p1.getByTestId("dicex-prompt") });
  await expect(toast).toHaveCount(1);
  const decline = toast.getByTestId("dicex-prompt-decline");
  await expect(decline).toHaveAttribute("data-variant", "outline");
  await expect(decline).toHaveAttribute("data-size", "sm");
  const text = await toast.locator('[data-testid="dicex-prompt"] > span').first().boundingBox();
  const dBox = await decline.boundingBox();
  const time = await toast.getByTestId("note-time").boundingBox();
  if (!text || !dBox || !time) throw new Error("prompt toast not laid out");
  // The text on one line (never cut short by the buttons), the time under it, Decline on the
  // time's line, right of it.
  expect(text.height).toBeLessThan(24);
  expect(time.y).toBeGreaterThanOrEqual(text.y + text.height - 1);
  expect(Math.abs(time.x - text.x)).toBeLessThan(2);
  expect(dBox.x).toBeGreaterThan(time.x + time.width);
  expect(dBox.y).toBeGreaterThanOrEqual(text.y + text.height - 1);
  await toast.screenshot({ path: testInfo.outputPath("app-prompt-toast-k9.png") });

  // Player-1's Initiative at its 280 default: one track width too.
  const pInit = await openWindow(p1, "cbt.initiative");
  await oneTrack(pInit, "player 280");
  await pInit.screenshot({ path: testInfo.outputPath("app-initiative-player-k9.png") });
});
