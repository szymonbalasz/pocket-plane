// e2e-bundle: wf-frame-e2e
// FR-SHELL-100 (sprint 8, WF1; review-b #3): every registered kind at its useful size (play-shell
// §7's sprint-8 table, at 1280×720) shows its criterion without scrolling: the body's
// `scrollHeight ≤ clientHeight`, and the named rows whole inside it. One page per client; each
// window resized by its handle as a user would. PM2 `party.board` (Party Manager, FR-PARTY-63)
// checks the Party status tab on `cb-party-six` + this bundle's pets. WF4:
// Stats (FR-STATS-66, -67: the award grid fits at 400 and 320 wide) and the companion card
// (FR-CHARX-83: Owlbear and Drake at exactly 320 × 360) have their own tests below.
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
   * fewer), the rest of the body (search, controls) unscrolled above them; `all` = every counted
   * row whole (at least one).
   */
  check: "body" | number | "all";
  /** Rows counted by `check` (default: every `[data-record-id]`). */
  rows?: string;
  /** Test IDs inside each counted row that must show whole (not clipped, not cut). */
  uncut?: readonly string[];
  /** The scroll box the rows must be whole inside (default: the window body). */
  clip?: string;
  /** Tab triggers whose labels must show whole inside the window (no strip scrolling needed). */
  tabs?: string;
  /** Not checked here yet, and why. */
  skip?: string;
}

/**
 * PM2 (FR-SHELL-156, FR-PARTY-63; review-b ruling 16): Party Manager on its Party status tab at
 * the useful size: every PC row of `cb-party-six`'s party and every companion row under them
 * whole, names and figures uncut; the labels Party status, Handouts, Inventory, Loot whole.
 */
const PARTY_MANAGER: Case = {
  kind: "party.board",
  useful: { w: 440, h: 400 },
  criterion: "Party status: every PC row and its companion rows whole + 4 tab labels whole",
  check: "all",
  rows: '[data-testid="party-summary-row"], [data-testid="party-companion-row"]',
  uncut: [
    "party-summary-name",
    "party-summary-hp",
    "party-summary-temp",
    "party-summary-ac",
    "party-companion-name",
    "party-companion-hp",
    "party-companion-band",
  ],
  clip: '[data-testid="party-status"] [data-radix-scroll-area-viewport]',
  tabs: '[data-testid="party-tab"]',
};

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
  PARTY_MANAGER,
  {
    kind: "note.history",
    useful: { w: 360, h: 412 },
    // WF4 (integrator): handout rows take three lines; 412 is the band maximum.
    criterion: "pending + 3 rows",
    check: 3,
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
    // FR-STATS-66: the Fight tab (the first criterion; the award grid: FR-STATS-67 below).
    criterion: "5 rows names whole",
    check: 5,
  },
  {
    kind: "dicex.requests",
    useful: { w: 360, h: 400 },
    // wf-frame-e2e has no request: the composer and the empty list, body unscrolled.
    criterion: "composer folded + a 6-row card",
    check: "body",
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
  PARTY_MANAGER,
  {
    kind: "note.history",
    useful: { w: 360, h: 412 },
    // WF4 (integrator): handout rows take three lines; 412 is the band maximum.
    criterion: "pending + 3 rows",
    check: 3,
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
    // FR-CHARX-83: the card open (Owlbear and Drake both: below).
    check: "body",
  },
  {
    kind: "stats.board",
    useful: { w: 400, h: 360 },
    // FR-STATS-66: the Fight tab (the first criterion; the award grid: FR-STATS-67 below).
    criterion: "5 rows names whole",
    check: 5,
  },
];
/** FR-SHELL-112 (1): pending until their owners register them (none left this sprint). */
const PENDING: string[] = [];

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

/**
 * The body's scroll state and the record rows whole inside its visible box; `cut` = the `uncut`
 * parts that are clipped (wider than shown, or outside their row / the body).
 */
