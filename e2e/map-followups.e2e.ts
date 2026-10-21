// e2e-bundle: fu-map-e2e
// Sprint 7 FU3 map follow-ups (scenes-map FR-MAP-89, -91; play-shell §13 U5, U16; thin). DM (A)
// 1440×900 with Scenes + Game log + Initiative: Fit stays readable (cells above the 24-px strip of
// sim-10 b06), every footprint clear of the windows. Player 1 (B) 1280×800: a double-click on the
// Owlbear's name pill below its footprint opens the companion card and doesn't move the camera
// (FR-MAP-89 (1)); the DM's Reveal all then leaves no token under any window (one reveal refit
// where a new one lands under one, b07); after a reload the load fit frames clear of the restored
// windows (`data-fit-reason="load"`). The fit rules, the no-jump check and the resize wait: bun test
// (camera.test, both fit-followups tests).
import { expect, type Page, test } from "@playwright/test";
import { type Box, footprintsOf, overlaps, tokenFootprints } from "./support/canvas";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { konvaNodes } from "./support/konva";
import { showToPlayers } from "./support/scenes";
import { openWindow, shellWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

/** Every shown `ui-window`'s rect (minimised ones are hidden). */
const shownWindows = (page: Page) =>
  page.locator('[data-testid="ui-window"][data-state="open"]').evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return {
        kind: e.getAttribute("data-record-id") ?? "",
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
      };
    }),
  );

/** session-sim-10 presents a handout to Player 1 (over the map): close it once it shows. */
async function closePresented(page: Page) {
  const popup = page.getByTestId("party-present-popup");
  await expect(popup).toBeVisible();
  await page.getByTestId("party-present-close").click();
  await expect(popup).toHaveCount(0);
}

/** Waits until the drawn tokens stop moving (a fit landed). */
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
      { intervals: [400] },
    )
    .toBe(true);
}

/** "label under kind" for every token footprint (of `only`, if given) a shown window overlaps. */
async function underWindows(page: Page, only?: readonly string[]): Promise<string[]> {
  const windows = await shownWindows(page);
  const tokens: Box[] = only ? await footprintsOf(page, only) : await tokenFootprints(page);
  return tokens.flatMap((t) =>
    windows.filter((w) => overlaps(t, w)).map((w) => `${t.label ?? t.id} under ${w.kind}`),
  );
}

/** Player 1's map's owned tokens (the fit's PCs, FR-MAP-46) in session-sim-10's ambush. */
const OWNED = ["Mira", "Thorn", "Brakka", "Owlbear", "Drake Companion", "Fire Elemental"];

/**
 * After a fit: no PC under a window; `all` → no token at all (FR-MAP-59). With the card at its
 * sprint-7 useful size (320 × 360, FR-SHELL-79) and Initiative's grown rows the 16 tokens don't fit
 * clear at ≥ 24 px here, so the fit may end `pcs` (FR-MAP-46 / -81: the PCs clear).
 */
async function clearAfterFit(page: Page) {
  expect(await underWindows(page, OWNED)).toEqual([]);
  const visible = await page.getByTestId("map-canvas").getAttribute("data-fit-visible");
  if (visible === "all") expect(await underWindows(page)).toEqual([]);
  return visible;
}

test("FR-MAP-91 Fit with Scenes and a toast: DM 1440×900 with Scenes + Game log + Initiative → Fit stays above 24 px, every footprint clear of the windows (U5, b06)", async ({
  browser,
}) => {
  const { secret, recordId } = e2eEnv();
  const ambush = recordId("battlemap", "scene");
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const scenes = await openWindow(dm, "map.scenes");
  await scenes
    .locator(`[data-testid="map-scene-row"][data-record-id="${ambush}"] button`)
    .first()
    .click();
  const canvas = dm.getByTestId("map-canvas");
  await expect(canvas).toHaveAttribute("data-scene-id", ambush);
  await expect(canvas).toHaveAttribute("data-loading", "false");
  await expect(shellWindow(dm, "cbt.initiative")).toBeVisible();
  await expect(shellWindow(dm, "dice.log")).toBeVisible();
  await dm.getByTestId("map-tool-fit").click();
  await expect(canvas).toHaveAttribute("data-fit-reason", /^fit(-past-toasts)?$/);
  await settled(dm);
  const cell = Number(await canvas.getAttribute("data-cell-px"));
  expect(cell).toBeGreaterThan(24);
  expect(await underWindows(dm)).toEqual([]);
  console.info(
    `FR-MAP-91 DM Fit with Scenes: ${cell} px, ${await canvas.getAttribute("data-fit-reason")}`,
  );
  await dm.context().close();
});

test("FR-MAP-89 reveal refit with the card open: Player 1 double-clicks the Owlbear's name pill → the card opens, still fitted; Reveal all → one reveal refit, no PC under any window (none at all when `all`); reload → the load fit, the same (U16, b07)", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const ambush = recordId("battlemap", "scene");
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const p = await rolePage(browser);
  await p.setViewportSize({ width: 1280, height: 800 });
  await p.goto(link("Player 1"));
  await live(p);
  await closePresented(p);
  await showToPlayers(dm, "Goblin Ambush");
  const canvas = p.getByTestId("map-canvas");
  await expect(canvas).toHaveAttribute("data-scene-id", ambush);
  await expect(canvas).toHaveAttribute("data-camera", "fitted");
  await settled(p);

  // (1) The Owlbear's name pill: its lower half lies below the footprint, outside the token's
  // hit area (sim-10: a press there was a pan and set `moved`).
  const label = (await konvaNodes(p, "map-token-label")).find((l) => l.text === "Owlbear");
  expect(label).toBeDefined();
  if (!label) return;
  const at = { x: label.x, y: label.y + label.height / 4 };
  const onCanvas = await p.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid="map-canvas"]') !== null,
    at,
  );
  expect(onCanvas).toBe(true);
  await p.mouse.dblclick(at.x, at.y);
  await expect(shellWindow(p, "charx.companion")).toBeVisible();
  await expect(canvas).toHaveAttribute("data-camera", "fitted");
  await settled(p);

  // Reveal all (the DM's fog bar on Goblin Ambush): what comes into sight lands clear.
  const tokensBefore = (await konvaNodes(p, "map-token")).length;
  await openWindow(dm, "map.scenes");
  await dm
    .locator(`[data-testid="map-scene-row"][data-record-id="${ambush}"] button`)
    .first()
    .click();
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  await dm.getByTestId("map-tool-fog").click();
  await dm.getByTestId("fog-reveal-all").click();
  await expect
    .poll(async () => (await konvaNodes(p, "map-token")).length)
    .toBeGreaterThan(tokensBefore);
  await p.waitForTimeout(1500); // FR-MAP-82: a reveal refit lands 1 s after the last reveal
  await settled(p);
  await expect(canvas).toHaveAttribute("data-camera", "fitted");
  // New tokens landed under the sheet / off-screen at the camera above: one reveal refit.
  await expect(canvas).toHaveAttribute("data-fit-reason", "reveal");
  const afterReveal = await clearAfterFit(p);

  // Reload: the companion card and the sheet come back; the load fit waits for them.
  await p.reload();
  await live(p);
  await expect(shellWindow(p, "charx.companion")).toBeVisible();
  await expect(canvas).toHaveAttribute("data-fit-reason", "load");
  await settled(p);
  const afterLoad = await clearAfterFit(p);
  console.info(`FR-MAP-89: reveal → ${afterReveal}; reload → load, ${afterLoad}`);
  await dm.context().close();
  await p.context().close();
});
