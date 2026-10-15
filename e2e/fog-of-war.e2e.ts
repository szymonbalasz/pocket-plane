// e2e-bundle: fog
// Thin fog-of-war flows (FOG §13 E2E), DM part (build/fog-client; players see nothing new until
// build/fog-visibility adds the player part): Goblin Ambush under translucent fog with "Fog"
// badges; Fog tool: reveal a rect over Goblin, a polygon over Goblin Lurker, Undo; Space + drag
// pans without an edit; Reveal all, Fog all (confirm).
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { konvaNodes } from "./support/konva";
import { openWindow } from "./support/shell";

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

/** Konva attr of the first node named `name` (null when absent). */
async function attrOf(page: Page, name: string, attr: string) {
  return page.evaluate(
    ([name, attr]) => {
      type KNode = { getAttr(a: string): unknown };
      type KStage = { findOne(s: string): KNode | undefined };
      const K = (window as unknown as { Konva?: { stages: KStage[] } }).Konva;
      return (
        (K?.stages[0]?.findOne(`.${name}`)?.getAttr(attr) as number | string | undefined) ?? null
      );
    },
    [name, attr] as const,
  );
}

const fogBadges = async (page: Page) =>
  (await konvaNodes(page, "fog-token-fogged")).map((n) => n.id).sort();

/** Goblin Ambush: 70 px cells, offset 0. Corner (i, j) / centre of cell (c, r) in page px. */
const corner = (page: Page, i: number, j: number) => mapToPage(page, i * 70, j * 70);
const centre = (page: Page, c: number, r: number) =>
  mapToPage(page, (c + 0.5) * 70, (r + 0.5) * 70);

test("FR-FOG-17–20 DM fog render, rect + polygon reveal, Undo, Space pan, Reveal / Fog all", async ({
  browser,
}) => {
  const { secret, recordId } = e2eEnv();
  const ambush = recordId("battlemap", "scene");
  const goblin = recordId("battlemap", "token", 1);
  const goblin2 = recordId("goblin-2", "token");
  const lurker = recordId("fog-ambush", "token");

  const dm = await rolePage(browser);
  const errors: string[] = [];
  dm.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  const sent: string[] = [];
  dm.on("websocket", (ws) => ws.on("framesent", (f) => sent.push(String(f.payload))));
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const scenes = await openWindow(dm, "map.scenes");
  await scenes
    .locator(`[data-testid="map-scene-row"][data-record-id="${ambush}"] button`)
    .first()
    .click();
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-loading", "false");
  await scenes.getByTestId("ui-window-close").click(); // clear of the map

  // FR-FOG-20: translucent fog; "Fog" on the fog-hidden tokens only (Wolf, Elite: hidden styling).
  await expect.poll(() => attrOf(dm, "fog-mask", "opacity")).toBe(0.5);
  const cells0 = Number(await attrOf(dm, "fog-mask", "fogged-cells"));
  expect(cells0).toBeGreaterThan(0);
  await expect.poll(() => fogBadges(dm)).toEqual([goblin, goblin2, lurker].sort());

  // FR-FOG-17: the Fog tool opens the fog bar; defaults Reveal, Rectangle; undo depth 3.
  await dm.getByTestId("map-tool-fog").click();
  const bar = dm.getByTestId("fog-bar");
  await expect(bar).toBeVisible();
  await expect(dm.getByTestId("fog-mode-reveal")).toHaveAttribute("data-state", "on");
  await expect(dm.getByTestId("fog-shape-rect")).toHaveAttribute("data-state", "on");
  const undo = dm.getByTestId("fog-undo");
  await expect(undo).toHaveAttribute("data-depth", "3");

  // FR-FOG-18: drag (11, 5)–(13, 7) → Goblin (12, 6) clear; Goblin 2 (12, 8) still fogged.
  const a = await centre(dm, 11, 5);
  const b = await centre(dm, 13, 7);
  await dm.mouse.move(a.x, a.y);
  await dm.mouse.down();
  for (let i = 1; i <= 5; i++) {
    await dm.mouse.move(a.x + ((b.x - a.x) * i) / 5, a.y + ((b.y - a.y) * i) / 5);
  }
  await expect.poll(() => attrOf(dm, "fog-draft", "kind")).toBe("rect");
  await dm.mouse.up();
  await expect(undo).toHaveAttribute("data-depth", "4");
  await expect.poll(() => fogBadges(dm)).toEqual([goblin2, lurker].sort());
  await expect.poll(() => attrOf(dm, "fog-draft", "kind")).toBeNull();
  expect(Number(await attrOf(dm, "fog-mask", "fogged-cells"))).toBe(cells0 - 9);

  // FR-FOG-17: Space + drag pans, no edit.
  const editsBefore = sent.filter((f) => f.includes('"fog.edit"')).length;
  const stageX = () =>
    dm.evaluate(() =>
      (window as unknown as { Konva: { stages: { x(): number }[] } }).Konva.stages[0]?.x(),
    );
  const x0 = await stageX();
  const p = await centre(dm, 4, 12);
  await dm.keyboard.down("Space");
  await dm.mouse.move(p.x, p.y);
  await dm.mouse.down();
  for (let i = 1; i <= 5; i++) await dm.mouse.move(p.x + i * 12, p.y);
  await dm.mouse.up();
  await dm.keyboard.up("Space");
  await expect.poll(stageX).not.toBe(x0);
  expect(sent.filter((f) => f.includes('"fog.edit"')).length).toBe(editsBefore);

  // FR-FOG-19: polygon (15, 10), (19, 10), (19, 13), (15, 13), first corner → Lurker (17, 11) clear.
  await dm.getByTestId("fog-shape-polygon").click();
  for (const [i, j] of [
    [15, 10],
    [19, 10],
    [19, 13],
    [15, 13],
  ] as const) {
    const c = await corner(dm, i, j);
    await dm.mouse.click(c.x, c.y);
    await dm.waitForTimeout(350); // apart from the double-click window
  }
  await expect.poll(async () => (await konvaNodes(dm, "fog-draft-vertex")).length).toBe(4);
  const first = await corner(dm, 15, 10);
  await dm.mouse.click(first.x, first.y);
  await expect(undo).toHaveAttribute("data-depth", "5");
  await expect.poll(() => fogBadges(dm)).toEqual([goblin2]);

  // FR-FOG-07 / -17: Undo (Tooltip names the step) → Lurker fogged again.
  await undo.hover();
  await expect(dm.getByRole("tooltip").first()).toContainText("Undo: reveal polygon");
  await undo.click();
  await expect(undo).toHaveAttribute("data-depth", "4");
  await expect.poll(() => fogBadges(dm)).toEqual([goblin2, lurker].sort());

  // FR-FOG-06: Reveal all → no badge; Fog all (confirm) → every ownerless visible token badged.
  await dm.getByTestId("fog-reveal-all").click();
  await expect(undo).toHaveAttribute("data-depth", "5");
  await expect.poll(() => fogBadges(dm)).toEqual([]);
  await expect.poll(() => attrOf(dm, "fog-mask", "fogged-cells")).toBe(0);
  await dm.getByTestId("fog-fog-all").click();
  await expect(dm.getByRole("alertdialog")).toContainText("Fog the whole scene?");
  await dm.getByTestId("fog-fog-all-confirm").click();
  await expect(undo).toHaveAttribute("data-depth", "6");
  await expect.poll(() => fogBadges(dm)).toEqual(expect.arrayContaining([goblin, goblin2, lurker]));
  expect(await fogBadges(dm)).not.toContain(recordId("battlemap", "token", 2)); // Wolf: hidden

  expect(errors).toEqual([]);
});
