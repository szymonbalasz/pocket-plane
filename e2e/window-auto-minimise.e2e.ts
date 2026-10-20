// e2e-bundle: session-sim-10
// Thin sprint-7 window frame (SHELL FR-SHELL-77, -80, -83, -84; track FU slice FU1). Read-only on
// server state (the bundle is shared): window opens, Reset layout, Fit, keys, nothing sent. DM:
// Compendium, Party, Encounters at 1440×900 land PC-clear (`data-pc-clear`, checked against the
// PC footprints); auto-minimised ones carry `data-auto-minimised-for`; reopened at 1280×720, a
// window marked PC-clear covers no PC. Player 2 (player 1 starts behind a presented handout
// whose Close is a server write): Reset layout keeps the zones (the sheet 948, 60, 320×418);
// Space presses a Tab-focused launcher button with the mouse over the map, and pans after a
// click (#199). DM Initiative: each row's chips are one tab stop. The rules in detail: bun test
// (`manager.test.ts`, both `windows-s7.test.ts`, `keys.test.ts`, `overlays.test.ts`).
import { expect, type Page, test } from "@playwright/test";
import { footprintsOf, overlaps } from "./support/canvas";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { konvaNodes } from "./support/konva";
import { launcherButton, openWindow, shellWindow } from "./support/shell";

/** sim-10's owned tokens (PCs for FR-SHELL-57): the PCs, their pets and summons, by label. */
const PCS = ["Mira", "Thorn", "Brakka", "Owlbear", "Drake", "Fire Elem"];
const KINDS = ["cmp.compendium", "party.board", "cbt.encounters"];

async function live(page: Page) {
  await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
}

/** The shown windows' rects and placement marks. */
const windows = (page: Page) =>
  page.locator('[data-testid="ui-window"]').evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return {
        kind: (e.getAttribute("data-record-id") ?? "").split(":")[0] ?? "",
        state: e.getAttribute("data-state"),
        placed: e.getAttribute("data-placed"),
        pcClear: e.getAttribute("data-pc-clear") === "true",
        autoFor: e.getAttribute("data-auto-minimised-for"),
        autoMinimised: e.getAttribute("data-auto-minimised") === "true",
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
      };
    }),
  );

/** Wait until the drawn tokens hold still (a refit settles). */
async function settled(page: Page) {
  const at = async () =>
    JSON.stringify((await konvaNodes(page, "map-token")).map((t) => [t.x, t.y]));
  let last = "";
  await expect
    .poll(
      async () => {
        const now = await at();
        const stable = now === last && now !== "[]";
        last = now;
        return stable;
      },
      { intervals: [300] },
    )
    .toBe(true);
}

/** After an open: PC-clear marks match the footprints; auto-minimised ones name their newcomer. */
async function checkMarks(page: Page, strict: boolean) {
  const pcs = await footprintsOf(page, PCS);
  expect(pcs.length).toBeGreaterThan(0);
  for (const w of await windows(page)) {
    if (w.autoMinimised) expect(w.autoFor, w.kind).toBeTruthy();
    if (w.state !== "open" || !["auto", "reopened", "default"].includes(w.placed ?? "")) continue;
    const under = pcs.filter((p) => overlaps(w, p)).map((p) => p.label);
    if (w.pcClear) expect({ kind: w.kind, under }).toEqual({ kind: w.kind, under: [] });
    if (strict && KINDS.includes(w.kind)) {
      expect({ kind: w.kind, pcClear: w.pcClear, under }).toEqual({
        kind: w.kind,
        pcClear: true,
        under: [],
      });
    }
  }
}

