// e2e-bundle: player-colours
// Thin player colours on the map (MAP FR-MAP-68–70, -72, -73; SCN FR-SCN-47; CAMP §13 K2–K5), DM
// (A) + player-1 (B) + player-2 (C) in separate contexts on Goblin Ambush. K2: B picks rose →
// Spirit Guardians redraws rose on A, B, C (Thunderwave blue, Web amber, Glyph hidden-grey on A).
// K3: B's laser and ping rose on A and C over a `map-casing` with a "Player 1" chip, own marks rose
// with no chip; A's ping and pull amber with a "DM" chip on B and C; no signal frame has `color`.
// K4: B keeps a cone "Burning Hands" → rose on A and C, its label reads "by Player 1" on hover;
// C's live sphere blue on A and B, Esc removes it. K5: B's held drag on Mira rose on A, B, C;
// the DM's drag on Thorn blue on all; on Goblin Sneak amber on A only (players: no path).
import { expect, type Page, test } from "@playwright/test";
import { PLAYER_COLORS } from "../src/shared/campaign-management/colors";
import { pickOwnColour } from "./support/colour";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { konvaNodes } from "./support/konva";
import { gridPoint, mapPoint } from "./support/map";
import { showToPlayers } from "./support/scenes";
import { openWindow } from "./support/shell";

interface Mark {
  id: string;
  color: string | null;
  by: string | null;
  ephemeral: boolean;
  text: string | null;
}

/** Konva nodes named `name` on the map canvas with their colour attrs (MAP §7 / SCN App. A). */
function marks(page: Page, name: string): Promise<Mark[]> {
  return page.evaluate((name) => {
    type KNode = {
      id(): string;
      getAttr(a: string): unknown;
      findOne?: (s: string) => { text(): string } | undefined;
      text?: () => string;
    };
    const K = (window as unknown as { Konva?: { stages: { find(s: string): KNode[] }[] } }).Konva;
    return (K?.stages[0]?.find(`.${name}`) ?? []).map((n) => ({
      id: n.id(),
      color: (n.getAttr("color") as string | undefined) ?? null,
      by: (n.getAttr("by") as string | undefined) ?? null,
      ephemeral: n.getAttr("ephemeral") === true,
      text: n.findOne
        ? (n.findOne(".scn-template-label-text")?.text() ?? n.findOne("Text")?.text() ?? null)
        : (n.text?.() ?? null),
    }));
  }, name);
}

const colorOfMark = async (page: Page, name: string, id: string) =>
  (await marks(page, name)).find((m) => m.id === id)?.color ?? null;

/** `[by, color, chip text]` of the pointer marks (`map-ping` / `map-laser`) drawn now. */
async function pointerMarks(page: Page, name: "map-ping" | "map-laser") {
  const chips = await marks(page, "map-pointer-chip");
  const casings = new Set((await marks(page, "map-casing")).map((c) => c.id));
  return (await marks(page, name)).map((m) => [
    m.by,
    m.color,
    chips.find((c) => c.id === m.id)?.text ?? null,
    casings.has(m.id),
  ]);
}

/** Presses on the token at cell `from` and moves (in steps) to the centre of cell `to`; no release. */
async function holdDrag(
  page: Page,
  from: { col: number; row: number },
  to: { col: number; row: number },
) {
  const a = await gridPoint(page, from.col + 0.5, from.row + 0.5);
  const b = await gridPoint(page, to.col + 0.5, to.row + 0.5);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++)
    await page.mouse.move(a.x + ((b.x - a.x) * i) / 8, a.y + ((b.y - a.y) * i) / 8);
}

const pathOf = async (page: Page, tokenId: string) =>
  (await marks(page, "map-drag-path")).filter((m) => m.id === tokenId).map((m) => [m.by, m.color]);

