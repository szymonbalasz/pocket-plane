// e2e-bundle: template-looks
// Template looks (SCN FR-SCN-64–73, #466), DM + player-1 in separate contexts: the fixture's
// kept "Caustic smoke" Mist sphere reaches both with its look, tint and cell opacity; the DM places
// a Ripple sphere and keeps it, then a second template, and both stay; player-1 receives the
// look; the DM's Edit… re-tints Caustic smoke for player-1; Map effects ▸ Off drops the DM's look
// graphics but keeps the templates, Full brings them back.
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { gridPoint, mapPoint } from "./support/map";
import { showToPlayers } from "./support/scenes";
import { openWindow, shellWindow } from "./support/shell";

interface TemplateNode {
  id: string;
  ephemeral: boolean;
  look: string;
  tint: string;
  cellOpacity: number;
  text: string | null;
}

/** `scn-template` Konva groups with the #466 attrs (SCN Appendix A). */
async function templates(page: Page): Promise<TemplateNode[]> {
  return page.evaluate(() => {
    type KNode = {
      id(): string;
      getAttr(a: string): unknown;
      findOne(s: string): { text(): string } | undefined;
    };
    type KStage = { find(s: string): KNode[] };
    const K = (window as unknown as { Konva?: { stages: KStage[] } }).Konva;
    return (K?.stages[0]?.find(".scn-template") ?? []).map((n) => ({
      id: n.id(),
      ephemeral: n.getAttr("ephemeral") === true,
      look: String(n.getAttr("look") ?? ""),
      tint: String(n.getAttr("tint") ?? ""),
      cellOpacity: Number(n.getAttr("cellOpacity")),
      text: (() => {
        const label = K?.stages[0]?.find(".scn-template-label").find((l) => l.id() === n.id());
        return label?.findOne(".scn-template-label-text")?.text() ?? null;
      })(),
    }));
  });
}

/** `scn-template-look` graphics drawn, by template id. */
const lookNodes = (page: Page) =>
  page.evaluate(() => {
    type KNode = { id(): string };
    type KStage = { find(s: string): KNode[] };
    const K = (window as unknown as { Konva?: { stages: KStage[] } }).Konva;
    return (K?.stages[0]?.find(".scn-template-look") ?? []).map((n) => n.id()).sort();
  });

/** FR-VFX-27: the FX loop's median frame (set on every FX frame), or null before any. */
const frameMs = (page: Page) =>
  page.evaluate(() => {
    type KNode = { getAttr(a: string): unknown };
    type KStage = { find(s: string): KNode[] };
    const K = (window as unknown as { Konva?: { stages: KStage[] } }).Konva;
    const v = K?.stages[0]?.find(".vfx-over-pass")[0]?.getAttr("frameMs");
    return typeof v === "number" ? v : null;
  });

/** A screenshot of the map inside Caustic smoke's circle (grid 8.2–11.8 × 7.2–8.8). */
async function smokeShot(page: Page): Promise<Buffer> {
  const a = await gridPoint(page, 8.2, 7.2);
  const b = await gridPoint(page, 11.8, 8.8);
  return page.screenshot({ clip: { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y } });
}

const byLabel = async (page: Page, label: string) =>
  (await templates(page)).find((t) => !t.ephemeral && t.text?.startsWith(`${label} · `));

/** Presses at grid (x, y) and drags to (tx, ty) with the AoE tool on. */
async function drag(page: Page, x: number, y: number, tx: number, ty: number) {
  const from = await gridPoint(page, x, y);
  const to = await gridPoint(page, tx, ty);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / 5, from.y + ((to.y - from.y) * i) / 5);
  }
  await page.mouse.up();
}

