// e2e-bundle: session-sim-9
// Sprint 6 WF4 (play-shell §13 F10; BL-43, sim-9 c03 / c10), thin: DM and player-1 at 1440×900.
// Goblin Ambush running (≥ 7 rows): the DM's Initiative at its default size shows "↓ N more" with
// no row painted below it or in the window body's padding, the list (not the body) scrolls, and
// scrolled to the end the footer goes and the last row is whole (FR-CBT-125). Every name whole
// and every trigger chip whole or icon-only at 400 and at the 320 min, player-1 at 280 / 240
// (FR-CBTX-57, -58). Then End, Start "Escort to the Ford": the hidden Ally "Goblin Lurker" whole
// beside its eye-off and Ally chip at 400 and 320 (c10). Runs after combat-trails.e2e.ts on the
// shared session-sim-9 server (it presses Next). Fit rules and markup: bun test (parts.test.tsx,
// below-fold.test.ts).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { launcherButton, openWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

/** Drags the window's resize corner by (dx, dy); the shell clamps to the min size. */
async function resizeBy(page: Page, win: Locator, dx: number, dy: number) {
  const h = await win.getByTestId("ui-window-resize").boundingBox();
  if (!h) throw new Error("no resize handle");
  const x = h.x + h.width / 2;
  const y = h.y + h.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(x + (dx * i) / 6, y + (dy * i) / 6);
  await page.mouse.up();
}

/** Resizes `win` to `w` px wide (`w` = its min width when narrowing). */
async function toWidth(page: Page, win: Locator, w: number) {
  const now = (await win.boundingBox())?.width ?? 0;
  // Narrowing goes past the target: the shell clamps at the min width.
  await resizeBy(page, win, w < now ? w - now - 100 : w - now, 0);
  await expect.poll(async () => Math.round((await win.boundingBox())?.width ?? 0)).toBe(w);
}

/**
 * FR-CBTX-57 / -58 on every row: names neither cut nor ellipsed nor past their line; trigger chips
 * whole (inside their chip line) or icon-only, nothing under them with `text-overflow: ellipsis`.
 */
function rowsCut(init: Locator): Promise<string[]> {
  return init.evaluate((w) => {
    const bad: string[] = [];
    for (const n of w.querySelectorAll<HTMLElement>('[data-testid="cbt-init-row-name"]')) {
      const line = n.closest("[data-name-line]") as HTMLElement;
      const a = n.getBoundingClientRect();
      const b = line.getBoundingClientRect();
      if (n.scrollWidth > n.clientWidth + 0.5 || (n.textContent ?? "").includes("…")) {
        bad.push(`name cut: ${n.dataset.value} ${n.scrollWidth}/${n.clientWidth}`);
      }
      if (a.width === 0 || a.right > b.right + 0.5) bad.push(`name out: ${n.dataset.value}`);
    }
    for (const c of w.querySelectorAll<HTMLElement>('[data-testid="cbtx-trigger-chip"]')) {
      const label = `${c.textContent} (${c.dataset.recordId})`;
      for (const el of [c, ...c.querySelectorAll<HTMLElement>("*")]) {
        if (getComputedStyle(el).textOverflow === "ellipsis") bad.push(`ellipsis: ${label}`);
      }
      if (c.scrollWidth > c.clientWidth + 0.5) bad.push(`chip cut: ${label}`);
      const a = c.getBoundingClientRect();
      const b = (c.closest("[data-chip-row]") as HTMLElement).getBoundingClientRect();
      if (a.width === 0 || a.left < b.left - 0.5 || a.right > b.right + 0.5) {
        bad.push(`chip out: ${label}`);
      }
    }
    return bad;
  });
}

/** FR-CBT-125: the list viewport, the footer under it, nothing painted below / past it. */
function viewport(init: Locator) {
  return init.evaluate((w) => {
    const list = w.querySelector<HTMLElement>('[data-testid="cbt-init-list"]') as HTMLElement;
    const footer = w.querySelector<HTMLElement>('[data-testid="cbt-init-more"]') as HTMLElement;
    const body = w.querySelector('[data-testid="ui-window-content"]')?.parentElement as HTMLElement;
    const l = list.getBoundingClientRect();
    const f = footer.getBoundingClientRect();
    const b = body.getBoundingClientRect();
    const rows = [...list.querySelectorAll<HTMLElement>('[data-testid="cbt-init-row"]')];
    // 4 px under the footer (or the list when it is absent), inside the window body.
    const y = (footer.hidden ? l.bottom : f.bottom) + 4;
    const under = y < b.bottom ? document.elementFromPoint(b.left + b.width / 2, y) : null;
    const last = rows.at(-1)?.getBoundingClientRect();
    return {
      more: footer.hidden ? 0 : Number(footer.dataset.value),
      below: rows.filter((r) => r.getBoundingClientRect().bottom > l.bottom + 1).length,
      footerUnderList: footer.hidden || f.top >= l.bottom - 0.5,
      listClips: getComputedStyle(list).overflowY !== "visible",
      bodyScrolls: body.scrollHeight > body.clientHeight + 1,
      rowUnder: !!under?.closest('[data-testid="cbt-init-row"]'),
      lastWhole: !!last && last.bottom <= l.bottom + 1,
    };
  });
}

/** Scrolls the row list to its end. */
const listToEnd = (init: Locator) =>
  init.getByTestId("cbt-init-list").evaluate((l) => {
    l.scrollTop = l.scrollHeight;
  });

