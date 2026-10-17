// e2e-bundle: vision
// Thin fog brush + history flow (FOG §13 sprint 4, V9; walkthrough steps 16–17). DM and player-1
// in separate contexts on Goblin Ambush (row 2 lies in the static Explored polygon): Reveal +
// Brush, 10 ft, snapped, drag (14, 2) → (18, 2) → whole cells revealed for player-1 (fewer
// explored cells); Fog + Brush with Ctrl → a free stroke (more fogged cells); Ctrl+Z, Ctrl+Z,
// Ctrl+Shift+Z; reload; Ctrl+Y; a new stroke clears redo. A middle-drag under Brush pans and
// draws nothing.
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { gridPoint, mapPoint, panMap } from "./support/map";
import { showToPlayers } from "./support/scenes";
import { openWindow } from "./support/shell";

/** Konva attr of the first node named `name` (null when absent). */
async function attrOf(page: Page, name: string, attr: string) {
  return page.evaluate(
    ([name, attr]) => {
      type KNode = { getAttr(a: string): unknown };
      type KStage = { findOne(s: string): KNode | undefined };
      const K = (window as unknown as { Konva?: { stages: KStage[] } }).Konva;
      return (K?.stages[0]?.findOne(`.${name}`)?.getAttr(attr) as unknown) ?? null;
    },
    [name, attr] as const,
  );
}

/** Left-drag through grid points (cells), `steps` moves per leg; `check` runs before the release. */
async function stroke(page: Page, pts: [number, number][], check?: () => Promise<void>) {
  const at = await Promise.all(pts.map(([x, y]) => gridPoint(page, x, y)));
  const [first, ...rest] = at as [{ x: number; y: number }, ...{ x: number; y: number }[]];
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  let prev = first;
  for (const p of rest) {
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(prev.x + ((p.x - prev.x) * i) / 6, prev.y + ((p.y - prev.y) * i) / 6);
    }
    prev = p;
  }
  if (check) await check();
  await page.mouse.up();
}