test("FR-SCN-64–73 template looks: kept looks reach the player, a second template keeps the first, Edit… re-tints, Map effects Off hides the graphics only", async ({
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
  await shellWindow(dm, "map.scenes").getByTestId("ui-window-close").click();

  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await expect(p1.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  await expect(p1.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);

  // FR-SCN-64, -67: the fixture's Mist sphere, on both; an old-shape template has no look.
  const smoke = { look: "mist", tint: "#7d8590", cellOpacity: 10 };
  for (const p of [dm, p1]) {
    await expect.poll(async () => (await byLabel(p, "Caustic smoke"))?.look).toBe("mist");
    expect(await byLabel(p, "Caustic smoke")).toMatchObject(smoke);
    expect(await byLabel(p, "Spirit Guardians")).toMatchObject({ look: "none", cellOpacity: 22 });
    const id = (await byLabel(p, "Caustic smoke"))?.id as string;
    await expect.poll(() => lookNodes(p)).toContain(id);
  }

  // FR-SCN-70: at Full the looks move with no aura on the map: the FX loop runs, frames differ.
  await dm.mouse.move(2, 2);
  await expect.poll(() => frameMs(dm)).not.toBeNull();
  const full1 = await smokeShot(dm);
  await dm.waitForTimeout(900);
  expect((await smokeShot(dm)).equals(full1)).toBe(false);

  // FR-SCN-66: the DM places a Ripple sphere "Silence" with 20 % cells, keeps it.
  await dm.getByTestId("map-tool-aoe").click();
  await expect(dm.getByTestId("scn-aoe-panel")).toBeVisible();
  await dm.getByTestId("scn-aoe-shape-sphere").click();
  await dm.getByTestId("scn-aoe-label").fill("Silence");
  await dm.getByTestId("scn-aoe-label").press("Enter");
  await dm.getByTestId("scn-aoe-look-ripple").click();
  await expect(dm.getByTestId("scn-aoe-tint-swatch").first()).toHaveAttribute(
    "data-default",
    "true",
  );
  const cells = dm.getByTestId("scn-aoe-cells").getByRole("slider");
  await cells.focus();
  // 10 % (the look's default) → 20 %.
  await cells.press("ArrowRight");
  await cells.press("ArrowRight");
  await expect(dm.getByTestId("scn-aoe-cells")).toHaveAttribute("data-value", "20");
  await mapPoint(dm, 15, 4, { margin: 3 });
  await drag(dm, 15.5, 4.5, 17.5, 4.5);
  // FR-SCN-73: the ephemeral carries the look for the player too.
  await expect
    .poll(async () => (await templates(p1)).find((t) => t.ephemeral)?.look)
    .toBe("ripple");
  await dm.getByTestId("scn-aoe-keep").click();
  for (const p of [dm, p1]) {
    await expect.poll(async () => (await byLabel(p, "Silence"))?.look).toBe("ripple");
    expect((await byLabel(p, "Silence"))?.cellOpacity).toBe(20);
  }

  // A second placement (no look) is kept too: the first stays (Keep = persistent, FR-SCN-25).
  await dm.getByTestId("scn-aoe-label").fill("Pit");
  await dm.getByTestId("scn-aoe-label").press("Enter");
  await dm.getByTestId("scn-aoe-look-none").click();
  await drag(dm, 15.5, 10.5, 16.5, 10.5);
  await dm.getByTestId("scn-aoe-keep").click();
  for (const p of [dm, p1]) {
    await expect.poll(async () => (await byLabel(p, "Pit"))?.look).toBe("none");
    expect((await byLabel(p, "Silence"))?.look).toBe("ripple");
    expect((await byLabel(p, "Caustic smoke"))?.look).toBe("mist");
  }

  // FR-SCN-48 / -66: Edit… Caustic smoke, tint it poison green; player-1 receives it.
  const inside = await gridPoint(dm, 11.5, 7.5);
  await dm.mouse.click(inside.x, inside.y, { button: "right" });
  await dm.getByTestId("scn-template-ctx-edit").click();
  await expect(dm.getByTestId("scn-aoe-selected")).toBeVisible();
  await dm.locator('[data-testid="scn-aoe-tint-swatch"][data-value="#6f9a3a"]').click();
  for (const p of [dm, p1]) {
    await expect.poll(async () => (await byLabel(p, "Caustic smoke"))?.tint).toBe("#6f9a3a");
  }

  // FR-SCN-70: Map effects ▸ Still: one fixed frame. Off: no look graphics, the templates stay.
  await dm.keyboard.press("Escape");
  await dm.getByTestId("ui-prefs-open").click();
  const prefs = shellWindow(dm, "shell.prefs");
  await prefs.getByTestId("vfx-pref-level-still").click();
  await prefs.getByTestId("ui-window-close").click();
  await dm.mouse.move(2, 2);
  await dm.waitForTimeout(300);
  const still1 = await smokeShot(dm);
  await dm.waitForTimeout(900);
  expect((await smokeShot(dm)).equals(still1)).toBe(true);
  await dm.getByTestId("ui-prefs-open").click();
  await prefs.getByTestId("vfx-pref-level-off").click();
  await expect.poll(() => lookNodes(dm)).toEqual([]);
  expect((await byLabel(dm, "Caustic smoke"))?.look).toBe("mist");
  expect((await lookNodes(p1)).length).toBe(3);
  await prefs.getByTestId("vfx-pref-level-full").click();
  // Caustic smoke, Spike Growth (the fixture's Ground cube), Silence.
  await expect.poll(async () => (await lookNodes(dm)).length).toBe(3);

  expect(errors).toEqual([]);
});
