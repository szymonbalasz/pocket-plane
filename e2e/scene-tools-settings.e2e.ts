// e2e-bundle: scene-tools
// Thin scene-tools settings flows (SCN §13 steps 9-10), DM + player-1 in separate contexts:
// the DM's Ruler panel switches Diagonals to 5 ft and player-1's ruler (2, 7) → (5, 9) reads
// "15 ft" (was "20 ft"), then back; the DM's Layers popover hides walls and DM-only items on the
// DM canvas only (nothing sent), the switches survive a reload, and come back on. Leaves the
// bundle as loaded (5/10/5; layer switches live in the DM's own browser storage).
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { konvaNodes } from "./support/konva";
import { openWindow, shellWindow } from "./support/shell";

/** Map px → page px on the first stage. */
async function mapToPage(page: Page, x: number, y: number) {
  return page.evaluate(
    ([x, y]) => {
      type KStage = { container(): HTMLElement; x(): number; y(): number; scaleX(): number };
      const st = (window as unknown as { Konva: { stages: KStage[] } }).Konva.stages[0] as KStage;
      const box = st.container().getBoundingClientRect();
      return { x: box.left + st.x() + x * st.scaleX(), y: box.top + st.y() + y * st.scaleX() };
    },
    [x, y] as const,
  );
}

/** Ruler from cell `a` to cell `b` (70 px cells, offset 0); the label text while held. */
async function rule(page: Page, a: [number, number], b: [number, number]) {
  const from = await mapToPage(page, a[0] * 70 + 35, a[1] * 70 + 35);
  const to = await mapToPage(page, b[0] * 70 + 35, b[1] * 70 + 35);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / 6, from.y + ((to.y - from.y) * i) / 6);
  }
  await expect
    .poll(async () => (await konvaNodes(page, "map-ruler-label-text"))[0]?.text)
    .toMatch(/ ft$/);
  const text = (await konvaNodes(page, "map-ruler-label-text"))[0]?.text;
  await page.mouse.up();
  return text;
}

/** Visible Konva nodes named `name` whose attr `a` is `v`. */
async function countWith(page: Page, name: string, a: string, v: unknown) {
  return page.evaluate(
    ([name, a, v]) => {
      type KNode = { getAttr(a: string): unknown; isVisible(): boolean };
      type KStage = { find(s: string): KNode[] };
      const K = (window as unknown as { Konva?: { stages: KStage[] } }).Konva;
      return (K?.stages[0]?.find(`.${name}`) ?? []).filter(
        (n) => n.isVisible() && n.getAttr(a) === v,
      ).length;
    },
    [name, a, v] as const,
  );
}