test("FR-FOG-55 / -56 / -57 / -17 brush + history: snapped Reveal and free Fog strokes reach player-1; Ctrl+Z ×2, Ctrl+Shift+Z, reload, Ctrl+Y; a new stroke clears redo (DM + player-1)", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const ambush = recordId("battlemap", "scene");

  const dm = await rolePage(browser);
  const errors: string[] = [];
  dm.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const scenes = await openWindow(dm, "map.scenes");
  await scenes
    .locator(`[data-testid="map-scene-row"][data-record-id="${ambush}"] button`)
    .first()
    .click();
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-loading", "false");
  await showToPlayers(dm, "Goblin Ambush");
  await scenes.getByTestId("ui-window-close").click();

  const p1 = await rolePage(browser);
  const p1Frames: string[] = [];
  p1.on("websocket", (ws) => ws.on("framereceived", (f) => p1Frames.push(String(f.payload))));
  p1.on("console", (m) => {
    if (m.type() === "error") errors.push(`Player 1: ${m.text()}`);
  });
  await p1.goto(link("Player 1"));
  await expect(p1.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  await expect(p1.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  await expect(p1.getByTestId("map-canvas")).toHaveAttribute("data-loading", "false");
  const p1Count = async (attr: "explored-cells" | "fogged-cells") =>
    Number(await attrOf(p1, "fog-mask", attr));
  await expect.poll(() => attrOf(p1, "fog-mask", "explored-cells")).not.toBeNull();
  const explored0 = await p1Count("explored-cells");
  const fogged0 = await p1Count("fogged-cells");

  // The Fog tool, Reveal + Brush; the radius defaults to 10 ft.
  await dm.getByTestId("map-tool-fog").click();
  await dm.getByTestId("fog-mode-reveal").click();
  await dm.getByTestId("fog-shape-brush").click();
  await expect(dm.getByTestId("fog-shape-brush")).toHaveAttribute("data-state", "on");
  await expect(dm.getByTestId("fog-brush-radius")).toHaveAttribute("data-value", "10");
  const undo = dm.getByTestId("fog-undo");
  const redo = dm.getByTestId("fog-redo");
  const depth = Number(await undo.getAttribute("data-depth"));
  await expect(redo).toHaveAttribute("data-depth", "0");
  // Row 2 from column 13 to 19 clear of the bar and windows.
  await mapPoint(dm, 16, 2, { margin: 3 });

  // FR-FOG-55: a middle-drag under Brush pans and paints nothing (FR-MAP-12).
  await panMap(dm, 0, 20);
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-camera", "moved");
  await mapPoint(dm, 16, 2, { margin: 3 });
  expect(await attrOf(dm, "fog-brush-draft", "mode")).toBeNull();
  await expect(undo).toHaveAttribute("data-depth", String(depth));

  // Step 16a: snapped Reveal stroke (14, 2) → (18, 2); the draft previews whole cells.
  await stroke(
    dm,
    [
      [14.5, 2.5],
      [18.5, 2.5],
    ],
    async () => {
      expect(await attrOf(dm, "fog-brush-draft", "mode")).toBe("snapped");
      expect(((await attrOf(dm, "fog-brush-draft", "cells")) as number[]).length).toBeGreaterThan(
        0,
      );
    },
  );
  await expect(undo).toHaveAttribute("data-depth", String(depth + 1));
  await expect.poll(() => p1Count("explored-cells")).toBeLessThan(explored0);
  const explored1 = await p1Count("explored-cells");
  const foggedA = await p1Count("fogged-cells");

  // Step 16b: Fog + Brush with Ctrl: a free round stroke (15.5, 2.3) → (17.5, 2.6).
  await dm.getByTestId("fog-mode-fog").click();
  await dm.keyboard.down("Control");
  await stroke(
    dm,
    [
      [15.5, 2.3],
      [16.5, 2.45],
      [17.5, 2.6],
    ],
    async () => {
      expect(await attrOf(dm, "fog-brush-draft", "mode")).toBe("free");
      expect(await attrOf(dm, "fog-brush-draft", "r")).toBe(2);
    },
  );
  await dm.keyboard.up("Control");
  await expect(undo).toHaveAttribute("data-depth", String(depth + 2));
  await expect.poll(() => p1Count("fogged-cells")).toBeGreaterThan(foggedA);

  // Step 17: Ctrl+Z removes the free stroke, Ctrl+Z the snapped one, Ctrl+Shift+Z brings it back.
  await dm.keyboard.press("Control+z");
  await expect(undo).toHaveAttribute("data-depth", String(depth + 1));
  await expect(redo).toHaveAttribute("data-depth", "1");
  await expect.poll(() => p1Count("fogged-cells")).toBe(foggedA);
  await dm.keyboard.press("Control+z");
  await expect(undo).toHaveAttribute("data-depth", String(depth));
  await expect(redo).toHaveAttribute("data-depth", "2");
  await expect.poll(() => p1Count("explored-cells")).toBe(explored0);
  expect(await p1Count("fogged-cells")).toBe(fogged0);
  await dm.keyboard.press("Control+Shift+Z");
  await expect(undo).toHaveAttribute("data-depth", String(depth + 1));
  await expect(redo).toHaveAttribute("data-depth", "1");
  await expect.poll(() => p1Count("explored-cells")).toBe(explored1);

  // Reload: the server stack keeps both depths; Ctrl+Y re-applies the free stroke.
  await dm.reload();
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-loading", "false");
  await dm.getByTestId("map-tool-fog").click();
  await expect(undo).toHaveAttribute("data-depth", String(depth + 1));
  await expect(redo).toHaveAttribute("data-depth", "1");
  await dm.keyboard.press("Control+y");
  await expect(undo).toHaveAttribute("data-depth", String(depth + 2));
  await expect(redo).toHaveAttribute("data-depth", "0");
  await expect.poll(() => p1Count("fogged-cells")).toBeGreaterThan(foggedA);

  // A new stroke after an undo clears redo.
  await dm.keyboard.press("Control+z");
  await expect(redo).toHaveAttribute("data-depth", "1");
  await dm.getByTestId("fog-shape-brush").click();
  await mapPoint(dm, 16, 2, { margin: 3 });
  await stroke(dm, [
    [15.5, 2.5],
    [16.5, 2.5],
  ]);
  await expect(redo).toHaveAttribute("data-depth", "0");
  await expect(undo).toHaveAttribute("data-depth", String(depth + 2));

  // Player-1 got the strokes as fog only: no undo / redo info, no draft.
  for (const f of p1Frames) {
    expect(f).not.toContain('"undo"');
    expect(f).not.toContain('"redo"');
  }
  expect(errors).toEqual([]);
});
