// e2e-bundle: map-tools
// Labels + fit (MAP §13 M9, M10, sprint 4), DM + player-1: at 1440×900 the DM's Goblin Sneak /
// Goblin Sneak 2 labels collide → both cut to their footprint with "…", no overlap (FR-MAP-56);
// hovering Goblin Sneak draws its label in full, on top; Invisible on Goblin Sneak 2 is an icon
// chip (`compact`) clear of the name, its label as the canvas' tooltip (FR-MAP-57). player-1 at
// 1280×800 (sheet + Game log) fits a free rectangle clear of every window: no token centre under
// a window (FR-MAP-58, `data-fit-rect`).
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { konvaNodes, tokenNode } from "./support/konva";
import { showToPlayers } from "./support/scenes";
import { openWindow } from "./support/shell";

interface Drawn {
  id: string;
  name: string;
  text: string | null;
  attrs: Record<string, unknown>;
  /** Client rect, canvas px. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Index among the `map-labels` Group's children (draw order). */
  z: number;
}

/** Labels-layer nodes named `name` with their attrs and rects. */
async function labelNodes(page: Page, name: string): Promise<Drawn[]> {
  return page.evaluate((name) => {
    type KNode = {
      id(): string;
      name(): string;
      attrs: Record<string, unknown>;
      getClientRect(): { x: number; y: number; width: number; height: number };
      findOne(s: string): { text(): string } | undefined;
      getParent(): { zIndex(): number } | null;
    };
    type KStage = { find(s: string): KNode[] };
    const K = (window as unknown as { Konva?: { stages: KStage[] } }).Konva;
    return (K?.stages[0]?.find(`.${name}`) ?? []).map((n) => {
      const r = n.getClientRect();
      const { x, y, ...attrs } = n.attrs;
      void x;
      void y;
      return {
        id: n.id(),
        name: n.name(),
        text: n.findOne("Text")?.text() ?? null,
        attrs: JSON.parse(JSON.stringify(attrs)) as Record<string, unknown>,
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
        z: n.getParent()?.zIndex() ?? -1,
      };
    });
  }, name);
}

const overlap = (a: Drawn, b: Drawn) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const canvasTitle = (page: Page) =>
  page.evaluate(() => {
    const K = (window as unknown as { Konva?: { stages: { container(): HTMLElement }[] } }).Konva;
    return K?.stages.find((st) => st.container().isConnected)?.container().title ?? null;
  });

/** Token centres (page px) inside a rendered window. */
async function covered(page: Page): Promise<string[]> {
  const tokens = await konvaNodes(page, "map-token");
  const shown = page.locator('[data-testid="ui-window"]:not([data-state="minimised"])');
  const wins = await shown.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    }),
  );
  return tokens
    .filter((t) => wins.some((r) => t.x > r.x && t.x < r.x + r.w && t.y > r.y && t.y < r.y + r.h))
    .map((t) => t.id);
}