const measure = (win: Locator, c?: Pick<Case, "rows" | "uncut" | "clip">) =>
  win.getByTestId("ui-window-body").evaluate(
    (body, { selector, uncut, clip }) => {
      const b = (clip ? (body.querySelector(clip) ?? body) : body).getBoundingClientRect();
      const rows = [...body.querySelectorAll(selector)].filter(
        (r) => (r as HTMLElement).offsetParent !== null,
      );
      const whole = rows.filter((r) => {
        const x = r.getBoundingClientRect();
        return x.height > 0 && x.top >= b.top - 0.5 && x.bottom <= b.bottom + 0.5;
      });
      const cut: string[] = [];
      for (const r of rows) {
        const rr = r.getBoundingClientRect();
        for (const id of uncut) {
          for (const el of r.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)) {
            const x = el.getBoundingClientRect();
            const inside =
              x.left >= Math.max(rr.left, b.left) - 0.5 &&
              x.right <= Math.min(rr.right, b.right) + 0.5 &&
              x.top >= rr.top - 0.5 &&
              x.bottom <= rr.bottom + 0.5;
            if (el.scrollWidth > el.clientWidth + 1 || !inside) {
              cut.push(`${r.getAttribute("data-record-id")} ${id}`);
            }
          }
        }
      }
      return {
        scroll: body.scrollHeight,
        client: body.clientHeight,
        rows: rows.length,
        whole: whole.length,
        cut,
      };
    },
    { selector: c?.rows ?? "[data-record-id]", uncut: c?.uncut ?? [], clip: c?.clip ?? null },
  );