test("FR-SHELL-77 auto-minimise instead of covering a PC (DM): Compendium, Party, Encounters at 1440×900 → PC-clear, any auto-minimised window names its newcomer; closed, 1280×720, reopened → a PC-clear mark always holds", async ({
  browser,
}) => {
  const { secret, recordId } = e2eEnv();
  const ambush = recordId("battlemap", "scene");
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  await dm.getByTestId("ui-launcher-menu").click();
  await dm.getByTestId("ui-launcher-reset").click();
  // View Goblin Ambush (the DM's own view, nothing sent), then close Scenes again.
  const scenes = await openWindow(dm, "map.scenes");
  await scenes
    .locator(`[data-testid="map-scene-row"][data-record-id="${ambush}"] button`)
    .first()
    .click();
  const canvas = dm.getByTestId("map-canvas");
  await expect(canvas).toHaveAttribute("data-scene-id", ambush);
  await expect(canvas).toHaveAttribute("data-loading", "false");
  await scenes.getByTestId("ui-window-close").click();
  await dm.getByTestId("map-tool-fit").click();
  await settled(dm);
  for (const kind of KINDS) {
    await openWindow(dm, kind);
    await checkMarks(dm, true);
  }
  const encounters = (await windows(dm)).find((w) => w.kind === "cbt.encounters");
  expect(encounters && encounters.w >= 440 && encounters.h >= 412).toBe(true);
  for (const kind of KINDS) {
    const win = shellWindow(dm, kind);
    if (await win.isVisible()) await win.getByTestId("ui-window-close").click();
  }
  await dm.setViewportSize({ width: 1280, height: 720 });
  await expect(canvas).toHaveAttribute("data-fit-reason", "resize");
  await settled(dm);
  for (const kind of KINDS) {
    await launcherButton(dm, kind).click();
    await expect(shellWindow(dm, kind)).toHaveAttribute("data-state", "open");
    await checkMarks(dm, false);
  }
});

test("FR-SHELL-80 FR-SHELL-83 player 2 1280×800: Reset layout → the sheet 948, 60, 320×418; Tab to the Party button with the mouse over the map, Space opens it; a click, then Space over the map pans and leaves it alone (#199)", async ({
  browser,
}) => {
  const { link } = e2eEnv();
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1280, height: 800 });
  await p1.goto(link("Player 2"));
  await live(p1);
  const canvas = p1.getByTestId("map-canvas");
  await expect(canvas).toHaveAttribute("data-loading", "false");
  await settled(p1); // the scene's own first fit has landed
  await p1.getByTestId("ui-launcher-menu").click();
  await p1.getByTestId("ui-launcher-reset").click();
  const sheet = shellWindow(p1, "char.sheet");
  await expect(sheet).toHaveAttribute("data-placed", "default");
  const box = await sheet.boundingBox();
  expect(box && [box.x, box.y, box.width, box.height].map(Math.round)).toEqual([948, 60, 320, 418]);
  await expect(canvas).toHaveAttribute("data-fit-reason", "fit"); // the one Fit after the reset
  const party = shellWindow(p1, "party.board");
  await expect(party).toHaveCount(0);

  // (i) Keyboard: the mouse rests over the map, Tab until the launcher's Party button has focus.
  const c = await canvas.boundingBox();
  if (!c) throw new Error("no canvas");
  const over = { x: c.x + c.width * 0.6, y: c.y + c.height * 0.55 };
  await p1.mouse.move(over.x, over.y);
  await p1.getByTestId("ui-topbar").focus();
  const partyButton = launcherButton(p1, "party.board");
  let found = false;
  for (let i = 0; i < 80 && !found; i++) {
    await p1.keyboard.press("Tab");
    found = await partyButton.evaluate((el) => el === document.activeElement);
  }
  expect(found).toBe(true);
  await p1.keyboard.press("Space");
  await expect(party).toHaveAttribute("data-state", "open");
  await p1.keyboard.press("Space"); // on top → minimise (FR-SHELL-09)
  await expect(party).toHaveAttribute("data-state", "minimised");

  // (ii) Pointer: click the button (restores Party), the mouse back over the map, hold Space and
  // drag → the map pans, Party stays as the click left it.
  await partyButton.click();
  await expect(party).toHaveAttribute("data-state", "open");
  // A point on the bare map now (Party may cover the first one).
  const bare = await p1.evaluate(() => {
    const c = document.querySelector('[data-testid="map-canvas"]')?.getBoundingClientRect();
    if (!c) return null;
    for (let fy = 0.2; fy < 0.9; fy += 0.05) {
      for (let fx = 0.1; fx < 0.95; fx += 0.05) {
        const x = c.x + c.width * fx;
        const y = c.y + c.height * fy;
        const hit = document.elementFromPoint(x, y);
        if (hit?.closest('[data-testid="map-canvas"]')) return { x, y };
      }
    }
    return null;
  });
  if (!bare) throw new Error("no bare map point");
  over.x = bare.x;
  over.y = bare.y;
  await p1.mouse.move(over.x, over.y);
  const before = await konvaNodes(p1, "map-token");
  await p1.keyboard.down("Space");
  await expect(canvas).toHaveAttribute("data-space-pan", "true");
  await p1.mouse.down();
  await p1.mouse.move(over.x + 80, over.y + 40, { steps: 6 });
  await p1.mouse.up();
  await p1.keyboard.up("Space");
  await expect(party).toHaveAttribute("data-state", "open");
  await expect(canvas).toHaveAttribute("data-camera", "moved");
  const after = await konvaNodes(p1, "map-token");
  expect(after[0]?.x).not.toBe(before[0]?.x);
});

