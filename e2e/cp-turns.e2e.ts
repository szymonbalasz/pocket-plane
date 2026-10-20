// e2e-bundle: companions-start
// Sprint 6 CP2 (CBT §13.3 S1–S3, thin): DM, player-1 (Mira) and player-2 (Thorn) at 1440×900.
// The DM Starts "Ambush at the Ford" on Goblin Ambush: the preview lists the Owlbear under Mira
// and the Wolf under Thorn, both ticked (FR-CBT-109). Initiative: the Owlbear "After Mira",
// indented with Mira's owner chip; the Wolf a line inside Thorn's row (FR-CBT-118). Player-1 sees
// the Owlbear's HP and its card icon, player-2 a band (FR-CBT-119). Round 1: "Your turn — Mira",
// "Your turn — Owlbear (Mira)", "Your turn — Thorn + Wolf" (FR-CBT-115). Companion ▸ Own
// initiative and back (S3); Goblin made Mira's through Owner ▸, then Turn hostile (S5's path,
// FR-CBT-111). Rules, redaction and leaks: bun test (companion-rows,
// start-pets, cp-turns, companions tests).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { launcherButton, openWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

const row = (scope: Locator, id: string) =>
  scope.locator(`[data-testid="cbt-init-row"][data-record-id="${id}"]`);

/** The combatant id of the row named `name`. */
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

/** Narrows `win` to its min width (the shell clamps). */
async function toMinWidth(page: Page, win: Locator, w: number) {
  await resizeBy(page, win, -400, 0);
  await expect.poll(async () => Math.round((await win.boundingBox())?.width ?? 0)).toBe(w);
}

/**
 * FR-CBTX-57 / FR-CBT-125 with companions (seams S4): every name (rows and companion lines) whole
 * inside its line, every AC / HP part whole, owner chips inside their row; no row content under
 * the list's bottom edge or past the footer.
 */
function rowsCut(init: Locator): Promise<string[]> {
  return init.evaluate((w) => {
    const bad: string[] = [];
    for (const n of w.querySelectorAll<HTMLElement>('[data-testid="cbt-init-row-name"]')) {
      const line = n.closest("[data-name-line]") as HTMLElement;
      const a = n.getBoundingClientRect();
      const b = line.getBoundingClientRect();
      if (n.scrollWidth > n.clientWidth + 0.5 || (n.textContent ?? "").includes("…")) {
        bad.push(`name cut: ${n.dataset.value}`);
      }
      if (a.width === 0 || a.right > b.right + 0.5) bad.push(`name out: ${n.dataset.value}`);
      // Note 3: a one-word name that fits its line never breaks inside the word.
      const base = n.querySelector<HTMLElement>("[data-name-base]");
      if (base && !(base.textContent ?? "").trim().includes(" ")) {
        const r = document.createRange();
        r.selectNodeContents(base);
        const rows = new Set([...r.getClientRects()].map((x) => Math.round(x.top)));
        if (rows.size > 1 && base.scrollWidth <= b.width) {
          bad.push(`word broken: ${n.dataset.value}`);
        }
      }
    }
    for (const l of w.querySelectorAll<HTMLElement>("[data-stats-line]")) {
      if (l.scrollWidth > l.clientWidth + 0.5) bad.push("stats cut");
    }
    for (const c of w.querySelectorAll<HTMLElement>('[data-testid="cbt-init-row-owner"]')) {
      const a = c.getBoundingClientRect();
      const b = (c.closest('[data-testid="cbt-init-row"]') as HTMLElement).getBoundingClientRect();
      if (c.scrollWidth > c.clientWidth + 0.5 || a.right > b.right + 0.5) {
        bad.push(`owner chip out: ${c.dataset.recordId}`);
      }
    }
    const list = w.querySelector<HTMLElement>('[data-testid="cbt-init-list"]') as HTMLElement;
    const footer = w.querySelector<HTMLElement>('[data-testid="cbt-init-more"]');
    const body = w.querySelector('[data-testid="ui-window-content"]')?.parentElement as HTMLElement;
    const l = list.getBoundingClientRect();
    if (footer && !footer.hidden && footer.getBoundingClientRect().top < l.bottom - 0.5) {
      bad.push("footer over the list");
    }
    if (body.scrollHeight > body.clientHeight + 1) bad.push("body scrolls");
    return bad;
  });
}

async function idByName(init: Locator, name: string): Promise<string> {
  const r = init.locator('[data-testid="cbt-init-row"]').filter({
    has: init.page().locator(`[data-testid="cbt-init-row-name"][data-value="${name}"]`),
  });
  await expect(r).toHaveCount(1);
  return (await r.getAttribute("data-record-id")) as string;
}