async function checkClient(page: Page, cases: readonly Case[]) {
  for (const c of cases) {
    if (c.skip) continue;
    await test.step(`${c.kind} at ${c.useful.w} × ${c.useful.h}: ${c.criterion}`, async () => {
      const win = shellWindow(page, c.kind);
      if (!(await win.isVisible())) await launcherButton(page, c.kind).click();
      await expect(win).toHaveAttribute("data-state", "open");
      await resizeTo(page, win, c.useful.w, c.useful.h);
      const m = await measure(win, c);
      console.log(`useful-size ${c.kind}: ${JSON.stringify(m)}`);
      if (c.check === "body") {
        expect(m.scroll, `${c.kind}: body scrolls`).toBeLessThanOrEqual(m.client + 1);
      } else if (c.check === "all") {
        expect(m.rows, `${c.kind}: rows`).toBeGreaterThan(0);
        expect(m.whole, `${c.kind}: whole rows`).toBe(m.rows);
      } else {
        expect(m.whole, `${c.kind}: whole rows`).toBeGreaterThanOrEqual(Math.min(c.check, m.rows));
      }
      expect(m.cut, `${c.kind}: cut parts`).toEqual([]);
      if (c.tabs) {
        const w = await win.boundingBox();
        if (!w) throw new Error("window not shown");
        const tabs = await win.locator(c.tabs).evaluateAll((els) =>
          els.map((e) => {
            const r = e.getBoundingClientRect();
            return {
              label: e.textContent ?? "",
              left: r.left,
              right: r.right,
              whole: e.scrollWidth <= e.clientWidth + 1,
            };
          }),
        );
        expect(tabs.length, `${c.kind}: tabs`).toBeGreaterThan(0);
        const cutTabs = tabs.filter(
          (t) => !t.whole || t.left < w.x - 0.5 || t.right > w.x + w.width + 0.5,
        );
        expect(
          cutTabs.map((t) => t.label),
          `${c.kind}: tab labels cut`,
        ).toEqual([]);
      }
      // A named row set (CB3's 6 PCs) must all be there: the fixture loaded.
      if (c.rows && typeof c.check === "number") expect(m.rows).toBeGreaterThanOrEqual(c.check);
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

/** The player page, live, the presented image closed. */
async function playerPage(browser: import("@playwright/test").Browser): Promise<Page> {
  const { link } = e2eEnv();
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1280, height: 720 });
  await p1.goto(link("Player 1"));
  await live(p1);
  const popup = p1.getByTestId("party-present-popup");
  if (await popup.count()) {
    await p1.getByTestId("party-present-close").click();
    await expect(popup).toHaveCount(0);
  }
  return p1;
}

async function openAt(page: Page, kind: string, w: number, h: number): Promise<Locator> {
  const win = shellWindow(page, kind);
  if (!(await win.isVisible())) await launcherButton(page, kind).click();
  await expect(win).toHaveAttribute("data-state", "open");
  await resizeTo(page, win, w, h);
  return win;
}

test("FR-CHARX-83 card useful criterion: at exactly 320 × 360 the Owlbear (Beak, Claws) and the Drake (Bite) show the header, the stats line and their attack rows with all three buttons, no scrolling", async ({
  browser,
}) => {
  const p1 = await playerPage(browser);
  const win = await openAt(p1, "charx.companion", 320, 360);
  const card = win.getByTestId("charx-companion");
  for (const [name, attacks] of [
    ["Owlbear", ["Beak", "Claws"]],
    ["Drake Companion", ["Bite"]],
  ] as const) {
    await win.getByTestId("charx-companion-picker").selectOption({ label: name });
    await expect(card.getByTestId("charx-companion-name")).toHaveText(name);
    const m = await measure(win);
    console.log(`useful-size charx.companion ${name}: ${JSON.stringify(m)}`);
    expect(m.scroll, `${name}: body scrolls`).toBeLessThanOrEqual(m.client + 1);
    const body = await win.getByTestId("ui-window-body").boundingBox();
    if (!body) throw new Error("no body");
    const inside = async (l: Locator) => {
      const b = await l.boundingBox();
      return !!b && b.y >= body.y - 0.5 && b.y + b.height <= body.y + body.height + 0.5;
    };
    expect(await inside(card.getByTestId("charx-companion-name"))).toBe(true);
    expect(await inside(card.getByTestId("charx-companion-stats"))).toBe(true);
    for (const a of attacks) {
      const row = card.getByTestId("charx-companion-attack").filter({ hasText: a });
      const rolls = row.getByTestId("charx-companion-roll");
      await expect(rolls).toHaveCount(3);
      for (const r of await rolls.all()) expect(await inside(r), `${name} ${a} button`).toBe(true);
    }
  }
  await p1.context().close();
});

test("FR-STATS-66 Stats useful size FR-STATS-67 award grid fits: at 400 × 360 the Fight tab shows 5 rows with names whole; the award cards fit at 400 × 412 (2 columns) and 320 wide (1), no card's text wider than the card", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1280, height: 720 });
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await playerPage(browser);
  for (const page of [dm, p1]) {
    const win = await openAt(page, "stats.board", 400, 360);
    await win.locator('[data-testid="stats-tab"][data-value="fight"]').click();
    const rows = win.getByTestId("stats-fight-row");
    await expect(rows.first()).toBeVisible();
    const m = await measure(win);
    expect(m.whole).toBeGreaterThanOrEqual(Math.min(5, m.rows));
    // Names whole: never cut (a name wider than its cell wraps).
    for (const n of await win.getByTestId("stats-fight-name").all()) {
      expect(await n.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    }
    await win.locator('[data-testid="stats-tab"][data-value="session"]').click();
    const cards = win.getByTestId("stats-award");
    await expect(cards).toHaveCount(9);
    for (const [w, cols] of [
      [400, 2],
      [320, 1],
    ] as const) {
      await resizeTo(page, win, w, 412);
      const xs = await cards.evaluateAll((els) =>
        els.map((e) => Math.round(e.getBoundingClientRect().left)),
      );
      expect(new Set(xs).size, `${w} wide: columns`).toBe(cols);
      const over = await cards.evaluateAll((els) =>
        els.flatMap((card) =>
          [card, ...card.querySelectorAll<HTMLElement>("*")].filter(
            (e) => e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0,
          ).length > 0
            ? [card.getAttribute("data-record-id")]
            : [],
        ),
      );
      expect(over, `${w} wide: text over its card`).toEqual([]);
    }
    await win.getByTestId("ui-window-minimise").click();
  }
  for (const page of [dm, p1]) await page.context().close();
});