const miraChip = (init: Locator) =>
  init.getByTestId("cbtx-trigger-chip").filter({ hasText: "Searing" });

test("FR-CBT-125 FR-CBTX-57 FR-CBTX-58 F10 Initiative rows: nothing below '↓ N more', names whole, trigger chips whole or icon-only; the hidden Ally 'Goblin Lurker' whole, DM and player-1", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const { secret, link, recordId } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1440, height: 900 });
  await p1.goto(link("Player 1"));
  await live(p1);
  // session-sim-9 presents the "Thieves' Map" handout to player-1 at load.
  await p1.getByTestId("party-present-close").click();

  // Ambush, DM Initiative at its default size (400 × 500, grown to its cap): c03.
  const init = await openWindow(dm, "cbt.initiative");
  await expect(init.getByTestId("cbt-init-row")).not.toHaveCount(0);
  expect(await init.getByTestId("cbt-init-row").count()).toBeGreaterThanOrEqual(7);
  await expect.poll(async () => (await viewport(init)).more).toBeGreaterThan(0);
  let v = await viewport(init);
  expect(v).toMatchObject({
    footerUnderList: true,
    listClips: true,
    bodyScrolls: false,
    rowUnder: false,
    lastWhole: false,
  });
  expect(v.more).toBe(v.below);
  await listToEnd(init);
  await expect.poll(async () => (await viewport(init)).more).toBe(0);
  v = await viewport(init);
  expect(v).toMatchObject({ lastWhole: true, bodyScrolls: false, rowUnder: false });

  // Names whole, Mira's Searing trigger whole at 400; icon-only (or whole) at 320, never cut.
  await expect.poll(() => rowsCut(init)).toEqual([]);
  await expect(miraChip(init)).toHaveAttribute("data-compact", "false");
  await toWidth(dm, init, 320);
  await expect.poll(() => rowsCut(init)).toEqual([]);
  const searing = miraChip(init);
  if ((await searing.getAttribute("data-compact")) === "true") {
    await expect(searing).toHaveText(/^Searing Strike\s*1$/);
    await searing.hover();
    await expect(dm.getByTestId("ui-tooltip")).toContainText("Searing Strike");
    await dm.mouse.move(5, 450);
  }
  v = await viewport(init);
  expect(v).toMatchObject({ footerUnderList: true, bodyScrolls: false, rowUnder: false });

  // Player-1 (280 → 240): its rows (no hidden ones) and its Searing chip.
  const pInit = await openWindow(p1, "cbt.initiative");
  await expect(pInit.getByTestId("cbt-init-row")).not.toHaveCount(0);
  await expect.poll(() => rowsCut(pInit)).toEqual([]);
  await toWidth(p1, pInit, 240);
  await expect.poll(() => rowsCut(pInit)).toEqual([]);
  // Its 3 rows fit even at the min height (players never get hidden rows): the same rules, footer
  // absent.
  await resizeBy(p1, pInit, 0, -400);
  v = await viewport(pInit);
  expect(v).toMatchObject({
    footerUnderList: true,
    listClips: true,
    bodyScrolls: false,
    rowUnder: false,
    lastWhole: true,
  });
  expect(v.more).toBe(v.below);

  // End the Ambush; Start "Escort to the Ford": the hidden Ally (c10).
  await init.getByTestId("cbt-init-end").click();
  await dm.getByTestId("cbt-init-end-confirm").click();
  await expect(dm.getByTestId("cbt-init-end-confirm")).toHaveCount(0);
  // On Goblin Ambush (as in sim-9): the friendly slot binds the "Goblin Lurker" token.
  const ambush = recordId("battlemap", "scene");
  const scenes = await openWindow(dm, "map.scenes");
  await scenes
    .locator(`[data-testid="map-scene-row"][data-record-id="${ambush}"] button`)
    .first()
    .click();
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  await scenes.getByTestId("ui-window-close").click();
  const enc = await openWindow(dm, "cbt.encounters");
  await enc
    .locator(
      `[data-testid="cbt-enc-row"][data-record-id="${recordId("enc-friendly", "encounter")}"]`,
    )
    .click();
  await enc.getByTestId("cbt-enc-start").click();
  await dm.getByTestId("cbt-enc-start-confirm").click();
  await expect(launcherButton(dm, "cbt.initiative")).toHaveAttribute("data-state", "open");
  const escort = await openWindow(dm, "cbt.initiative");
  const ally = escort.locator('[data-testid="cbt-init-row"][data-hidden="true"]').filter({
    has: dm.getByTestId("cbt-init-row-ally"),
  });
  await expect(ally).toHaveCount(1);
  const name = ally.getByTestId("cbt-init-row-name");
  for (const w of [400, 320]) {
    await toWidth(dm, escort, w);
    await expect.poll(() => rowsCut(escort)).toEqual([]);
    await expect(ally.getByLabel("Hidden")).toBeVisible();
    await expect(ally.getByTestId("cbt-init-row-ally")).toBeVisible();
    // The eye-off stays beside the name; the Ally chip on the name line or the second line.
    const [n, eye] = await Promise.all([
      name.boundingBox(),
      ally.getByLabel("Hidden").boundingBox(),
    ]);
    expect(
      Math.abs((n?.y ?? 0) + (n?.height ?? 0) / 2 - ((eye?.y ?? 0) + (eye?.height ?? 0) / 2)),
    ).toBeLessThan(6);
  }
  expect(await name.getAttribute("data-value")).toBe("Goblin Lurker");

  for (const page of [p1, dm]) await page.context().close();
});