test("FR-SHELL-84 tooltips on focus (DM): each Initiative row's chips are one tab stop; →/← move between them; focus opens the Tooltip", async ({
  browser,
}) => {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const init = shellWindow(dm, "cbt.initiative");
  await expect(init).toBeVisible();
  await expect(init.getByTestId("cbt-init-row").first()).toBeVisible();
  // Tab stops per chip row (after the roving sync).
  const stops = () =>
    init.locator("[data-chip-row]").evaluateAll((rows) =>
      rows
        .filter((r) => r.querySelector("[data-tip]"))
        .map((r) => {
          const tips = [...r.querySelectorAll<HTMLElement>("[data-tip]")].filter(
            (t) => t.getClientRects().length > 0 && !t.closest('[aria-hidden="true"]'),
          );
          const hosts = new Set(
            tips.map((t) => (t.parentElement?.closest("button") as HTMLElement | null) ?? t),
          );
          return [...hosts].filter((h) => h.tabIndex === 0).length;
        }),
    );
  await expect.poll(async () => (await stops()).length).toBeGreaterThan(0);
  expect(new Set(await stops())).toEqual(new Set([1]));
  // Keyboard focus on a row's stop (Shift+Tab out, Tab back in) opens its Tooltip.
  const stop = init.locator('[data-chip-row] [tabindex="0"]').first();
  await stop.focus();
  await dm.keyboard.press("Shift+Tab");
  await dm.keyboard.press("Tab");
  expect(await stop.evaluate((el) => el === document.activeElement)).toBe(true);
  await expect(dm.getByTestId("ui-tooltip")).toBeVisible();
  // A row with two or more chips: → moves the stop to the next chip.
  const marked = await init.locator("[data-chip-row]").evaluateAll((rows) => {
    const row = rows.find(
      (r) =>
        [...r.querySelectorAll<HTMLElement>("[data-tip]")].filter(
          (t) => t.getClientRects().length > 0 && !t.closest('[aria-hidden="true"]'),
        ).length >= 2,
    );
    row?.setAttribute("data-e2e-row", "");
    return row !== undefined;
  });
  if (marked) {
    const row = init.locator("[data-e2e-row]");
    const firstStop = row.locator('[tabindex="0"]').first();
    await firstStop.evaluate((el) => el.setAttribute("data-e2e-first", ""));
    await firstStop.focus();
    await dm.keyboard.press("ArrowRight");
    const now = await row.evaluate((r) => {
      const a = document.activeElement as HTMLElement | null;
      return {
        inRow: !!a && r.contains(a),
        stop: a?.tabIndex,
        moved: !a?.hasAttribute("data-e2e-first"),
        stops: r.querySelectorAll('[tabindex="0"]').length,
      };
    });
    expect(now).toEqual({ inRow: true, stop: 0, moved: true, stops: 1 });
  }
});