test("FR-MAP-56 / -57 / -58 labels shrink on collision, full on hover; Invisible as an icon chip; the player's fit picks a free rectangle clear of every window", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const ambush = recordId("battlemap", "scene");
  const sneak = recordId("mt-crowd", "token", 0);
  const sneak2 = recordId("mt-crowd", "token", 1);

  const dm = await rolePage(browser);
  const errors: string[] = [];
  dm.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await dm.setViewportSize({ width: 1440, height: 900 });
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
  await dm.getByTestId("map-tool-fit").click();
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-camera", "fitted");

  // FR-MAP-56: the two neighbours are cut (… to their footprint) and don't overlap.
  const pair = async () => {
    const labels = await labelNodes(dm, "map-token-label");
    return [sneak, sneak2].map((id) => labels.find((l) => l.id === id) as Drawn);
  };
  await expect
    .poll(async () => (await pair()).map((l) => [l?.attrs.cut, l?.text?.endsWith("…")]))
    .toEqual([
      [true, true],
      [true, true],
    ]);
  const [a, b] = await pair();
  if (!a || !b) throw new Error("no labels");
  expect(overlap(a, b)).toBe(false);
  expect(b.x - (a.x + a.w)).toBeGreaterThanOrEqual(3.5);

  // Hover Goblin Sneak's token → its label in full, drawn last (on top of its neighbour's).
  await dm.getByTestId("map-tool-select").click();
  const t = await tokenNode(dm, sneak);
  if (!t) throw new Error("no Goblin Sneak token");
  await dm.mouse.move(t.x, t.y - 8);
  await expect
    .poll(async () => {
      const [h] = await pair();
      return [h?.text, h?.attrs.full, h?.attrs.cut];
    })
    .toEqual(["Goblin Sneak", true, true]);
  const labels = await labelNodes(dm, "map-token-label");
  const top = Math.max(...labels.map((l) => l.z));
  expect(labels.find((l) => l.id === sneak)?.z).toBe(top);
  await dm.mouse.move(5, 300);
  await expect.poll(async () => (await pair())[0]?.attrs.full).toBe(false);

  // FR-MAP-59: the fit may go below 48 px (44 here, top row kept); badge rows above the name need
  // the 48 px this check was built for (BL-04), so zoom in one notch first.
  const dmCanvas = dm.getByTestId("map-canvas");
  if (Number(await dmCanvas.getAttribute("data-cell-px")) < 48) {
    const at = await tokenNode(dm, sneak2);
    if (!at) throw new Error("no Goblin Sneak 2 token");
    await dm.mouse.move(at.x, at.y);
    await dm.mouse.wheel(0, -100);
    await expect
      .poll(async () => Number(await dmCanvas.getAttribute("data-cell-px")))
      .toBeGreaterThanOrEqual(48);
  }
  // FR-MAP-57: Goblin Sneak 2 → Invisible: an icon chip, never cut text, clear of the name.
  const t2 = await tokenNode(dm, sneak2);
  if (!t2) throw new Error("no Goblin Sneak 2 token");
  await dm.mouse.click(t2.x, t2.y, { button: "right" });
  await dm.getByTestId("fog-token-menu-invisible").click();
  await expect
    .poll(async () => (await labelNodes(dm, "fog-token-invisible")).map((n) => n.attrs.compact))
    .toEqual([true]);
  const [chip] = await labelNodes(dm, "fog-token-invisible");
  const [, name2] = await pair();
  if (!chip || !name2) throw new Error("no chip");
  expect(chip.id).toBe(sneak2);
  expect(chip.text ?? "").not.toContain("…");
  expect(chip.w).toBeCloseTo(16, 0);
  expect(overlap(chip, name2)).toBe(false);
  // Its label on hover (the canvas' native title).
  const box = await dm.getByTestId("map-canvas").boundingBox();
  if (!box) throw new Error("no canvas");
  await dm.mouse.move(box.x + chip.x + chip.w / 2, box.y + chip.y + chip.h / 2);
  await expect.poll(() => canvasTitle(dm)).toBe("Invisible");
  await dm.mouse.move(5, 300);
  await expect.poll(() => canvasTitle(dm)).toBe("");

  // FR-MAP-58: player-1 at 1280×800 with its default sheet + Game log.
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1280, height: 800 });
  await p1.goto(link("Player 1"));
  await expect(p1.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const canvas = p1.getByTestId("map-canvas");
  await expect(canvas).toHaveAttribute("data-scene-id", ambush);
  await expect(canvas).toHaveAttribute("data-camera", "fitted");
  await expect(p1.locator('[data-testid="ui-window"]')).not.toHaveCount(0);
  // The picked rectangle (unit-tested against the candidates, `FR-MAP-58 best rectangle`) is
  // clear of every window, and no token centre player-1 sees sits under one.
  await expect(canvas).toHaveAttribute("data-fit-rect", /^\d+,\d+,\d+,\d+$/);
  const [rx, ry, rw, rh] = String(await canvas.getAttribute("data-fit-rect"))
    .split(",")
    .map(Number) as [number, number, number, number];
  const wins = await p1
    .locator('[data-testid="ui-window"]:not([data-state="minimised"])')
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as DOMRect));
  for (const w of wins) {
    const apart =
      w.right <= rx + 0.5 ||
      rx + rw <= w.left + 0.5 ||
      w.bottom <= ry + 0.5 ||
      ry + rh <= w.top + 0.5;
    expect(apart).toBe(true);
  }
  await expect.poll(async () => (await konvaNodes(p1, "map-token")).length).toBeGreaterThan(0);
  await expect.poll(() => covered(p1)).toEqual([]);
  expect(errors).toEqual([]);
});
