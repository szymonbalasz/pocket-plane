// e2e-bundle: s14-kit-e2e
// Thin sprint 14 F3 flows (kit nits; BL-138, BL-139, BL-141). The DM with sim-12's pending rows
// (the "N pending actions" summary) at 1280×720 opens the Compendium's modal homebrew dialog over
// the home column (F2 walkthrough side finding: the summary sat on its Name field): the summary
// goes compact (FR-NOTE-79) left of the dialog, off it, and the Name field takes the click.
// Placement rules: bun test (`keep-out-compact.test.ts`). The DM's sheet (BL-139): the name picker
// opens the shared Select's menu (Party heading, items by record id); the Actions tab's Attacks
// box has no public switch, the header's Public rolls menu has Attack and Damage. The token menu
// (BL-141): the token's name heads it. The roll bar (FR-DICE-22): rolling as a monster token the
// DM just hid, the public eye is off and disabled (the server's roll guard), the roll DM-only.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { konvaNodes } from "./support/konva";
import { pickRollOption } from "./support/log";
import { showToPlayers } from "./support/scenes";
import { pickSheet } from "./support/sheet";
import { openWindow } from "./support/shell";
import { storedTheme } from "./support/theme";

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

/** The element at `l`'s centre is `l` (or inside it): nothing drawn over it. */
const onTop = (l: Locator) =>
  l.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return !!at && (el === at || el.contains(at));
  });

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

test("FR-NOTE-79 FR-NOTE-76 F2 side finding DM 1280×720: the modal homebrew dialog over the home column → the summary goes compact, left of the dialog, off its Name field", async ({
  browser,
}) => {
  const dm = await dmAt(browser, 1280, 720);
  const win = await openWindow(dm, "cmp.compendium");
  await win.getByTestId("cmp-new").click();
  const form = dm.getByTestId("cmp-form");
  await expect(form).toBeVisible();
  const stack = dm.getByTestId("note-toasts");
  const summary = dm.getByTestId("note-toast-pending-summary");
  await expect(summary).toHaveAttribute("data-compact", "true");
  await expect(stack).toHaveAttribute("data-settled", "true");
  await expect
    .poll(async () => overlaps(await box(stack), await box(form)), { timeout: 3_000 })
    .toBe(false);
  const s = await box(stack);
  const f = await box(form);
  expect(s.x + s.w).toBeLessThanOrEqual(f.x);
  expect(s.x).toBeGreaterThanOrEqual(80);
  // One short line, with Open still one click away.
  expect(s.h).toBeLessThanOrEqual(44);
  await expect(summary.getByTestId("note-toast-open")).toBeVisible();
  const name = form.getByTestId("cmp-form-name");
  expect(await onTop(name)).toBe(true);
  await name.click();
  await name.fill("Lamp 7");
  await expect(name).toHaveValue("Lamp 7");
});

test("FR-CHAR-02 FR-CHARX-114 BL-139 DM sheet: the name picker is the shared Select's menu; Attack / Damage switches in the header's Public rolls menu, none in the Attacks box", async ({
  browser,
}) => {
  const { secret, recordId } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const win = await openWindow(dm, "char.sheet");
  const brakka = recordId("char-brakka", "entity");
  const mira = recordId("char-mira", "entity");
  await pickSheet(win, brakka);
  await expect(win.getByTestId("char-sheet")).toHaveAttribute("data-record-id", brakka);
  // The list is the shared Select's (no native select anywhere in the sheet).
  await expect(win.locator("select[data-testid=char-sheet-picker]")).toHaveCount(0);
  await win.getByTestId("char-sheet-picker").click();
  const menu = dm.locator('[data-slot="select-content"]');
  await expect(menu).toBeVisible();
  await expect(
    menu
      .locator('[data-testid="char-sheet-picker-option"]')
      .and(dm.locator(`[data-value="${mira}"]`)),
  ).toBeVisible();
  await dm.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await pickSheet(win, mira);
  await expect(win.getByTestId("char-sheet")).toHaveAttribute("data-record-id", mira);

  // Actions tab: no switch in the Attacks box.
  await win.locator('[data-testid="charx-tab"][data-value="actions"]').click();
  await expect(win.locator('[data-testid="charx-attack"]').first()).toBeVisible();
  await expect(win.getByTestId("charx-public-attack")).toHaveCount(0);
  // The header menu: Attack and Damage after the others; flipping Attack marks the menu.
  await win.getByTestId("charx-public-menu").click();
  const attack = dm.getByTestId("charx-public-attack");
  await expect(attack).toBeVisible();
  await expect(dm.getByTestId("charx-public-damage")).toBeVisible();
  const was = await attack.getAttribute("data-state");
  await attack.click();
  await expect(attack).toHaveAttribute("data-state", was === "checked" ? "unchecked" : "checked");
  await dm.keyboard.press("Escape");
  await expect(win.getByTestId("charx-public-menu")).toHaveAttribute("data-on", "true");
});