test("FR-CBT-109 FR-CBT-115 FR-CBT-118 FR-CBT-119 companions-start: Start with pets, rows, lines, alerts, mode change (S1–S3)", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const ambush = recordId("battlemap", "scene");
  const encounterId = recordId("encounter-1", "encounter");
  const owlPet = recordId("pet-owlbear", "entity");
  const wolfPet = recordId("cp-pet-thorn", "entity");
  const miraChar = recordId("char-mira", "entity");
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1440, height: 900 });
  await p1.goto(link("Player 1"));
  await live(p1);
  const p2 = await rolePage(browser);
  await p2.setViewportSize({ width: 1440, height: 900 });
  await p2.goto(link("Player 2"));
  await live(p2);

  // S1: the DM views Goblin Ambush and Starts with both pets.
  const scenes = await openWindow(dm, "map.scenes");
  await scenes
    .locator(`[data-testid="map-scene-row"][data-record-id="${ambush}"] button`)
    .first()
    .click();
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  const enc = await openWindow(dm, "cbt.encounters");
  await enc.locator(`[data-testid="cbt-enc-row"][data-record-id="${encounterId}"]`).click();
  await enc.getByTestId("cbt-enc-start").click();
  const dialog = dm.getByTestId("cbt-enc-start-dialog");
  const petTick = (id: string) =>
    dialog.locator(`[data-testid="cbt-enc-pet"][data-record-id="${id}"]`);
  await expect(petTick(owlPet)).toHaveAttribute("data-checked", "true");
  await expect(petTick(wolfPet)).toHaveAttribute("data-checked", "true");
  await dm.getByTestId("cbt-enc-start-confirm").click();
  await expect(launcherButton(dm, "cbt.initiative")).toHaveAttribute("data-state", "open");

  const init = await openWindow(dm, "cbt.initiative");
  const owlbear = await idByName(init, "Owlbear");
  const mira = await idByName(init, "Mira");
  const thorn = await idByName(init, "Thorn");
  // The Owlbear: indented right under Mira, Mira's chip, "after-owner"; the Wolf: Thorn's line.
  await expect(row(init, owlbear)).toHaveAttribute("data-indent", "true");
  await expect(row(init, owlbear).getByTestId("cbt-init-row-owner")).toHaveAttribute(
    "data-value",
    miraChar,
  );
  await expect(row(init, owlbear).getByTestId("cbt-init-row-owner")).toHaveText("Mira");
  await expect(row(init, owlbear).getByTestId("cbt-init-row-mode")).toHaveAttribute(
    "data-value",
    "after-owner",
  );
  const wolfLine = row(init, thorn).getByTestId("cbt-init-companion");
  await expect(wolfLine).toHaveCount(1);
  // The pet's name is its token's ("Wolf 2" beside the ambush's Wolf, FR-MAP-16).
  const wolfName = (await wolfLine
    .getByTestId("cbt-init-row-name")
    .getAttribute("data-value")) as string;
  expect(wolfName).toMatch(/^Wolf/);
  const wolf = (await wolfLine.getAttribute("data-record-id")) as string;
  await expect(row(init, wolf)).toHaveCount(0);
  const ids = await init
    .getByTestId("cbt-init-row")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-record-id")));
  expect(ids.indexOf(owlbear)).toBe(ids.indexOf(mira) + 1);

  // FR-CBT-119: player-1 owns the Owlbear (HP + card icon), player-2 the Wolf.
  const i1 = await openWindow(p1, "cbt.initiative");
  const i2 = await openWindow(p2, "cbt.initiative");
  await expect(row(i1, owlbear).getByTestId("cbt-init-row-hp")).toHaveText(/^\d+ \/ 59$/);
  await expect(row(i1, owlbear).getByTestId("cbt-init-row-card")).toBeVisible();
  await expect(row(i1, owlbear).getByTestId("cbt-init-row-owner")).toHaveText("Mira");
  await expect(row(i2, owlbear).getByTestId("cbt-init-row-band")).toHaveAttribute(
    "data-value",
    "healthy",
  );
  await expect(row(i2, owlbear).getByTestId("cbt-init-row-hp")).toHaveCount(0);
  await expect(row(i2, owlbear).getByTestId("cbt-init-row-card")).toHaveCount(0);
  const p2Line = row(i2, thorn).getByTestId("cbt-init-companion");
  await expect(p2Line).toHaveAttribute("data-record-id", wolf);
  await expect(p2Line.getByTestId("cbt-init-row-card")).toBeVisible();
  await expect(row(i1, thorn).getByTestId("cbt-init-companion")).toHaveCount(1);
  await expect(row(i1, thorn).getByTestId("cbt-init-row-card")).toHaveCount(0);

  // Seams S4: WF's row rules with the owner chip, the indent and the Wolf's line (DM 400 and
  // its 320 min, player-2 280 and its 240 min); sizes restored only by reload, so check last-ish.
  await expect.poll(() => rowsCut(init)).toEqual([]);
  await expect.poll(() => rowsCut(i2)).toEqual([]);

  // S2: initiatives (monsters rolled at Start), round 1, Next to Mira, the Owlbear, Thorn.
  for (const [id, v] of [
    [mira, "15"],
    [thorn, "10"],
  ] as const) {
    const input = init.locator(`input[data-testid="cbt-init-row-init"][data-record-id="${id}"]`);
    await input.fill(v);
    await input.press("Enter");
    await expect(input).toHaveValue(v);
  }
  await init.getByTestId("cbt-init-next").click();
  await expect(init.getByTestId("cbt-init-round")).toHaveAttribute("data-value", "1");
  const turn = init.locator('[data-testid="cbt-init-row"][data-turn="true"]');
  const nextTo = async (id: string) => {
    for (let i = 0; i < 12; i++) {
      if ((await turn.getAttribute("data-record-id")) === id) return;
      const before = await turn.getAttribute("data-record-id");
      await init.getByTestId("cbt-init-next").click();
      await expect(turn).not.toHaveAttribute("data-record-id", before ?? "");
    }
    throw new Error(`never reached ${id}`);
  };
  const toast1 = p1.getByTestId("ui-alert-toast");
  const toast2 = p2.getByTestId("ui-alert-toast");
  await nextTo(mira);
  await expect(toast1).toContainText("Your turn — Mira");
  await nextTo(owlbear);
  await expect(toast1).toContainText("Your turn — Owlbear (Mira)");
  await expect(toast2).toHaveCount(0);
  await nextTo(thorn);
  await expect(toast2).toContainText(`Your turn — Thorn + ${wolfName}`);

  // S3: Owlbear → Companion ▸ Own initiative: ranked by its own number; then back under Mira.
  const setMode = async (mode: string) => {
    await row(init, owlbear).getByTestId("cbt-init-row-menu").first().click();
    await dm.getByTestId("cbt-init-row-companion").click();
    await dm.locator(`[data-testid="cbt-companion-mode"][data-value="${mode}"]`).click();
    await expect(row(init, owlbear).getByTestId("cbt-init-row-mode")).toHaveAttribute(
      "data-value",
      mode,
    );
  };
  await setMode("own");
  await expect(row(init, owlbear)).not.toHaveAttribute("data-indent", "true");
  await expect(row(i1, owlbear).getByTestId("cbt-init-row-mode")).toHaveAttribute(
    "data-value",
    "own",
  );
  await setMode("after-owner");
  await expect(row(init, owlbear)).toHaveAttribute("data-indent", "true");
  const after = await init
    .getByTestId("cbt-init-row")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-record-id")));
  expect(after.indexOf(owlbear)).toBe(after.indexOf(mira) + 1);

  // S5's path on a plain monster: Goblin → Companion ▸ Owner ▸ Mira (a companion after Mira,
  // player-1 sees its HP); then Turn hostile: owner chip gone for the DM and player-1.
  const goblin = await idByName(init, "Goblin");
  const companionMenu = async () => {
    await row(init, goblin).getByTestId("cbt-init-row-menu").first().click();
    await dm.getByTestId("cbt-init-row-companion").click();
  };
  await companionMenu();
  await dm.getByTestId("cbt-companion-owner-menu").click();
  await dm.locator(`[data-testid="cbt-companion-owner"][data-record-id="${miraChar}"]`).click();
  await expect(row(init, goblin).getByTestId("cbt-init-row-owner")).toHaveAttribute(
    "data-value",
    miraChar,
  );
  await expect(row(i1, goblin).getByTestId("cbt-init-row-card")).toBeVisible();
  await expect(row(i2, goblin).getByTestId("cbt-init-row-owner")).toHaveText("Mira");
  await companionMenu();
  await dm.getByTestId("cbt-companion-hostile").click();
  await expect(row(init, goblin).getByTestId("cbt-init-row-owner")).toHaveCount(0);
  await expect(row(i1, goblin).getByTestId("cbt-init-row-owner")).toHaveCount(0);
  await expect(row(i1, goblin).getByTestId("cbt-init-row-card")).toHaveCount(0);

  // The row rules at the min widths (owner chips and the Wolf's line wrap, never cut).
  await toMinWidth(dm, init, 320);
  await expect.poll(() => rowsCut(init)).toEqual([]);
  await toMinWidth(p2, i2, 240);
  await expect.poll(() => rowsCut(i2)).toEqual([]);

  for (const p of [p1, p2, dm]) await p.context().close();
});
