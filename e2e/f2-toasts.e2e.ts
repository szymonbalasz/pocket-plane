// e2e-bundle: f2-toasts-e2e
// Thin F2 flows (sprint 11, BL-108; FR-NOTE-78): the DM with sim-12's pending rows (the
// "N pending actions" summary). sim-14 e09: 1280×720, Roll requests at 504, 60 with two request
// cards → the stack is off its "New request" heading and the newest card (title and names
// hit-testable). sim-14 r02: 1440×900, a pending damage card's popup dragged over the home column
// (377, 67) → the stack is clear of the popup; its heading and damage field hit-testable.
// Walkthrough F2 1b, 2a: with live cards folded into the summary ("+N more" in its row), the
// stack stays off the composer and Loot's "Add loot" form.
// Placement rules: bun test (`keep-out-primary.test.ts`).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

async function box(l: Locator): Promise<Box> {
  const b = await l.boundingBox();
  if (!b) throw new Error("no box");
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

/** A form's controls a DM clicks (a checkbox's hidden native input left out). */
const CONTROLS = 'button, select, input:not([aria-hidden="true"])';

/** Drags `handle` by (dx, dy) in steps (a window's title bar, a popup's header). */
async function dragBy(page: Page, handle: Locator, dx: number, dy: number) {
  const t = await box(handle);
  const grab = { x: t.x + 40, y: t.y + Math.min(t.h / 2, 12) };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + dx, grab.y + dy, { steps: 6 });
  await page.mouse.up();
}

/**
 * None of `parts` drawn lies under the stack, and the centre of each hits that part (not a toast).
 */
async function clearOf(page: Page, parts: Locator) {
  // The stack settles: no fold step pending, the same spot for 400 ms.
  await expect
    .poll(async () => {
      const a = await box(page.getByTestId("note-toasts"));
      await page.waitForTimeout(400);
      const b = await box(page.getByTestId("note-toasts"));
      return a.x === b.x && a.y === b.y && a.h === b.h;
    })
    .toBe(true);
  const stack = await box(page.getByTestId("note-toasts"));
  const all = await parts.all();
  expect(all.length).toBeGreaterThan(0);
  for (const p of all) {
    // Drawn parts only: ≥ 4 × 4, centre inside its window's body (not scrolled out of it).
    const drawn = await p.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const body = el.closest('[data-testid="ui-window-body"]')?.getBoundingClientRect();
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      const inBody =
        !body || (cx > body.left && cx < body.right && cy > body.top && cy < body.bottom);
      return r.width >= 4 && r.height >= 4 && inBody;
    });
    if (!drawn) continue;
    const pb = await box(p);
    expect(overlaps(stack, pb), JSON.stringify({ stack, part: pb })).toBe(false);
    // A disabled button takes no pointer (`pointer-events: none`): only the overlap counts.
    const hit = await p.evaluate((el) => {
      if (getComputedStyle(el).pointerEvents === "none") return "";
      const r = el.getBoundingClientRect();
      const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return at && (el === at || el.contains(at))
        ? ""
        : `${el.outerHTML.slice(0, 120)} → ${at?.outerHTML.slice(0, 120)}`;
    });
    expect(hit).toBe("");
  }
}

async function dmAt(browser: Parameters<typeof rolePage>[0], width: number, height: number) {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width, height });
  await loginDm(dm, secret);
  await live(dm);
  await dm.getByTestId("ui-launcher-menu").click();
  await dm.getByTestId("ui-launcher-reset").click();
  await expect(dm.getByTestId("note-toast-pending-summary")).toBeVisible();
  return dm;
}

/**
 * The DM sends `n` test cards it owns (like damage cards) from its Notifications window, then
 * closes it: the cards fold while it's open and toast back on close (FR-NOTE-72).
 */
async function sendCards(dm: Page, n: number, tag: string) {
  const win = await openWindow(dm, "note.history");
  for (let i = 1; i <= n; i++) {
    await win.getByTestId("note-test-text").fill(`F2 ${tag} card ${i}: 6 slashing`);
    await win.getByTestId("note-test-audience").selectOption("dm");
    await win.getByTestId("note-test-owner").selectOption("dm");
    await win.getByTestId("note-test-label").fill("Apply");
    await win.getByTestId("note-test-send").click();
    await expect(
      win.getByTestId("note-history-row").filter({ hasText: `F2 ${tag} card ${i}` }),
    ).toHaveCount(1);
  }
  await win.getByTestId("ui-window-close").click();
}