test("FR-MAP-68 / -69 / -70 / -72 / -73 / FR-SCN-47 player colours on the map: templates, laser, pings, drag paths (K2–K5; DM + player-1 + player-2)", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { secret, link, recordId } = e2eEnv();
  const ambush = recordId("battlemap", "scene");
  const mira = recordId("battlemap", "token", 0);
  const sneak = recordId("mt-crowd", "token", 0);
  const guardians = recordId("scn-templates", "aoe-template", 0);
  const glyph = recordId("scn-templates", "aoe-template", 1);
  const thunderwave = recordId("mt-templates", "aoe-template", 0);
  const web = recordId("mt-templates", "aoe-template", 1);
  const p1Id = recordId("player-1", "player");
  const p2Id = recordId("player-2", "player");
  const { amber, jade, blue, rose } = PLAYER_COLORS;

  const errors: string[] = [];
  const dm = await rolePage(browser);
  dm.on("console", (m) => {
    if (m.type() === "error") errors.push(`DM: ${m.text()}`);
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

  const [b, c] = [await rolePage(browser), await rolePage(browser)];
  const signalFrames: string[] = [];
  c.on("websocket", (ws) =>
    ws.on("framereceived", (f) => {
      const raw = String(f.payload);
      if (raw.includes('"type":"signal"')) signalFrames.push(raw);
    }),
  );
  for (const [page, name] of [
    [b, "Player 1"],
    [c, "Player 2"],
  ] as const) {
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`${name}: ${m.text()}`);
    });
    await page.goto(link(name));
    await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
    await expect(page.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  }
  const all = [dm, b, c];

  // K1 → K2: kept templates in their placer's colour; B picks rose → Spirit Guardians recolours.
  for (const page of all) {
    await expect.poll(() => colorOfMark(page, "scn-template", guardians)).toBe(jade);
    await expect.poll(() => colorOfMark(page, "scn-template", thunderwave)).toBe(blue);
    await expect.poll(() => colorOfMark(page, "scn-template", web)).toBe(amber);
  }
  const glyphMark = (await marks(dm, "scn-template")).find((m) => m.id === glyph);
  expect(glyphMark?.by).toBe("dm");
  expect(glyphMark?.color).not.toBe(amber); // OQ-SCN-41 A: hidden styling wins
  await pickOwnColour(b, rose);
  for (const page of all) {
    await expect.poll(() => colorOfMark(page, "scn-template", guardians)).toBe(rose);
  }
  expect((await marks(c, "scn-template")).find((m) => m.id === guardians)?.by).toBe(p1Id);

  // K3: B right-drags a laser across empty map and keeps it moving while A and C look.
  const start = await mapPoint(b, 8, 2, { margin: 2 });
  await b.mouse.move(start.x, start.y);
  await b.mouse.down({ button: "right" });
  let wiggling = true;
  const wiggle = (async () => {
    for (let i = 0; wiggling; i++) {
      await b.mouse.move(start.x + (i % 12) * 6, start.y + (i % 2) * 5);
      await b.waitForTimeout(60);
    }
  })();
  for (const page of [dm, c]) {
    await expect
      .poll(() => pointerMarks(page, "map-laser"), { intervals: [50] })
      .toContainEqual([p1Id, rose, "Player 1", true]);
  }
  await expect
    .poll(() => pointerMarks(b, "map-laser"), { intervals: [50] })
    .toContainEqual([p1Id, rose, null, true]); // own trail: own colour, no chip
  wiggling = false;
  await wiggle;
  await b.mouse.up({ button: "right" });

  // B pings; A pings and Shift+clicks a pull.
  await b.getByTestId("map-tool-ping").click();
  const pingAt = await mapPoint(b, 9, 3, { margin: 2 });
  await b.mouse.click(pingAt.x, pingAt.y);
  for (const page of [dm, c]) {
    await expect
      .poll(() => pointerMarks(page, "map-ping"), { intervals: [50] })
      .toContainEqual([p1Id, rose, "Player 1", true]);
  }
  await expect
    .poll(() => pointerMarks(b, "map-ping"), { intervals: [50] })
    .toContainEqual([p1Id, rose, null, true]);
  await b.getByTestId("map-tool-select").click();
  await dm.getByTestId("map-tool-ping").click();
  const dmPing = await mapPoint(dm, 9, 3, { margin: 2 });
  await dm.mouse.click(dmPing.x, dmPing.y);
  await dm.keyboard.down("Shift");
  await dm.mouse.click(dmPing.x + 40, dmPing.y);
  await dm.keyboard.up("Shift");
  for (const page of [b, c]) {
    await expect
      .poll(async () => (await pointerMarks(page, "map-ping")).filter((m) => m[0] === "dm"), {
        intervals: [50],
      })
      .toEqual([
        ["dm", amber, "DM", true],
        ["dm", amber, "DM", true],
      ]);
  }
  await dm.getByTestId("map-tool-select").click();
  // FR-MAP-73: frames carry the sender, never a colour.
  expect(signalFrames.length).toBeGreaterThan(0);
  for (const raw of signalFrames) expect(raw).not.toContain("color");

  // K4: B keeps a cone "Burning Hands"; A hovers its label → "by Player 1".
  await b.getByTestId("map-tool-aoe").click();
  await b.getByTestId("scn-aoe-shape-cone").click();
  await b.getByTestId("scn-aoe-label").fill("Burning Hands");
  await b.getByTestId("scn-aoe-label").press("Enter");
  const from = await gridPoint(b, 10, 9);
  const to = await gridPoint(b, 13, 9);
  await b.mouse.move(from.x, from.y);
  await b.mouse.down();
  for (let i = 1; i <= 5; i++) await b.mouse.move(from.x + ((to.x - from.x) * i) / 5, from.y);
  await b.mouse.up();
  await b.getByTestId("scn-aoe-keep").click();
  const burning = async (page: Page) =>
    (await marks(page, "scn-template")).find(
      (m) => !m.ephemeral && m.text?.startsWith("Burning Hands"),
    );
  for (const page of [dm, c]) {
    await expect
      .poll(async () => [(await burning(page))?.by, (await burning(page))?.color])
      .toEqual([p1Id, rose]);
  }
  await b.keyboard.press("Escape");
  await b.getByTestId("map-tool-select").click();
  const burningId = (await burning(dm))?.id as string;
  const [label] = await konvaNodes(dm, "scn-template-label", burningId);
  expect(label?.text).not.toContain("by Player 1");
  await dm.mouse.move(label?.x ?? 0, label?.y ?? 0);
  await expect
    .poll(async () => (await konvaNodes(dm, "scn-template-label", burningId))[0]?.text)
    .toMatch(/^Burning Hands · \d+ squares? · by Player 1$/);
  await dm.mouse.move(5, 5);

  // C holds a sphere (ephemeral) → blue on A and B; Esc removes it.
  await c.getByTestId("map-tool-aoe").click();
  await c.getByTestId("scn-aoe-shape-sphere").click();
  const cf = await gridPoint(c, 10, 4);
  const ct = await gridPoint(c, 12, 4);
  await c.mouse.move(cf.x, cf.y);
  await c.mouse.down();
  for (let i = 1; i <= 5; i++) await c.mouse.move(cf.x + ((ct.x - cf.x) * i) / 5, cf.y);
  await c.mouse.up();
  const ephOf = async (page: Page) =>
    (await marks(page, "scn-template")).filter((m) => m.ephemeral).map((m) => [m.by, m.color]);
  for (const page of [dm, b]) await expect.poll(() => ephOf(page)).toEqual([[p2Id, blue]]);
  await c.keyboard.press("Escape");
  for (const page of [dm, b]) await expect.poll(() => ephOf(page)).toEqual([]);
  await c.getByTestId("map-tool-select").click();

  // K5: B holds a drag on Mira → rose on A, B, C (the owner's colour).
  await mapPoint(b, 3, 7, { margin: 2 });
  await holdDrag(b, { col: 2, row: 7 }, { col: 5, row: 8 });
  for (const page of all) {
    await expect.poll(() => pathOf(page, mira)).toEqual([[p1Id, rose]]);
  }
  expect((await marks(c, "map-casing")).some((m) => m.id === mira)).toBe(true);
  await b.mouse.up();
  for (const page of all) await expect.poll(() => pathOf(page, mira)).toEqual([]);

  // The DM drags Thorn (player-2's) → blue on all, though the DM drags; Esc snaps it back.
  const thorn = (await marks(dm, "map-token-label")).find((m) => m.text === "Thorn")?.id as string;
  await mapPoint(dm, 3, 9, { margin: 2 });
  await holdDrag(dm, { col: 2, row: 9 }, { col: 4, row: 8 });
  for (const page of all) {
    await expect.poll(() => pathOf(page, thorn)).toEqual([[p2Id, blue]]);
  }
  await dm.keyboard.press("Escape");
  await dm.mouse.up();
  for (const page of all) await expect.poll(() => pathOf(page, thorn)).toEqual([]);

  // Goblin Sneak (unowned) → amber on the DM only; players: a glide, no path.
  await mapPoint(dm, 5, 9, { margin: 2 });
  await holdDrag(dm, { col: 4, row: 9 }, { col: 7, row: 9 });
  await expect.poll(() => pathOf(dm, sneak)).toEqual([["dm", amber]]);
  await b.waitForTimeout(300);
  for (const page of [b, c]) expect(await pathOf(page, sneak)).toEqual([]);
  await dm.keyboard.press("Escape");
  await dm.mouse.up();

  expect(errors).toEqual([]);
  for (const page of all) await page.context().close();
});
