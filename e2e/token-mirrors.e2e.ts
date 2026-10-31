// e2e-bundle: token-mirrors
// Token mirrors (MIR §13), DM + player-1 in their own contexts: token menu → Mirror → a cell puts a
// labelled copy on the map; the DM's right-click switches its mode and the player's screen follows
// (a shadow carries no name); the Select tool drags it; a player can't pick it.
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { konvaNodes, tokenNode } from "./support/konva";
import { mapPoint } from "./support/map";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

interface MirrorInfo {
  id: string;
  mode: string;
  off: boolean;
  x: number;
  y: number;
  label: string | null;
  /** Centre in page px. */
  cx: number;
  cy: number;
  listening: boolean;
}

/** Every mirror on the canvas. */
function mirrors(page: Page): Promise<MirrorInfo[]> {
  return page.evaluate(() => {
    type KNode = {
      id(): string;
      x(): number;
      y(): number;
      listening(): boolean;
      getAttr(a: string): unknown;
      findOne(s: string): KNode | undefined;
      getClientRect(): { x: number; y: number; width: number; height: number };
    };
    type KStage = { container(): HTMLElement; find(s: string): KNode[] };
    const K = (window as unknown as { Konva: { stages: KStage[] } }).Konva;
    const stage = K.stages[0];
    if (!stage) return [];
    const box = stage.container().getBoundingClientRect();
    return stage.find(".mir-mirror").map((n) => {
      const body = n.findOne("Rect") as KNode;
      const r = body.getClientRect();
      return {
        id: n.id(),
        mode: n.getAttr("mode") as string,
        off: n.getAttr("off") === true,
        x: n.x(),
        y: n.y(),
        label: (n.findOne(".mir-label")?.getAttr("text") as string | undefined) ?? null,
        cx: box.x + r.x + r.width / 2,
        cy: box.y + r.y + r.height / 2,
        listening: n.listening(),
      };
    });
  });
}

const byLabel = (list: MirrorInfo[], part: string) => list.find((m) => m.label?.includes(part));

test("FR-MIR-01 FR-MIR-06 FR-MIR-15 FR-MIR-16 mirror a token, switch its mode, it follows", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1440, height: 900 });
  await p1.goto(link("Player 1"));
  await live(dm);
  await live(p1);

  // The fixture's Transparent mirror: labelled for the DM, the plain name for the player.
  await expect.poll(async () => (await mirrors(dm)).length).toBe(1);
  await expect
    .poll(async () => (await mirrors(dm))[0]?.label)
    .toBe("Mirror · Goblin Sneak · Transparent");
  await expect.poll(async () => (await mirrors(p1))[0]?.label).toBe("Goblin Sneak");
  expect((await mirrors(p1))[0]?.listening).toBe(false);

  // Token menu → Mirror → a cell.
  await expect
    .poll(async () => (await konvaNodes(dm, "map-token-label")).some((l) => l.text === "Mira"))
    .toBe(true);
  const mira = (await konvaNodes(dm, "map-token-label")).find((l) => l.text === "Mira")
    ?.id as string;
  const t = await tokenNode(dm, mira);
  if (!t) throw new Error("Mira not on the DM's map");
  await dm.mouse.click(t.x, t.y, { button: "right" });
  await dm.getByTestId("mir-token-menu-create").click();
  await expect(dm.getByTestId("mir-pick-panel")).toBeVisible();
  const cell = await mapPoint(dm, 2, 2);
  await dm.mouse.click(cell.x, cell.y);
  await expect(dm.getByTestId("mir-pick-panel")).toHaveCount(0);
  await expect.poll(async () => byLabel(await mirrors(dm), "Mira")?.mode).toBe("visible");
  const made = byLabel(await mirrors(dm), "Mira") as MirrorInfo;
  expect({ x: made.x, y: made.y }).toEqual({ x: 2 * 70, y: 2 * 70 });
  await dm.screenshot({ path: test.info().outputPath("mirror-dm.png") });

  // Into the clear, so the evidence shots show it on the player's screen.
  const start = byLabel(await mirrors(dm), "Goblin Sneak") as MirrorInfo;
  const clear = await mapPoint(dm, 4, 2);
  await dm.mouse.move(start.cx, start.cy);
  await dm.mouse.down();
  await dm.mouse.move(clear.x, clear.y, { steps: 8 });
  await dm.mouse.up();
  await expect.poll(async () => (await mirrors(p1)).find((m) => m.id === start.id)?.x).toBe(4 * 70);
  await p1.screenshot({ path: test.info().outputPath("transparent-player.png") });

  // Right-click → Shadow: the player gets a dark shape with no name.
  const goblin = byLabel(await mirrors(dm), "Goblin Sneak") as MirrorInfo;
  await dm.mouse.click(goblin.cx, goblin.cy, { button: "right" });
  await expect(dm.getByTestId("mir-menu")).toBeVisible();
  await expect(dm.getByTestId("mir-menu-mode-transparent")).toHaveAttribute("data-current", "true");
  await dm.getByTestId("mir-menu-mode-shadow").click();
  await expect
    .poll(async () => (await mirrors(p1)).find((m) => m.id === goblin.id)?.mode)
    .toBe("shadow");
  expect((await mirrors(p1)).find((m) => m.id === goblin.id)?.label).toBeNull();
  await p1.screenshot({ path: test.info().outputPath("shadow-player.png") });

  // Hidden: gone for the player, faint and labelled for the DM.
  await dm.mouse.click(goblin.cx, goblin.cy, { button: "right" });
  await dm.getByTestId("mir-menu-mode-hidden").click();
  await expect.poll(async () => (await mirrors(p1)).some((m) => m.id === goblin.id)).toBe(false);
  await expect
    .poll(async () => (await mirrors(dm)).find((m) => m.id === goblin.id)?.off)
    .toBe(true);

  // Delete removes the mirror, not the token.
  await dm.mouse.click(goblin.cx, goblin.cy, { button: "right" });
  await dm.getByTestId("mir-menu-delete").click();
  await expect.poll(async () => (await mirrors(dm)).some((m) => m.id === goblin.id)).toBe(false);

  // FR-MIR-12: the Select tool drags a mirror to a new cell.
  const to = await mapPoint(dm, 5, 2);
  await dm.mouse.move(made.cx, made.cy);
  await dm.mouse.down();
  await dm.mouse.move(to.x, to.y, { steps: 8 });
  await dm.mouse.up();
  await expect.poll(async () => (await mirrors(dm)).find((m) => m.id === made.id)?.x).toBe(5 * 70);

  // Players have no token menu, so no Mirror entry.
  const seen = await tokenNode(p1, mira);
  if (!seen) throw new Error("Mira not on the player's map");
  await p1.mouse.click(seen.x, seen.y, { button: "right" });
  await expect(p1.getByTestId("mir-token-menu-create")).toHaveCount(0);
});
