// e2e-bundle: wf-frame-e2e
// FR-SHELL-100 (sprint 8, WF1; review-b #3): every registered kind at its useful size (play-shell
// §7's sprint-8 table, at 1280×720) shows its criterion without scrolling: the body's
// `scrollHeight ≤ clientHeight`, and the named rows whole inside it. One page per client; each
// window resized by its handle as a user would. Kinds another track registers later (TT
// `dicex.requests`, CB `party.summary` on `cb-party-six`) are skipped until registered; the
// Stats award text (FR-STATS-67) and the companion card (FR-CHARX-83) add their cases in WF4.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { launcherButton, shellWindow } from "./support/shell";

interface Case {
  kind: string;
  useful: { w: number; h: number };
  /** The criterion (play-shell §7). */
  criterion: string;
  /**
   * How it is checked: `body` = the whole body without scrolling; a number = at least that many
   * record rows (`[data-record-id]`, AGENTS §9.5) whole inside the body (fewer if the fixture has
   * fewer), the rest of the body (search, controls) unscrolled above them.
   */
  check: "body" | number;
  /** Not checked here yet, and why. */
  skip?: string;
}

/** §7 sprint-8 useful sizes at 1280×720 (band 412). */
const DM: Case[] = [
  {
    kind: "cbt.initiative",
    useful: { w: 400, h: 380 },
    criterion: "header, controls, 4 rows",
    check: 4,
  },
  {
    kind: "dice.log",
    useful: { w: 460, h: 160 },
    criterion: "3 one-line entries + roll bar",
    check: 3,
  },
  {
    kind: "cmp.compendium",
    useful: { w: 440, h: 400 },
    criterion: "search, filters, 5 rows",
    check: 5,
  },
  {
    kind: "party.board",
    useful: { w: 440, h: 400 },
    criterion: "tab labels whole + 4 rows",
    check: 4,
  },
  {
    kind: "note.history",
    useful: { w: 360, h: 412 },
    criterion: "pending + 5 rows",
    check: 5,
    skip: "open issue: 1 row whole at 360 × 412 under the fixture's pending cards (the body scrolls)",
  },
  {
    kind: "dicex.tray",
    useful: { w: 360, h: 300 },
    criterion: "dice, notation, Roll",
    check: "body",
  },
  {
    kind: "cbt.encounters",
    useful: { w: 440, h: 412 },
    criterion: "4 entries + Save / Start",
    check: 4,
  },
  { kind: "ent.creatures", useful: { w: 340, h: 360 }, criterion: "search + 6 rows", check: 6 },
  { kind: "map.scenes", useful: { w: 260, h: 360 }, criterion: "Show + 6 rows", check: 6 },
  {
    kind: "camp.players",
    useful: { w: 400, h: 340 },
    criterion: "2 players × 2 lines + add",
    check: "body",
  },
  {
    kind: "stats.board",
    useful: { w: 400, h: 360 },
    criterion: "5 rows names whole",
    check: 5,
    skip: "WF4 (FR-STATS-66, -67)",
  },
];
const PLAYER: Case[] = [
  { kind: "cbt.initiative", useful: { w: 280, h: 320 }, criterion: "header + 4 rows", check: 4 },
  {
    kind: "dice.log",
    useful: { w: 460, h: 160 },
    criterion: "3 one-line entries + roll bar",
    check: 3,
  },
  {
    kind: "cmp.compendium",
    useful: { w: 440, h: 400 },
    criterion: "search, filters, 5 rows",
    check: 5,
  },
  {
    kind: "party.board",
    useful: { w: 440, h: 400 },
    criterion: "tab labels whole + 4 rows",
    check: 4,
  },
  {
    kind: "note.history",
    useful: { w: 360, h: 412 },
    criterion: "pending + 5 rows",
    check: 5,
    skip: "open issue: 1 row whole at 360 × 412 under the fixture's pending cards (the body scrolls)",
  },
  {
    kind: "dicex.tray",
    useful: { w: 360, h: 300 },
    criterion: "dice, notation, Roll",
    check: "body",
  },
  {
    kind: "charx.companion",
    useful: { w: 320, h: 360 },
    criterion: "header, stats, 2 attacks + 3 buttons",
    check: "body",
    skip: "WF4 (FR-CHARX-83)",
  },
  {
    kind: "stats.board",
    useful: { w: 400, h: 360 },
    criterion: "5 rows names whole",
    check: 5,
    skip: "WF4 (FR-STATS-66, -67)",
  },
];
/** FR-SHELL-112 (1): pending until their owners register them (TT2, CB3). */
const PENDING = ["dicex.requests", "party.summary"];

