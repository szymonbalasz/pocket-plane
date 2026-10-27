// e2e-bundle: windows-s5
// Fit keeps every token visible (MAP FR-MAP-59, SHELL §13 sprint 5 step W5, slice W2), DM:
// Fit (rail) with Initiative + Game log, then with Scenes too, at 1440×900 and 1280×720. Every
// `map-token` footprint (hidden ones too) inside the work area right of the rail and clear of
// every `ui-window` and the DM's summary strip with `data-fit-visible="all"` (sprint 6, FR-MAP-80,
// OQ-MAP-57 D: the strip, not the whole top-centre box, so every case is `all` now; was `pcs` in
// three, OQ-SHELL-40); a `pcs` case keeps every PC clear. The method in detail: bun test
// (`camera.test.ts`, the registry-driven `fit-visible.test.ts` per client).
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { konvaNodes } from "./support/konva";
import { openWindow, shellWindow } from "./support/shell";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const TOP_BAR_H = 48;
const RAIL_CLEAR = 68;

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

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

/** Token footprints (screen px): the body's centre ± its cells (`data-cell-px` each). */
async function footprints(page: Page) {
  const cell = Number(await page.getByTestId("map-canvas").getAttribute("data-cell-px"));
  return (await konvaNodes(page, "map-token")).map((t) => {
    const side = Math.max(1, Math.round(t.width / cell)) * cell;
    return { id: t.id, x: t.x - side / 2, y: t.y - side / 2, w: side, h: side };
  });
}

/** The DM's summary strip (FR-MAP-80): 320 × 57 at ((vw − 320) / 2, 100). */
const summaryStrip = (vw: number): Box => ({
  x: Math.round((vw - 320) / 2),
  y: 100,
  w: 320,
  h: 57,
});

/** Fit from the rail, then wait until the drawn tokens stop moving. */
async function fit(page: Page) {
  await page.getByTestId("map-tool-fit").click();
  const canvas = page.getByTestId("map-canvas");
  await expect(canvas).toHaveAttribute("data-camera", "fitted");
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

/** W5's expectation for one layout: `all` → every footprint clear; `pcs` → every PC clear. */
async function expectVisible(page: Page, want: "all" | "pcs", count: number, pcs: string[]) {
  const canvas = page.getByTestId("map-canvas");
  await expect(canvas).toHaveAttribute("data-fit-visible", want);
  const vp = page.viewportSize() ?? { width: 0, height: 0 };
  // The work area right of the rail: to 12 px above the bottom edge (FR-KIT-14).
  const area = {
    x: RAIL_CLEAR,
    y: TOP_BAR_H,
    w: vp.width - RAIL_CLEAR,
    h: vp.height - 12 - TOP_BAR_H,
  };
  const windows = await shownWindows(page);
  const toasts = summaryStrip(vp.width);
  const tokens = await footprints(page);
  expect(tokens.length).toBe(count);
  const cell = Number(await canvas.getAttribute("data-cell-px"));
  const check = want === "all" ? tokens : tokens.filter((t) => pcs.includes(t.id));
  expect(check.length).toBeGreaterThan(0);
  const blocked = check.flatMap((t) => {
    const out: string[] = [];
    const inside =
      t.x >= area.x - 0.5 &&
      t.y >= area.y - 0.5 &&
      t.x + t.w <= area.x + area.w + 0.5 &&
      t.y + t.h <= area.y + area.h + 0.5;
    if (!inside) out.push(`${t.id} outside the work area`);
    for (const w of windows) if (overlaps(t, w)) out.push(`${t.id} under ${w.kind}`);
    if (want === "all" && overlaps(t, toasts)) out.push(`${t.id} under the summary strip`);
    return out;
  });
  expect(
    blocked,
    JSON.stringify({
      cell,
      rect: await canvas.getAttribute("data-fit-rect"),
      windows,
      toasts,
    }),
  ).toEqual([]);
  if (want === "all") expect(cell).toBeGreaterThanOrEqual(24);
  return cell;
}

test("FR-MAP-59 every token visible: DM Fit with Initiative + Game log, then + Scenes, at 1440×900 and 1280×720 → all (W5; sprint 6 FR-MAP-80)", async ({
  browser,
}) => {
  const { secret, recordId } = e2eEnv();
  const ambush = recordId("battlemap", "scene");
  const pcs = [
    recordId("battlemap", "token", 0),
    recordId("thorn-battlemap", "token"),
    recordId("char-brakka", "token"),
  ];
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  await expect(shellWindow(dm, "cbt.initiative")).toBeVisible();
  await expect(shellWindow(dm, "dice.log")).toBeVisible();
  // View Goblin Ambush, then close Scenes again.
  const scenes = await openWindow(dm, "map.scenes");
  await scenes
    .locator(`[data-testid="map-scene-row"][data-record-id="${ambush}"] button`)
    .first()
    .click();
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-loading", "false");
  await scenes.getByTestId("ui-window-close").click();
  await expect(scenes).toHaveCount(0);
  await expect.poll(async () => (await konvaNodes(dm, "map-token")).length).toBeGreaterThan(0);
  const count = (await konvaNodes(dm, "map-token")).length;

  const cells: string[] = [];
  for (const [size, plain] of [
    [{ width: 1440, height: 900 }, "all"],
    [{ width: 1280, height: 720 }, "all"],
  ] as const) {
    await dm.setViewportSize(size);
    await fit(dm);
    cells.push(`${size.width}: ${await expectVisible(dm, plain, count, pcs)} px`);
    await openWindow(dm, "map.scenes");
    await fit(dm);
    // Sprint 7 (OQ-SHELL-55 B): Scenes' shell-chosen spot now over a PC is re-placed on the
    // reopen, PC-free, possibly mid-map; the Fit then keeps at least every PC clear (`pcs`;
    // the cell floor with Scenes is FR-MAP-91's, FU3).
    const withScenes = await dm.getByTestId("map-canvas").getAttribute("data-fit-visible");
    expect(["all", "pcs"]).toContain(withScenes);
    const want = withScenes === "all" ? "all" : "pcs";
    cells.push(`${size.width} + Scenes (${want}): ${await expectVisible(dm, want, count, pcs)} px`);
    await shellWindow(dm, "map.scenes").getByTestId("ui-window-close").click();
  }
  console.info(`FR-MAP-59 W5 cells: ${cells.join("; ")}`);
  await dm.context().close();
});
