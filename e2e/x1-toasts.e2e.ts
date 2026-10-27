// e2e-bundle: x1-toasts-e2e
// Thin X1 flows (sprint 12, BL-118 / BL-119 / BL-120) on session-sim-13 (sim-12's pending cards:
// the DM's "N pending actions" summary, a started fight). sim-15 FAIL c: DM 1440×900 (and
// 1280×720), Reset, Party Manager at 424, 60, Player 1 "Attack + damage" → the DM stack is drawn
// in one state per arriving card and the open roll popup moves at most once (frame-by-frame rAF
// samples). sim-15 glitch 2: 1280×720, Roll requests at 504, 60 → the stack keeps off every
// request card's heading. sim-15 glitch 3: a card put off with "Later" counts in the summary;
// summary + cards drawn = Initiative's "Pending (n)".
// Rules: bun test (`settle.test.ts`, `keep-out-primary.test.ts`, combat-tracker `pending.test.ts`).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { pickSelect } from "./support/select";
import { openWindow } from "./support/shell";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * One rAF sample on the DM page: the stack as drawn, its cards, the roll-popup column's left,top (its
 * newest card: older ones move down as newer ones arrive above them) and each popup's top.
 */
interface Frame {
  t: number;
  stack: string | null;
  cards: number;
  summary: string | null;
  text: string;
  /** What the stack holds: pending actions (summary, waiting, cards, "+N more") and other toasts. */
  holds: string;
  column: string | null;
  popups: Record<string, number>;
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

/** Drags `handle` by (dx, dy) in steps (a window's title bar). */
async function dragBy(page: Page, handle: Locator, dx: number, dy: number) {
  const t = await box(handle);
  const grab = { x: t.x + 40, y: t.y + Math.min(t.h / 2, 12) };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + dx, grab.y + dy, { steps: 6 });
  await page.mouse.up();
}

/** Moves the window `win` to (x, y) by its title bar. */
async function moveTo(page: Page, win: Locator, x: number, y: number) {
  const at = await box(win);
  await dragBy(page, win.getByTestId("ui-window-title"), x - at.x, y - at.y);
  await expect.poll(async () => Math.round((await box(win)).x)).toBe(x);
}

/** The stack holds still: the same rect for 400 ms. */
async function settled(page: Page) {
  await expect
    .poll(async () => {
      const a = await box(page.getByTestId("note-toasts"));
      await page.waitForTimeout(400);
      const b = await box(page.getByTestId("note-toasts"));
      return a.x === b.x && a.y === b.y && a.h === b.h;
    })
    .toBe(true);
}

async function setup(browser: Parameters<typeof rolePage>[0], width: number, height: number) {
  const env = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width, height });
  await loginDm(dm, env.secret);
  await live(dm);
  await dm.getByTestId("ui-launcher-menu").click();
  await dm.getByTestId("ui-launcher-reset").click();
  await expect(dm.getByTestId("note-toast-pending-summary")).toBeVisible();
  const player = await rolePage(browser);
  await player.setViewportSize({ width, height });
  await player.goto(env.link("Player 1"));
  await live(player);
  // sim-12's shown handout greets Player 1: closed first.
  const present = player.getByTestId("party-present-popup");
  const shown = await present.waitFor({ timeout: 3_000 }).then(
    () => true,
    () => false,
  );
  if (shown) {
    await present.getByTestId("party-present-close").click();
    await expect(present).toHaveCount(0);
  }
  const sheet = await openWindow(player, "char.sheet");
  await sheet.locator('[data-testid="charx-tab"][data-value="actions"]').click();
  return { dm, player, sheet };
}