test("FR-SCN-29 / -30 / -05 diagonal rule on everyone's ruler; DM-only layer switches (DM + player-1)", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const ambush = recordId("battlemap", "scene");

  const dm = await rolePage(browser);
  let intents = 0;
  dm.on("websocket", (ws) =>
    ws.on("framesent", (f) => {
      if (String(f.payload).includes('"type":"intent"')) intents++;
    }),
  );
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const player = await rolePage(browser);
  await player.goto(link("Player 1"));
  await expect(player.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  await expect(player.getByTestId("map-canvas")).toHaveAttribute("data-loading", "false");

  // Step 9: 5/10/5 by default: (2, 7) → (5, 9) = 20 ft.
  await player.getByTestId("map-tool-ruler").click();
  expect(await rule(player, [2, 7], [5, 9])).toBe("20 ft");

  // The DM's Ruler panel: Diagonals 5 ft → player-1 reads 15 ft.
  await dm.getByTestId("map-tool-ruler").click();
  // The active rail tool keeps its highlight under the hover hint (ToggleTip).
  await expect(dm.getByTestId("map-tool-ruler")).toHaveAttribute("data-state", "on");
  await expect(dm.getByTestId("map-tool-select")).toHaveAttribute("data-state", "off");
  const diagonals = dm.getByTestId("scn-diagonal-rule");
  await expect(diagonals).toHaveAttribute("data-value", "5-10-5");
  await dm.getByTestId("scn-diagonal-rule-5").click();
  await expect(diagonals).toHaveAttribute("data-value", "5");
  await expect.poll(() => rule(player, [2, 7], [5, 9])).toBe("15 ft");
  expect(await rule(dm, [2, 7], [5, 9])).toBe("15 ft");
  // Players have no Ruler panel.
  await expect(player.getByTestId("map-tool-panel")).toHaveCount(0);
  await dm.getByTestId("scn-diagonal-rule-5-10-5").click();
  await expect(diagonals).toHaveAttribute("data-value", "5-10-5");
  await expect.poll(() => rule(player, [2, 7], [5, 9])).toBe("20 ft");
  await dm.getByTestId("map-tool-select").click();
  await expect(dm.getByTestId("map-tool-panel")).toHaveCount(0);

  // Step 10: the DM views Goblin Ambush: walls, the hidden chest.
  const scenes = await openWindow(dm, "map.scenes");
  await scenes
    .locator(`[data-testid="map-scene-row"][data-record-id="${ambush}"] button`)
    .first()
    .click();
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-loading", "false");
  await shellWindow(dm, "map.scenes").getByTestId("ui-window-close").click();
  await expect.poll(async () => (await konvaNodes(dm, "scn-walls")).length).toBe(1);
  await expect.poll(() => countWith(dm, "scn-prop", "hidden", true)).toBe(1);
  const doors = (await konvaNodes(dm, "scn-door")).length;
  expect(doors).toBe(2);
  // Hidden Wolf + Elite: their eye-off marks and labels.
  await expect.poll(async () => (await konvaNodes(dm, "map-token-hidden")).length).toBe(2);
  const labels = (await konvaNodes(dm, "map-token-label")).length;
  const tokens = (await konvaNodes(dm, "map-token")).length;

  // Layers: Walls & doors off, DM-only items off. Nothing is sent.
  await dm.getByTestId("map-tool-layers").click();
  await expect(dm.getByTestId("scn-layers")).toBeVisible();
  const walls = dm.getByTestId("scn-layer-toggle-walls");
  const dmOnly = dm.getByTestId("scn-layer-toggle-dm-only");
  await expect(walls).toHaveAttribute("aria-checked", "true");
  await expect(dm.getByTestId("scn-layer-toggle-props")).toHaveAttribute("aria-checked", "true");
  await expect(dm.getByTestId("scn-layer-toggle-templates")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  const before = intents;
  await walls.click();
  await dmOnly.click();
  await expect(walls).toHaveAttribute("aria-checked", "false");
  await expect(dmOnly).toHaveAttribute("aria-checked", "false");
  await expect.poll(async () => (await konvaNodes(dm, "scn-door")).length).toBe(0);
  expect(await konvaNodes(dm, "scn-walls")).toHaveLength(0);
  await expect.poll(() => countWith(dm, "scn-prop", "hidden", true)).toBe(0);
  expect(await countWith(dm, "scn-prop", "hidden", false)).toBe(2);
  // Hidden tokens and their labels go too (FR-SCN-01).
  expect(await konvaNodes(dm, "map-token-hidden")).toHaveLength(0);
  expect(await konvaNodes(dm, "map-token")).toHaveLength(tokens - 2);
  expect(await konvaNodes(dm, "map-token-label")).toHaveLength(labels - 2);
  await expect(dm.getByTestId("map-tool-layers")).toHaveAttribute("data-some-off", "true");
  expect(intents).toBe(before);
  await dm.keyboard.press("Escape");

  // Kept per campaign in this browser: a reload keeps them off.
  await dm.reload();
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  await expect(dm.getByTestId("map-tool-layers")).toHaveAttribute("data-some-off", "true");
  await dm.getByTestId("map-tool-layers").click();
  await expect(dm.getByTestId("scn-layer-toggle-walls")).toHaveAttribute("aria-checked", "false");
  await expect(dm.getByTestId("scn-layer-toggle-dm-only")).toHaveAttribute("aria-checked", "false");
  await dm.getByTestId("scn-layer-toggle-walls").click();
  await dm.getByTestId("scn-layer-toggle-dm-only").click();
  await expect(dm.getByTestId("map-tool-layers")).toHaveAttribute("data-some-off", "false");
  await dm.keyboard.press("Escape");

  await player.context().close();
  await dm.context().close();
});