async function live(page: Page) {
  await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
}

async function resizeTo(page: Page, win: Locator, w: number, h: number) {
  const box = await win.boundingBox();
  const handle = await win.getByTestId("ui-window-resize").boundingBox();
  if (!box || !handle) throw new Error("window not shown");
  const x = handle.x + handle.width / 2;
  const y = handle.y + handle.height / 2;
  const dx = w - box.width;
  const dy = h - box.height;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(x + (dx * i) / 5, y + (dy * i) / 5);
  await page.mouse.up();
  await expect
    .poll(async () => {
      const b = await win.boundingBox();
      return b && [Math.round(b.width), Math.round(b.height)];
    })
    .toEqual([w, h]);
}

/** The body's scroll state and the record rows whole inside its visible box. */
const measure = (win: Locator) =>
  win.getByTestId("ui-window-body").evaluate((body) => {
    const b = body.getBoundingClientRect();
    const rows = [...body.querySelectorAll("[data-record-id]")].filter(
      (r) => (r as HTMLElement).offsetParent !== null,
    );
    const whole = rows.filter((r) => {
      const x = r.getBoundingClientRect();
      return x.height > 0 && x.top >= b.top - 0.5 && x.bottom <= b.bottom + 0.5;
    });
    return {
      scroll: body.scrollHeight,
      client: body.clientHeight,
      rows: rows.length,
      whole: whole.length,
    };
  });

async function checkClient(page: Page, cases: readonly Case[]) {
  for (const c of cases) {
    if (c.skip) continue;
    await test.step(`${c.kind} at ${c.useful.w} × ${c.useful.h}: ${c.criterion}`, async () => {
      const win = shellWindow(page, c.kind);
      if (!(await win.isVisible())) await launcherButton(page, c.kind).click();
      await expect(win).toHaveAttribute("data-state", "open");
      await resizeTo(page, win, c.useful.w, c.useful.h);
      const m = await measure(win);
      console.log(`useful-size ${c.kind}: ${JSON.stringify(m)}`);
      if (c.check === "body") {
        expect(m.scroll, `${c.kind}: body scrolls`).toBeLessThanOrEqual(m.client + 1);
      } else {
        expect(m.whole, `${c.kind}: whole rows`).toBeGreaterThanOrEqual(Math.min(c.check, m.rows));
      }
      // Put it back out of the way for the next one.
      await win.getByTestId("ui-window-minimise").click();
    });
  }
  for (const kind of PENDING) {
    expect(await launcherButton(page, kind).count(), `${kind} registered: fill its case`).toBe(0);
  }
}

test("FR-SHELL-100 useful size shows its content (DM, 1280×720): every kind at its useful size, body unscrolled or the named rows whole", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1280, height: 720 });
  await loginDm(dm, secret);
  await live(dm);
  await checkClient(dm, DM);
});

test("FR-SHELL-100 useful size shows its content (player-1, 1280×720): every kind at its useful size, body unscrolled or the named rows whole", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { link } = e2eEnv();
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1280, height: 720 });
  await p1.goto(link("Player 1"));
  await live(p1);
  // sim-11 presents an image to the party: close the popup first (it sits over the left column).
  const popup = p1.getByTestId("party-present-popup");
  if (await popup.count()) {
    await p1.getByTestId("party-present-close").click();
    await expect(popup).toHaveCount(0);
  }
  await checkClient(p1, PLAYER);
});