/** Starts sampling the DM's stack and roll popups once per animation frame. */
async function startSampling(dm: Page) {
  await dm.evaluate(() => {
    const w = window as unknown as { __x1: Frame[]; __x1On: boolean };
    w.__x1 = [];
    w.__x1On = true;
    const tick = () => {
      if (!w.__x1On) return;
      const s = document.querySelector('[data-testid="note-toasts"]');
      const r = s?.getBoundingClientRect();
      const popups: Record<string, number> = {};
      for (const p of document.querySelectorAll('[data-testid="dicex-popup"]')) {
        const id = p.getAttribute("data-record-id");
        if (id && p.getAttribute("data-state") !== "closing")
          popups[id] = Math.round(p.getBoundingClientRect().top);
      }
      w.__x1.push({
        t: performance.now(),
        stack: r ? [r.left, r.top, r.width, r.height].map(Math.round).join(",") : null,
        cards: s?.querySelectorAll('[data-testid="note-toast"]').length ?? 0,
        summary:
          s?.querySelector('[data-testid="note-toast-pending-summary"]')?.textContent ?? null,
        text: (s?.textContent ?? "").slice(0, 120),
        holds: (() => {
          const sum = s?.querySelector('[data-testid="note-toast-pending-summary"]');
          const more = Number(
            /\d+/.exec(
              s?.querySelector('[data-testid="note-toast-more"]')?.textContent ?? "",
            )?.[0] ?? 0,
          );
          const pending =
            Number(sum?.getAttribute("data-count") ?? 0) +
            Number(sum?.getAttribute("data-waiting") ?? 0) +
            (s?.querySelectorAll('[data-testid="note-toast"][data-class="card"]').length ?? 0) +
            more;
          const other = [...(s?.children ?? [])]
            .filter((c) => c.getAttribute("data-class") && c.getAttribute("data-class") !== "card")
            .map((c) => c.getAttribute("data-class"));
          return `${pending} ${other.join(",")}`;
        })(),
        column: (() => {
          const col = document.querySelector('[data-testid="dicex-popup"]')?.parentElement;
          const c = col?.getBoundingClientRect();
          return c ? `${Math.round(c.left)},${Math.round(c.top)}` : null;
        })(),
        popups,
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function stopSampling(dm: Page): Promise<Frame[]> {
  return dm.evaluate(() => {
    const w = window as unknown as { __x1: Frame[]; __x1On: boolean };
    w.__x1On = false;
    return w.__x1;
  });
}

/** The consecutive distinct values of `of` over the frames (a value repeated later counts again). */
function runs<T>(frames: Frame[], of: (f: Frame) => T): T[] {
  const out: T[] = [];
  for (const f of frames) {
    const v = of(f);
    if (out.length === 0 || JSON.stringify(out[out.length - 1]) !== JSON.stringify(v)) out.push(v);
  }
  return out;
}

const pendingCount = async (init: Locator) => {
  const text = (await init.getByText(/^Pending \(\d+\)$/).textContent()) ?? "";
  return Number(/\((\d+)\)/.exec(text)?.[1] ?? "0");
};

for (const [width, height] of [
  [1440, 900],
  [1280, 720],
] as const) {
  test(`BL-118 FR-NOTE-77 sim-15 c DM ${width}×${height}: each arriving damage card draws the stack in one state and moves the roll popup at most once (rAF samples)`, async ({
    browser,
  }) => {
    const { dm, player, sheet } = await setup(browser, width, height);
    const board = await openWindow(dm, "party.board");
    await moveTo(dm, board, 424, 60);
    const init = await openWindow(dm, "cbt.initiative");
    await settled(dm);
    for (let i = 0; i < 2; i++) {
      const before = await pendingCount(init);
      await startSampling(dm);
      await sheet.getByTestId("charx-roll-attack-damage").first().click();
      await expect.poll(() => pendingCount(init)).toBe(before + 1);
      // The dice land and the popup's rows fill in; the fold has long settled.
      // The dice land and the popups rest (X1 walkthrough 1: the column moved at its rest, 2.2 s
      // after the card).
      await dm.waitForTimeout(3500);
      const frames = await stopSampling(dm);
      // rAF runs slow in a loaded headless browser (~15 fps): a few frames per arrival suffice.
      expect(frames.length).toBeGreaterThan(10);
      // The card's arrival: the first frame the stack shows one more pending action (a card or
      // the summary's count).
      const first = frames[0] as Frame;
      const arrived = frames.findIndex(
        (f) => f.cards !== first.cards || f.summary !== first.summary,
      );
      expect(arrived, "the card never reached the stack").toBeGreaterThan(0);
      const after = frames.slice(arrived);
      const stacks = runs(after, (f) => f.stack);
      const cards = runs(after, (f) => [f.cards, f.summary]);
      const report = JSON.stringify({
        before: runs(frames.slice(0, arrived), (f) => [f.stack, f.text]),
        after: runs(after, (f) => [f.stack, f.text]),
      });
      // From its first frame the stack is drawn in its final state (BL-118: 4–5 within ~85 ms):
      // it changes only when what it holds changes (an alert after it is its own arrival).
      for (const run of runs(after, (f) => f.holds)) {
        const of = after.filter((f) => f.holds === run);
        expect(runs(of, (f) => f.stack).length, `${run} ${report}`).toBe(1);
        expect(runs(of, (f) => [f.cards, f.summary]).length, `${run} ${report}`).toBe(1);
      }
      expect(stacks.length, report).toBeLessThanOrEqual(runs(after, (f) => f.holds).length);
      expect(cards.length, report).toBeLessThanOrEqual(runs(after, (f) => f.holds).length);
      // The roll-popup column holds its spot once it shows, or moves once (BL-118: 166 → 482 →
      // 388 → 294 → 166).
      const shown = frames.filter((f) => f.column !== null);
      expect(shown.length, report).toBeGreaterThan(0);
      const column = runs(shown, (f) => f.column);
      const timeline = runs(frames, (f) => [f.stack, f.column, f.popups]);
      // One move per real change at most: a stack change (the card; an alert coming or going)
      // or a popup arriving or leaving.
      const ids = (x: Frame) => Object.keys(x.popups).sort().join();
      const changes = frames.filter((f, k) => {
        const p = frames[k - 1];
        return p !== undefined && (p.holds !== f.holds || ids(p) !== ids(f));
      }).length;
      expect(column.length, JSON.stringify(timeline)).toBeLessThanOrEqual(changes + 1);
      // It moves only in a frame where a popup arrived or left or the stack changed, never on a
      // popup's own rolling → rest.
      for (const [k, f] of frames.entries()) {
        const p = frames[k - 1];
        if (!p || p.column === null || f.column === null || p.column === f.column) continue;
        expect(p.holds !== f.holds || ids(p) !== ids(f), JSON.stringify(timeline)).toBe(true);
      }
      // The resting stack keeps clear of the popups (FR-DICEX-55). Read in one go: the first
      // card's popup ends its 6 s (FR-DICEX-39) about now, so it may leave between two reads.
      const stack = await box(dm.getByTestId("note-toasts"));
      const popupBoxes = await dm.getByTestId("dicex-popup").evaluateAll((ps) =>
        ps.map((p) => {
          const r = p.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        }),
      );
      for (const p of popupBoxes) expect(overlaps(stack, p)).toBe(false);
    }
    await player.context().close();
    await dm.context().close();
  });
}

test("BL-120 FR-NOTE-15 FR-CBT-79 sim-15 c07: a card put off with Later counts in the summary; summary + cards drawn = Pending (n)", async ({
  browser,
}) => {
  const { dm, player, sheet } = await setup(browser, 1440, 900);
  const init = await openWindow(dm, "cbt.initiative");
  const summary = dm.getByTestId("note-toast-pending-summary");
  const drawn = dm
    .getByTestId("note-toasts")
    .locator('[data-testid="note-toast"][data-class="card"]');
  const onStack = async () =>
    Number(await summary.getAttribute("data-count")) +
    Number(await summary.getAttribute("data-waiting")) +
    (await drawn.count());
  await settled(dm);
  const before = await pendingCount(init);
  // sim-12's DM rows outside the fight count in the summary only: the difference stays.
  const base = (await onStack()) - before;
  for (let i = 1; i <= 2; i++) {
    await sheet.getByTestId("charx-roll-attack-damage").first().click();
    await expect.poll(() => pendingCount(init)).toBe(before + i);
  }
  await settled(dm);
  await expect.poll(onStack).toBe(base + before + 2);
  // The newest card's popup from its Pending row (its toast hides, FR-NOTE-26), then Later.
  const card = init.getByTestId("cbt-init-card").last();
  const id = (await card.getAttribute("data-record-id")) as string;
  await card.click();
  const popup = dm.getByTestId("cbt-popup");
  await expect(popup).toHaveAttribute("data-record-id", id);
  // While its popup is open, the popup shows it: the stack counts the rest.
  await expect.poll(onStack).toBe(base + before + 1);
  await popup.getByTestId("cbt-popup-later").click();
  await expect(popup).toHaveCount(0);
  // Later: no toast of its own again, counted in the summary (sim-15: counted nowhere).
  await expect(dm.locator(`[data-testid="note-toast"][data-record-id="${id}"]`)).toHaveCount(0);
  await expect.poll(onStack).toBe(base + before + 2);
  expect(await pendingCount(init)).toBe(before + 2);
  await expect(summary).toContainText(`${await summary.getAttribute("data-count")} pending`);
  // Clean up: dismiss the two cards from the Pending list.
  for (let i = 2; i > 0; i--) {
    await init.getByTestId("cbt-init-card").last().click();
    await dm.getByTestId("cbt-popup-dismiss").click();
    await expect.poll(() => pendingCount(init)).toBe(before + i - 1);
  }
  await player.context().close();
  await dm.context().close();
});

/** Sends a public request for every PC with the Roll requests composer. */
async function sendRequest(requests: Locator, roll: string) {
  const fold = requests.getByTestId("dicex-request-fold");
  if ((await fold.getAttribute("data-state")) !== "open") await fold.click();
  await pickSelect(requests, "dicex-request-roll", { label: roll });
  await requests.getByTestId("dicex-request-all").click({ timeout: 5_000 });
  await requests.getByTestId("dicex-request-send").click({ timeout: 5_000 });
}

test("BL-119 FR-NOTE-78 sim-15 c01 DM 1280×720: Roll requests at 504, 60 with two cards → the stack is off every card's heading, the older one's too", async ({
  browser,
}) => {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1280, height: 720 });
  await loginDm(dm, secret);
  await live(dm);
  await dm.getByTestId("ui-launcher-menu").click();
  await dm.getByTestId("ui-launcher-reset").click();
  await expect(dm.getByTestId("note-toast-pending-summary")).toBeVisible();
  const requests = await openWindow(dm, "dicex.requests");
  await moveTo(dm, requests, 504, 60);
  const cards = requests.getByTestId("dicex-request-card");
  const before = await cards.count();
  // sim-15 c01: both requests answered (the DM rolls for the missing PCs): cards without buttons.
  for (const [i, roll] of ["Perception", "Insight"].entries()) {
    await sendRequest(requests, roll);
    await expect(cards).toHaveCount(before + i + 1);
    await cards.first().getByTestId("dicex-request-missing").click();
    await expect(cards.first()).not.toHaveAttribute("data-state", "open");
  }
  // The DM's own roll popups (6 s, over the windows by design, #348) closed.
  const closePopup = dm.locator(
    '[data-testid="dicex-popup"]:not([data-state="closing"]) [data-testid="dicex-popup-close"]',
  );
  while ((await closePopup.count()) > 0) await closePopup.first().click();
  await expect(dm.getByTestId("dicex-popup")).toHaveCount(0);
  await settled(dm);
  const stack = await box(dm.getByTestId("note-toasts"));
  // Every drawn card's title line (its first child): clear of the stack and hit-testable.
  for (const card of (await cards.all()).slice(0, 2)) {
    const title = card.locator(":scope > *").first();
    const drawn = await title.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const body = el.closest('[data-testid="ui-window-body"]')?.getBoundingClientRect();
      return !!body && r.top >= body.top && r.bottom <= body.bottom;
    });
    if (!drawn) continue;
    expect(overlaps(stack, await box(title)), JSON.stringify(stack)).toBe(false);
    const hit = await title.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return at && (el === at || el.contains(at)) ? "" : (at?.outerHTML.slice(0, 160) ?? "none");
    });
    expect(hit).toBe("");
  }
  await dm.context().close();
});