test("BL-141 the DM's token menu: the token's name heads it, before its first item", async ({
  browser,
}) => {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  await expect.poll(async () => (await konvaNodes(dm, "map-token")).length).toBeGreaterThan(0);
  // A token drawn on open map (no window over it).
  const nodes = await konvaNodes(dm, "map-token");
  const onMap = await dm.evaluate(
    (pts) => pts.map((p) => document.elementFromPoint(p.x, p.y)?.tagName === "CANVAS"),
    nodes.map(({ x, y }) => ({ x, y })),
  );
  const t = nodes.find((_, i) => onMap[i]);
  if (!t) throw new Error("no token on open map");
  await dm.mouse.click(t.x, t.y, { button: "right" });
  const menu = dm.getByTestId("map-token-menu");
  await expect(menu).toHaveAttribute("data-record-id", t.id);
  const label = menu.getByTestId("map-token-menu-label");
  await expect(label).toBeVisible();
  await expect(label).not.toBeEmpty();
  const first = await menu.evaluate((el) =>
    el.querySelector("[data-testid]")?.getAttribute("data-testid"),
  );
  expect(first).toBe("map-token-menu-label");
  await dm.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
});

test("FR-DICE-22 FR-DICE-13 the roll bar as a hidden monster token: the public eye is off and disabled with its reason; the roll lands DM-only; as the DM again, the eye is free", async ({
  browser,
}) => {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  // Goblin Ambush shown (its monsters are the roll bar's tokens); Scenes closed again.
  const scenes = await showToPlayers(dm, "Goblin Ambush");
  await scenes.getByTestId("ui-window-close").click();
  const log = await openWindow(dm, "dice.log");
  const options = log.getByTestId("dice-roll-options");
  if ((await options.getAttribute("data-state")) !== "open") await options.click();
  // A monster token of the shown scene (the roll bar lists it) drawn on open map.
  await log.getByTestId("dice-roll-actor").click();
  const listed = await dm
    .locator('[data-testid="dice-roll-actor-option"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-value") ?? ""));
  await dm.keyboard.press("Escape");
  await expect.poll(async () => (await konvaNodes(dm, "map-token")).length).toBeGreaterThan(0);
  const nodes = (await konvaNodes(dm, "map-token")).filter((n) => listed.includes(n.id));
  const onMap = await dm.evaluate(
    (pts) => pts.map((p) => document.elementFromPoint(p.x, p.y)?.tagName === "CANVAS"),
    nodes.map(({ x, y }) => ({ x, y })),
  );
  const t = nodes.find((_, i) => onMap[i]);
  if (!t) throw new Error("no listed token on open map");
  await pickRollOption(log, "dice-roll-actor", t.id);
  const eye = log.getByTestId("dice-roll-public");
  await expect(eye).not.toHaveAttribute("data-guarded", "true");
  await dm.mouse.click(t.x, t.y, { button: "right" });
  await dm.getByTestId("map-token-menu-hide").click();
  await expect(eye).toHaveAttribute("data-guarded", "true");
  await expect(eye).toHaveAttribute("aria-disabled", "true");
  await expect(eye).toHaveAttribute("data-state", "hidden");
  await expect(eye).toHaveAttribute("aria-label", /hidden from players or renamed/);
  // A click changes nothing; the roll is DM-only (the server's guard).
  await eye.click({ force: true });
  await expect(eye).toHaveAttribute("data-state", "hidden");
  const entries = log.getByTestId("dice-log-entry");
  const before = await entries.count();
  await log.getByTestId("dice-roll-expression").fill("1d4");
  await log.getByTestId("dice-roll-submit").click();
  await expect(entries).toHaveCount(before + 1);
  await expect(entries.last()).toHaveAttribute("data-public", "false");
  // Rolling as the DM again: the eye is the DM's to set.
  await pickRollOption(log, "dice-roll-actor", "");
  await expect(eye).not.toHaveAttribute("data-guarded", "true");
  await expect(eye).not.toHaveAttribute("aria-disabled", "true");
});

interface ChildRow {
  name: string;
  h: number;
  track: string;
  statsRows: number;
  afterCut: boolean;
}

/** Child rows (after-owner) of the Initiative window `win`: name, height, stats-line rows, fits. */
function childRows(win: Locator): Promise<ChildRow[]> {
  return win.evaluate((w) =>
    [...w.querySelectorAll<HTMLElement>('[data-testid="cbt-init-row"][data-indent="true"]')].map(
      (row) => {
        const name =
          row.querySelector<HTMLElement>('[data-testid="cbt-init-row-name"]')?.dataset.value ?? "";
        const stats = row.querySelector<HTMLElement>("[data-stats-line]");
        // Lines of the stats line: a part starts a new one when it sits below the line before.
        // The AC / moved tail folds into the row Tooltip when it doesn't fit (FR-KIT-25).
        const boxes = [...(stats?.children ?? [])]
          .filter((k) => (k as HTMLElement).offsetWidth > 0 && !k.hasAttribute("data-tail"))
          .map((k) => k.getBoundingClientRect())
          .sort((x, y) => x.top - y.top);
        let lines = 0;
        let bottom = Number.NEGATIVE_INFINITY;
        for (const r of boxes) {
          if (r.top >= bottom - 1) lines++;
          bottom = Math.max(r.top >= bottom - 1 ? r.bottom : bottom, r.bottom);
        }
        const after = row.querySelector<HTMLElement>('[data-testid="cbt-init-row-after"]');
        const list = row.closest<HTMLElement>('[data-testid="cbt-init-list"]');
        return {
          name,
          h: Math.round(row.getBoundingClientRect().height),
          track: list ? getComputedStyle(list).getPropertyValue("--hp-track") : "",
          statsRows: lines,
          afterCut: after ? after.scrollWidth > after.clientWidth + 0.5 : false,
        };
      },
    ),
  );
}

test("FR-KIT-29 BL-141 walkthrough F3 3b: Owlbear and Fire Elemental (102 / 102) child rows fit on two lines with the same height in Simple Dark and Gilt & Stone — DM 1440×900 and player-1's Initiative ('After Mira' whole)", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();
  const seen: Record<string, { dm: ChildRow[]; p1: ChildRow[] }> = {};
  for (const theme of ["default", "gilt"] as const) {
    const dm = await rolePage(browser);
    await storedTheme(dm, theme);
    await dm.setViewportSize({ width: 1440, height: 900 });
    await loginDm(dm, secret);
    await live(dm);
    const init = await openWindow(dm, "cbt.initiative");
    await expect(
      init.locator('[data-testid="cbt-init-row"][data-indent="true"]').first(),
    ).toBeVisible();
    await dm.evaluate(() => document.fonts.ready);
    const p1 = await rolePage(browser);
    await storedTheme(p1, theme);
    await p1.setViewportSize({ width: 1440, height: 900 });
    await p1.goto(link("Player 1"));
    await live(p1);
    const pInit = await openWindow(p1, "cbt.initiative");
    await expect(
      pInit.locator('[data-testid="cbt-init-row"][data-indent="true"]').first(),
    ).toBeVisible();
    await p1.evaluate(() => document.fonts.ready);
    await dm.waitForTimeout(300);
    const both = { dm: await childRows(init), p1: await childRows(pInit) };
    seen[theme] = both;
    for (const r of [...both.dm, ...both.p1]) {
      expect(r.statsRows, `${theme} ${r.name} stats line`).toBe(1);
      expect(r.afterCut, `${theme} ${r.name} After cut`).toBe(false);
    }
    await dm.context().close();
    await p1.context().close();
  }
  // ADR-0069: the same row heights and the same track in both themes.
  expect(seen.default).toEqual(seen.gilt);
  const names = (seen.gilt?.dm ?? []).map((r) => r.name);
  expect(names).toEqual(expect.arrayContaining(["Owlbear", "Fire Elemental"]));
});

test("FR-KIT-29 walkthrough F3 3a: DM 1440×900 Gilt — hovering Owlbear's Ally icon (a child row with its tail folded into the row Tooltip) shows 'Ally', not the row's tail", async ({
  browser,
}) => {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await storedTheme(dm, "gilt");
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const init = await openWindow(dm, "cbt.initiative");
  const owl = init
    .locator('[data-testid="cbt-init-row"][data-indent="true"]')
    .filter({ has: dm.locator('[data-testid="cbt-init-row-name"][data-value="Owlbear"]') });
  const ally = owl.getByTestId("cbt-init-row-ally");
  await expect(ally).toHaveAttribute("data-compact", "true");
  // The row's tail is folded into its Tooltip (the walkthrough's 'AC 13 · moved 0 / 40 ft').
  await expect(owl.locator('[data-tail][data-folded="true"]')).toHaveCount(1);
  // Straight onto the icon (the first move lands on it: both Tooltips see it).
  const a = await ally.boundingBox();
  if (!a) throw new Error("no box");
  await dm.mouse.move(0, 0);
  await dm.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  const tip = dm.getByTestId("ui-tooltip");
  await expect(tip).toHaveText("Ally");
  await expect(tip).toHaveCount(1);
});
