// e2e-bundle: pm-memory-e2e
// Sprint 9 PM1 (window memory, play-shell §13 sprint 9; walkthrough M3–M8, M12): a window the DM
// moved or resized reopens exactly, on top, after a reload and a resize round trip; a shown tool
// bar draws it aside without saving; an untouched window is still placed around it; Reset layout
// forgets it. The rules in detail: bun test (`window-memory.test.ts`, the harness `memory` path).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { footprintsOf } from "./support/canvas";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { showToPlayers } from "./support/scenes";
import { openWindow, shellWindow } from "./support/shell";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

async function live(page: Page) {
  await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
}

async function box(l: Locator): Promise<Box> {
  const b = await l.boundingBox();
  if (!b) throw new Error("no box");
  return {
    x: Math.round(b.x),
    y: Math.round(b.y),
    w: Math.round(b.width),
    h: Math.round(b.height),
  };
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

/** Every open `ui-window`: kind, rect, `data-z`, `data-remembered`. */
const openWindows = (page: Page) =>
  page.locator('[data-testid="ui-window"][data-state="open"]').evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return {
        kind: (e.getAttribute("data-record-id") ?? "").split(":")[0] ?? "",
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
        z: Number(e.getAttribute("data-z") ?? 0),
        remembered: e.getAttribute("data-remembered") === "true",
      };
    }),
  );

/** Drags a window by its title bar so its top-left lands at (x, y). */
async function dragTo(page: Page, win: Locator, x: number, y: number) {
  const t = await box(win.getByTestId("ui-window-title"));
  const w = await box(win);
  const grab = { x: t.x + 60, y: t.y + t.h / 2 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + (x - w.x), grab.y + (y - w.y), { steps: 6 });
  await page.mouse.up();
}

/** Resizes a window by its corner handle to `w` × `h`. */
async function resizeTo(page: Page, win: Locator, w: number, h: number) {
  const handle = await box(win.getByTestId("ui-window-resize"));
  const now = await box(win);
  const at = { x: handle.x + handle.w / 2, y: handle.y + handle.h / 2 };
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + (w - now.w), at.y + (h - now.h), { steps: 6 });
  await page.mouse.up();
}

/** The viewport settles 150 ms after the last resize event: wait for the Game log's zone. */
async function viewport(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  const zone =
    width >= 1440 ? { x: 68, y: 584, w: 1150, h: 240 } : { x: 68, y: 484, w: 690, h: 160 };
  await expect.poll(() => box(shellWindow(page, "dice.log"))).toEqual(zone);
}

const onTop = async (page: Page, kind: string) => {
  const open = await openWindows(page);
  const me = open.find((w) => w.kind === kind);
  return me !== undefined && me.z === Math.max(...open.map((w) => w.z));
};