/** Sends a public request for every PC with the Roll requests composer. */
async function sendRequest(requests: Locator, roll: string) {
  const fold = requests.getByTestId("dicex-request-fold");
  if ((await fold.getAttribute("data-state")) !== "open") await fold.click();
  await requests.getByTestId("dicex-request-roll").selectOption({ label: roll });
  // Short timeouts: a toast over the composer fails here, not at the test's 60 s.
  await requests.getByTestId("dicex-request-all").click({ timeout: 5_000 });
  await requests.getByTestId("dicex-request-send").click({ timeout: 5_000 });
}

test("FR-NOTE-78 BL-108 sim-14 e09 DM 1280×720: Roll requests at 504, 60 with two cards → the stack is off its 'New request' heading and the newest card", async ({
  browser,
}) => {
  const dm = await dmAt(browser, 1280, 720);
  const requests = await openWindow(dm, "dicex.requests");
  // e09: over the home column (480..800), Initiative right of it.
  const at = await box(requests);
  await dragBy(dm, requests.getByTestId("ui-window-title"), 504 - at.x, 60 - at.y);
  await expect.poll(async () => Math.round((await box(requests)).x)).toBe(504);
  await expect(dm.getByTestId("note-toast-pending-summary")).toBeVisible();
  // The composer stays clear (its heading is a primary part, its controls key parts).
  const cards = requests.getByTestId("dicex-request-card");
  const before = await cards.count();
  await sendRequest(requests, "Perception");
  await expect(cards).toHaveCount(before + 1);
  await sendRequest(requests, "Insight");
  await expect(cards).toHaveCount(before + 2);
  // Newest first: the Insight card is the window's first record.
  await expect(cards.first()).toContainText("Insight");
  await clearOf(dm, requests.locator("h3"));
  await clearOf(dm, cards.first());
  await clearOf(dm, requests.getByTestId("ui-window-title"));
  // Walkthrough F2 1b: two live cards fold into the summary; the stack stays off the composer.
  await sendCards(dm, 2, "1b");
  await expect(requests).toHaveAttribute("data-state", "open");
  await clearOf(dm, requests.getByTestId("dicex-request-composer").locator(CONTROLS));
  await clearOf(dm, cards.first());
  await dm.context().close();
});

test("FR-NOTE-78 walkthrough F2 2a DM 1440×900: Party Manager Loot at 424, 60 with two live cards → the stack is off the wallets, the headings and every Loot control", async ({
  browser,
}) => {
  const dm = await dmAt(browser, 1440, 900);
  await sendCards(dm, 2, "2a");
  const board = await openWindow(dm, "party.board");
  await board.locator('[data-testid="party-tab"][data-value="loot"]').click();
  const loot = board.getByTestId("loot-log");
  await loot.waitFor({ state: "visible" });
  const at = await box(board);
  await dragBy(dm, board.getByTestId("ui-window-title"), 424 - at.x, 60 - at.y);
  await expect.poll(async () => Math.round((await box(board)).x)).toBe(424);
  await expect(dm.getByTestId("note-toast-pending-summary")).toBeVisible();
  await clearOf(dm, board.getByTestId("loot-wallet"));
  await clearOf(dm, loot.locator("h3"));
  await clearOf(dm, loot.getByTestId("loot-split-open"));
  await clearOf(dm, loot.getByTestId("loot-add").locator(CONTROLS));
  await clearOf(dm, loot.getByTestId("loot-move").locator(CONTROLS));
  await dm.context().close();
});

test("FR-NOTE-78 BL-108 sim-14 r02 DM 1440×900: a damage card's popup dragged over the home column → the stack keeps clear of it; its heading and damage field hit-testable", async ({
  browser,
}) => {
  const dm = await dmAt(browser, 1440, 900);
  const init = await openWindow(dm, "cbt.initiative");
  // A pending card in Initiative → its popup (FR-CBT-55).
  const card = init.getByTestId("cbt-init-card").first();
  await expect(card).toBeVisible();
  await card.click();
  const popup = dm.getByTestId("cbt-popup");
  await expect(popup).toBeVisible();
  // r02: its top-left at 377, 67, over the stack's home (560..880).
  const at = await box(popup);
  await dragBy(dm, popup.getByTestId("cbt-popup-drag"), 377 - at.x, 67 - at.y);
  await expect.poll(async () => Math.round((await box(popup)).x)).toBe(377);
  await expect(dm.getByTestId("note-toast-pending-summary")).toBeVisible();
  await clearOf(dm, popup.locator("h2"));
  await clearOf(dm, popup.getByTestId("cbt-popup-damage"));
  expect(overlaps(await box(dm.getByTestId("note-toasts")), await box(popup))).toBe(false);
  await popup.getByTestId("cbt-popup-later").click();
  await expect(popup).toHaveCount(0);
  await dm.context().close();
});