test("BL-120 FR-NOTE-26 X1 walkthrough 3 DM 1440×900: Party Manager open (folded), a snapshot card's popup from Pending → the popup's card counts once", async ({
  browser,
}) => {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  await dm.getByTestId("ui-launcher-menu").click();
  await dm.getByTestId("ui-launcher-reset").click();
  const summary = dm.getByTestId("note-toast-pending-summary");
  await expect(summary).toBeVisible();
  await openWindow(dm, "party.board");
  const init = await openWindow(dm, "cbt.initiative");
  const drawn = dm
    .getByTestId("note-toasts")
    .locator('[data-testid="note-toast"][data-class="card"]');
  const onStack = async () =>
    Number(await summary.getAttribute("data-count")) +
    Number(await summary.getAttribute("data-waiting")) +
    (await drawn.count());
  await settled(dm);
  const pending = await pendingCount(init);
  const base = (await onStack()) - pending;
  // The oldest card: in the snapshot, counted in the summary (no toast of its own).
  const card = init.getByTestId("cbt-init-card").first();
  const id = (await card.getAttribute("data-record-id")) as string;
  await expect(dm.locator(`[data-testid="note-toast"][data-record-id="${id}"]`)).toHaveCount(0);
  await card.click();
  const popup = dm.getByTestId("cbt-popup");
  await expect(popup).toHaveAttribute("data-record-id", id);
  // The popup shows it: the stack counts the rest (walkthrough: 13 + 1 + popup = 15 vs 14).
  await expect.poll(onStack).toBe(base + pending - 1);
  await settled(dm);
  expect(await onStack()).toBe(base + pending - 1);
  await popup.getByTestId("cbt-popup-later").click();
  await expect(popup).toHaveCount(0);
  await expect.poll(onStack).toBe(base + pending);
  await dm.context().close();
});
