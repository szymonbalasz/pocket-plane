// e2e-bundle: fog
// Sprint-4 V7 (FOG §13 steps 14, 15, 26, 27; MAP §13 sprint-4 E2E), DM + player-1: the DM's plain
// battlemap outside the Fog tool and the Layers "Fog" switch (FR-FOG-20); the middle mouse pans
// under the Fog tool (a polygon draft kept), Select and Ruler, never reaching a tool (FR-MAP-12);
// at most four Konva layers, no Konva layer warning (FR-MAP-29, BL-07); Fit with the Game log
// shows the map's top row (FR-MAP-44, BL-01).
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { konvaNodes } from "./support/konva";
import { gridPoint, mapPoint } from "./support/map";
import { showToPlayers } from "./support/scenes";
import { openWindow, shellWindow } from "./support/shell";

/** Konva attr of the first node named `name`, drawn or not (null when absent). */
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

const stageLayers = (page: Page) =>
  page.evaluate(() => {
    type KStage = { getLayers(): { name(): string }[] };
    const K = (window as unknown as { Konva?: { stages: KStage[] } }).Konva;
    return K?.stages[0]?.getLayers().map((l) => l.name()) ?? [];
  });

const stageXY = (page: Page) =>
  page.evaluate(() => {
    const st = (window as unknown as { Konva: { stages: { x(): number; y(): number }[] } }).Konva
      .stages[0];
    return { x: st?.x() ?? 0, y: st?.y() ?? 0 };
  });

/** The stage moved by (dx, dy) screen px, give or take Playwright's pointer rounding. */
async function expectMoved(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  const at = await stageXY(page);
  expect(Math.abs(at.x - from.x - dx)).toBeLessThan(1.5);
  expect(Math.abs(at.y - from.y - dy)).toBeLessThan(1.5);
}

/** Records each middle press's `defaultPrevented` once its dispatch is over. */
async function watchMiddlePresses(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __middle: boolean[] };
    w.__middle = [];
    window.addEventListener(
      "mousedown",
      (e) => {
        if (e.button === 1) setTimeout(() => w.__middle.push(e.defaultPrevented));
      },
      true,
    );
  });
}
const middlePresses = (page: Page) =>
  page.evaluate(() => (window as unknown as { __middle: boolean[] }).__middle);

/** A middle-mouse drag from `at` by (dx, dy); checks `data-panning` while it runs. */
async function middleDrag(page: Page, at: { x: number; y: number }, dx: number, dy: number) {
  const canvas = page.getByTestId("map-canvas");
  await page.mouse.move(at.x, at.y);
  await page.mouse.down({ button: "middle" });
  await expect(canvas).toHaveAttribute("data-panning", "middle");
  for (let i = 1; i <= 5; i++) await page.mouse.move(at.x + (dx * i) / 5, at.y + (dy * i) / 5);
  await page.mouse.up({ button: "middle" });
  await expect(canvas).not.toHaveAttribute("data-panning", "middle");
}

async function viewAmbush(dm: Page, ambush: string) {
  const scenes = await openWindow(dm, "map.scenes");
  await scenes
    .locator(`[data-testid="map-scene-row"][data-record-id="${ambush}"] button`)
    .first()
    .click();
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-loading", "false");
  await scenes.getByTestId("ui-window-close").click();
}

