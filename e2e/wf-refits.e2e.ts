// e2e-bundle: wf-frame-e2e
// Sprint 8 WF3 (map refits after the placer; scenes-map FR-MAP-93–98, play-shell §13 F10; thin).
// Player 1 (B) 1280×800 with the Owlbear card open: the DM's Reveal all refits once and never
// zooms in (`data-cell-px` ≤ before, BL-65 / sim-11 h), no PC (+ 4 px) under a window and, when
// the fit is `all`, no token at all; after a reload the load fit frames clear of the restored
// windows, never the 48-px re-scale with tokens under the sheet (r03). The fit rules in detail:
// bun test (`refits.test.ts`, `wf-refits.test.ts`, the session-replay harness).
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

/** A handout session-sim-10 presents to Player 1 (over the map): closed if it shows. */
async function closePresented(page: Page) {
  const popup = page.getByTestId("party-present-popup");
  try {
    await expect(popup).toBeVisible({ timeout: 5_000 });
  } catch {
    return;
  }
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

/** Player 1's player characters (FR-MAP-93, `isPlacementPc`): pets are content tokens. */
const PCS = ["Mira", "Thorn", "Brakka"];

/** "label under kind" for every footprint (of `only`, grown by `margin` px) a shown window covers. */
async function underWindows(page: Page, only?: readonly string[], margin = 0) {
  const windows = await shownWindows(page);
  const tokens: Box[] = only ? await footprintsOf(page, only) : await tokenFootprints(page);
  return tokens.flatMap((t) => {
    const g = { x: t.x - margin, y: t.y - margin, w: t.w + 2 * margin, h: t.h + 2 * margin };
    return windows.filter((w) => overlaps(g, w)).map((w) => `${t.label ?? t.id} under ${w.kind}`);
  });
}

/** After a fit: every PC + 4 px clear of the windows; `all` → no token under one (FR-MAP-59). */
async function clearAfterFit(page: Page) {
  expect(await underWindows(page, PCS)).toEqual([]);
  const visible = await page.getByTestId("map-canvas").getAttribute("data-fit-visible");
  if (visible === "all") expect(await underWindows(page)).toEqual([]);
  return visible;
}

test("FR-MAP-94 FR-MAP-95 FR-MAP-96 map refits after the placer (F10): Player 1 with the card open, DM Reveal all → one refit, data-cell-px ≤ before, no PC under a window (none at all when `all`); reload → the load fit, no token under the sheet, the same checks", async ({
  browser,
}) => {
  test.setTimeout(120_000);
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

  await test.step("the Owlbear's card opens from its name pill; the camera stays fitted", async () => {
    const label = (await konvaNodes(p, "map-token-label")).find((l) => l.text === "Owlbear");
    expect(label).toBeDefined();
    if (!label) return;
    await p.mouse.dblclick(label.x, label.y + label.height / 4);
    await expect(shellWindow(p, "charx.companion")).toBeVisible();
    await expect(canvas).toHaveAttribute("data-camera", "fitted");
    await settled(p);
  });

  const before = Number(await canvas.getAttribute("data-cell-px"));
  await test.step("F10: Reveal all → one reveal refit, never zoomed in, PCs clear", async () => {
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
    const after = Number(await canvas.getAttribute("data-cell-px"));
    expect(after).toBeLessThanOrEqual(before);
    const visible = await clearAfterFit(p);
    console.info(`FR-MAP-94 reveal: ${before} → ${after} px, ${visible}`);
  });

  await test.step("F10: B reloads → the load fit after the placer: the same checks, no token under the sheet (r03)", async () => {
    await p.reload();
    await live(p);
    await expect(shellWindow(p, "charx.companion")).toBeVisible();
    await expect(canvas).toHaveAttribute("data-fit-reason", "load");
    await settled(p);
    const visible = await clearAfterFit(p);
    const sheet = (await underWindows(p)).filter((u) => u.endsWith("char.sheet:main"));
    expect(sheet).toEqual([]);
    console.info(
      `FR-MAP-96 reload: load at ${await canvas.getAttribute("data-cell-px")} px, ${visible}`,
    );
  });
  await dm.context().close();
  await p.context().close();
});