test("FR-SHELL-144 FR-SHELL-146 FR-SHELL-147 FR-SHELL-150 FR-SHELL-151 FR-SHELL-153 window memory (DM 1440×900): Compendium dragged onto Mira and resized reopens exactly, on top, nothing else moved; after a reload; nudged on-screen at 1280×720 and exact again at 1440; the Fog bar draws it aside without saving (reload included); Stats placed around it; Reset forgets it", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { secret, recordId } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const ambush = recordId("battlemap", "scene");
  const scenes = await showToPlayers(dm, "Goblin Ambush");
  await scenes
    .locator(`[data-testid="map-scene-row"][data-record-id="${ambush}"] button`)
    .first()
    .click();
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  await scenes.getByTestId("ui-window-close").click();
  const cmp = shellWindow(dm, "cmp.compendium");
  let mine: Box = { x: 0, y: 0, w: 0, h: 0 };

  await test.step("M3: Compendium opened (placed, untouched), dragged onto Mira and resized to 480 × 440 → remembered", async () => {
    await openWindow(dm, "cmp.compendium");
    await expect(cmp).not.toHaveAttribute("data-remembered", "true");
    const [mira] = await footprintsOf(dm, ["Mira"]);
    if (!mira) throw new Error("Mira not drawn");
    await dragTo(
      dm,
      cmp,
      Math.max(80, Math.round(mira.x) - 40),
      Math.max(70, Math.round(mira.y) - 40),
    );
    await resizeTo(dm, cmp, 480, 440);
    await expect(cmp).toHaveAttribute("data-remembered", "true");
    mine = await box(cmp);
    expect({ w: mine.w, h: mine.h }).toEqual({ w: 480, h: 440 });
    expect(overlaps(mine, mira), "over Mira").toBe(true);
  });

  await test.step("M4: close + reopen, then the launcher toggle twice → the exact rect, on top; no other window moved", async () => {
    const others = (await openWindows(dm)).filter((w) => w.kind !== "cmp.compendium");
    await cmp.getByTestId("ui-window-close").click();
    await openWindow(dm, "cmp.compendium");
    expect(await box(cmp)).toEqual(mine);
    await expect(cmp).toHaveAttribute("data-placed", "stored");
    expect(await onTop(dm, "cmp.compendium")).toBe(true);
    const after = (await openWindows(dm)).filter((w) => w.kind !== "cmp.compendium");
    expect(after.map(({ z: _z, ...r }) => r)).toEqual(others.map(({ z: _z, ...r }) => r));
  });

  await test.step("M6: a reload → the same rect", async () => {
    await dm.reload();
    await live(dm);
    await expect(cmp).toBeVisible();
    await expect.poll(() => box(cmp)).toEqual(mine);
    await expect(cmp).toHaveAttribute("data-remembered", "true");
  });

  await test.step("M7: 1280×720 → same size, fully on-screen; 1440×900 → the stored rect", async () => {
    await viewport(dm, 1280, 720);
    const small = await box(cmp);
    expect({ w: small.w, h: small.h }).toEqual({ w: 480, h: 440 });
    expect(small.x + small.w).toBeLessThanOrEqual(1280);
    expect(small.y + small.h).toBeLessThanOrEqual(720);
    await viewport(dm, 1440, 900);
    expect(await box(cmp)).toEqual(mine);
  });

  await test.step("M8: dragged under the Fog bar's spot, the Fog tool draws it aside (`pushed`, same size); a reload keeps the stored rect; the bar gone → back at its rect", async () => {
    await dragTo(dm, cmp, 80, 70);
    mine = await box(cmp);
    await dm.getByTestId("map-tool-fog").click();
    const panel = dm.getByTestId("map-tool-panel");
    await expect(panel).toBeVisible();
    await expect(cmp).toHaveAttribute("data-placed", "pushed");
    const bar = await box(panel);
    const pushed = await box(cmp);
    expect({ w: pushed.w, h: pushed.h }).toEqual({ w: mine.w, h: mine.h });
    expect(overlaps(pushed, { x: bar.x - 12, y: bar.y - 12, w: bar.w + 24, h: bar.h + 24 })).toBe(
      false,
    );
    await dm.reload();
    await live(dm);
    await expect(cmp).toBeVisible();
    if (await panel.isVisible()) {
      await expect(cmp).toHaveAttribute("data-placed", "pushed");
      await dm.getByTestId("map-tool-select").click();
    }
    await expect(panel).toHaveCount(0);
    await expect.poll(() => box(cmp)).toEqual(mine);
    await expect(cmp).toHaveAttribute("data-placed", "stored");
  });

  await test.step("M5: Stats opened (untouched) → placed clear of the Compendium; the Compendium unmoved", async () => {
    const stats = await openWindow(dm, "stats.board");
    await expect(stats).not.toHaveAttribute("data-remembered", "true");
    expect(overlaps(await box(stats), mine)).toBe(false);
    expect(await box(cmp)).toEqual(mine);
    await cmp.getByTestId("ui-window-title").click();
    expect(await onTop(dm, "cmp.compendium")).toBe(true);
  });

  await test.step("M12: Reset layout → the named defaults, nothing remembered, launcher windows closed", async () => {
    await dm.getByTestId("ui-launcher-menu").click();
    await dm.getByTestId("ui-launcher-reset").click();
    await expect(cmp).toHaveCount(0);
    await expect
      .poll(() => box(shellWindow(dm, "dice.log")))
      .toEqual({
        x: 68,
        y: 584,
        w: 1150,
        h: 240,
      });
    expect((await openWindows(dm)).some((w) => w.remembered)).toBe(false);
    await openWindow(dm, "cmp.compendium");
    await expect(cmp).not.toHaveAttribute("data-remembered", "true");
  });
  await dm.context().close();
});