test("FR-FOG-20 plain map + Layers Fog switch; FR-MAP-12 middle pan under Fog (draft kept), Select and Ruler; FR-MAP-29 ≤ 4 Konva layers (DM + player-1)", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const ambush = recordId("battlemap", "scene");
  const goblin = recordId("battlemap", "token", 1);

  const dm = await rolePage(browser);
  const warnings: string[] = [];
  const errors: string[] = [];
  dm.on("console", (m) => {
    if (/layers?\b.*\bstage|stage has/i.test(m.text())) warnings.push(m.text());
    if (m.type() === "error") errors.push(m.text());
  });
  const sent: string[] = [];
  dm.on("websocket", (ws) => ws.on("framesent", (f) => sent.push(String(f.payload))));
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  await viewAmbush(dm, ambush);
  await (await showToPlayers(dm, "Goblin Ambush")).getByTestId("ui-window-close").click();
  const canvas = dm.getByTestId("map-canvas");

  // FR-FOG-20: Select → the plain battlemap; the Fog / Invisible badges (token overlays) stay.
  await expect.poll(() => attrOf(dm, "fog-layer", "visible")).toBe(false);
  const badges = async () =>
    [
      ...(await konvaNodes(dm, "fog-token-fogged")),
      ...(await konvaNodes(dm, "fog-token-invisible")),
    ]
      .map((n) => `${n.name}:${n.id}`)
      .sort();
  const plainBadges = await badges();
  await dm.getByTestId("map-tool-fog").click();
  await expect.poll(() => attrOf(dm, "fog-layer", "visible")).toBe(true);
  expect(await badges()).toEqual(plainBadges);
  await dm.getByTestId("map-tool-select").click();
  await expect.poll(() => attrOf(dm, "fog-layer", "visible")).toBe(false);
  // Layers popover "Fog": off by default; on → drawn under Select; kept over a reload.
  await dm.getByTestId("map-tool-layers").click();
  const fogSwitch = dm.getByTestId("scn-layer-toggle-fog");
  await expect(fogSwitch).toHaveAttribute("data-state", "unchecked");
  await fogSwitch.click();
  await expect(fogSwitch).toHaveAttribute("data-state", "checked");
  await expect.poll(() => attrOf(dm, "fog-layer", "visible")).toBe(true);
  await expect(dm.getByTestId("map-tool-layers")).toHaveAttribute("data-some-off", "false");
  await dm.keyboard.press("Escape");
  await dm.reload();
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  await expect(canvas).toHaveAttribute("data-loading", "false");
  await expect.poll(() => attrOf(dm, "fog-layer", "visible")).toBe(true);
  await dm.getByTestId("map-tool-layers").click();
  await dm.getByTestId("scn-layer-toggle-fog").click();
  await expect(dm.getByTestId("scn-layer-toggle-fog")).toHaveAttribute("data-state", "unchecked");
  await dm.keyboard.press("Escape");
  await expect.poll(() => attrOf(dm, "fog-layer", "visible")).toBe(false);

  // FR-MAP-12: Fog + Polygon with 2 vertices placed; a middle drag pans, the draft keeps them.
  await watchMiddlePresses(dm);
  const scroll0 = await dm.evaluate(() => [window.scrollX, window.scrollY]);
  await dm.getByTestId("map-tool-fog").click();
  await dm.getByTestId("fog-shape-polygon").click();
  await mapPoint(dm, 17, 11, { margin: 3 });
  for (const [i, j] of [
    [15, 10],
    [19, 10],
  ] as const) {
    const c = await gridPoint(dm, i, j);
    await dm.mouse.click(c.x, c.y);
    await dm.waitForTimeout(350); // apart from the double-click window
  }
  await expect.poll(async () => (await konvaNodes(dm, "fog-draft-vertex")).length).toBe(2);
  const edits = () => sent.filter((f) => f.includes('"fog.edit"')).length;
  const editsBefore = edits();
  const before = await stageXY(dm);
  await middleDrag(dm, await gridPoint(dm, 17, 12), 60, 40);
  await expect(canvas).toHaveAttribute("data-camera", "moved");
  await expectMoved(dm, before, 60, 40);
  expect(await konvaNodes(dm, "fog-draft-vertex")).toHaveLength(2);
  expect(edits()).toBe(editsBefore);
  // The draft closes after the pan: a third vertex lands where the pointer is now.
  const third = await gridPoint(dm, 19, 13);
  await dm.mouse.click(third.x, third.y);
  await expect.poll(async () => (await konvaNodes(dm, "fog-draft-vertex")).length).toBe(3);
  await dm.keyboard.press("Escape");
  await expect.poll(async () => (await konvaNodes(dm, "fog-draft-vertex")).length).toBe(0);
  expect(edits()).toBe(editsBefore);

  // Select: a middle drag starting on a token pans; no selection, no move.
  await dm.getByTestId("map-tool-select").click();
  const g = (await konvaNodes(dm, "map-token", goblin))[0];
  if (!g) throw new Error("no Goblin token");
  await mapPoint(dm, 12, 6);
  const gAt = (await konvaNodes(dm, "map-token", goblin))[0] ?? g;
  const moves = () => sent.filter((f) => f.includes('"map.moveToken"')).length;
  const movesBefore = moves();
  const s0 = await stageXY(dm);
  await middleDrag(dm, gAt, -50, 30);
  await expectMoved(dm, s0, -50, 30);
  const ringOn = await dm.evaluate((id) => {
    type KNode = { id(): string; getAttr(a: string): unknown };
    const K = (window as unknown as { Konva: { stages: { find(s: string): KNode[] }[] } }).Konva;
    return (
      K.stages[0]?.find(".map-token-ring").some((n) => n.id() === id && n.getAttr("state")) ?? false
    );
  }, goblin);
  expect(ringOn).toBe(false);
  await dm.waitForTimeout(300);
  expect(moves()).toBe(movesBefore);

  // Ruler: a middle drag draws no ruler.
  await dm.getByTestId("map-tool-ruler").click();
  const r0 = await stageXY(dm);
  await middleDrag(dm, await mapPoint(dm, 6, 6), 40, -30);
  await expectMoved(dm, r0, 40, -30);
  expect(await konvaNodes(dm, "map-ruler-label-text")).toEqual([]);
  await dm.getByTestId("map-tool-select").click();

  // No autoscroll: every middle press was cancelled, the page never scrolled.
  await expect.poll(async () => (await middlePresses(dm)).length).toBeGreaterThanOrEqual(3);
  expect((await middlePresses(dm)).every(Boolean)).toBe(true);
  expect(await dm.evaluate(() => [window.scrollX, window.scrollY])).toEqual(scroll0);

  // FR-MAP-29 (BL-07): ≤ 4 Konva layers on both clients, no Konva layer warning.
  const player = await rolePage(browser);
  player.on("console", (m) => {
    if (/layers?\b.*\bstage|stage has/i.test(m.text())) warnings.push(`player: ${m.text()}`);
  });
  await player.goto(link("Player 1"));
  await expect(player.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  await expect(player.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  await dm.getByTestId("map-tool-fog").click(); // the DM's drawing tool mounts scn-edit
  for (const page of [dm, player]) {
    const names = await stageLayers(page);
    expect(names.length).toBeLessThanOrEqual(4);
    expect(names).toEqual(
      expect.arrayContaining(["map-layer-base", "map-layer-fog", "map-layer-objects"]),
    );
    // Player: the fog draws whatever the DM's tools or switches say.
    if (page === player) expect(await attrOf(player, "fog-layer", "visible")).toBe(true);
  }
  // The labels Group sits inside `objects` (FR-MAP-42, review A18).
  const labelsIn = await dm.evaluate(() => {
    type KNode = { getLayer(): { name(): string } | null };
    const K = (window as unknown as { Konva: { stages: { findOne(s: string): KNode }[] } }).Konva;
    return K.stages[0]?.findOne(".map-labels")?.getLayer()?.name() ?? null;
  });
  expect(labelsIn).toBe("map-layer-objects");
  expect(warnings).toEqual([]);
  expect(errors).toEqual([]);
  await player.context().close();
  await dm.context().close();
});

test("FR-MAP-44 BL-01 Fit with the Game log open: the map's top row sits below the top bar (1440×900, 1280×720)", async ({
  browser,
}) => {
  const { secret, recordId } = e2eEnv();
  const ambush = recordId("battlemap", "scene");
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  await viewAmbush(dm, ambush);
  const canvas = dm.getByTestId("map-canvas");
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
  ]) {
    await dm.setViewportSize(size);
    const log = await openWindow(dm, "dice.log");
    await expect(log).toBeVisible();
    await dm.getByTestId("map-tool-fit").click();
    await expect(canvas).toHaveAttribute("data-camera", "fitted");
    const cell = Number(await canvas.getAttribute("data-cell-px"));
    // Row 0 on screen: its top edge below the 48 px top bar, the whole row above the dock.
    await expect.poll(async () => (await gridPoint(dm, 0, 0)).y).toBeGreaterThanOrEqual(47.5);
    expect((await gridPoint(dm, 0, 1)).y).toBeLessThanOrEqual(size.height - 64);
    // FR-MAP-59 (#256): the 48 px floor yields down to 24 px only to keep every token visible ("all").
    const all = (await canvas.getAttribute("data-fit-visible")) === "all";
    expect(cell).toBeGreaterThanOrEqual(all ? 24 : 48);
    // Mira (the PC) stays clear of the Game log.
    const r = await shellWindow(dm, "dice.log").boundingBox();
    if (!r) throw new Error("no Game log box");
    const mira = (await konvaNodes(dm, "map-token", recordId("battlemap", "token", 0)))[0];
    if (!mira) throw new Error("no Mira token");
    expect(mira.x > r.x && mira.x < r.x + r.width && mira.y > r.y && mira.y < r.y + r.height).toBe(
      false,
    );
    // Close and reopen it, Fit again: the same framing.
    await log.getByTestId("ui-window-close").click();
    await openWindow(dm, "dice.log");
    await dm.getByTestId("map-tool-fit").click();
    await expect.poll(async () => (await gridPoint(dm, 0, 0)).y).toBeGreaterThanOrEqual(47.5);
  }
  await dm.context().close();
});
