// e2e-bundle: session-sim-9
// Combat trails stored on the token (sprint 5 R3; FR-CBT-97, FR-MAP-65–67), thin: CBT §13.1 L1, L2,
// L5 with DM, player-1 and player-2 in separate contexts. `trail-moves` (Mira ×2, Thorn ×1,
// Goblin ×1 this turn): the DM draws three trails, the players Mira's and Thorn's; after a reload
// of every client each draws the same `cells`; Next clears them everywhere. On session-sim-9 (it
// stacks `trail-moves` like `late-damage` does): `combat-lines.e2e.ts` runs first on the shared
// `late-damage` server and presses Next. Hidden / blind / restart cases: bun test (trail-moves.test.ts).
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { tokenNode } from "./support/konva";
import { showToPlayers } from "./support/scenes";
import { openWindow } from "./support/shell";

/** `map-drag-trail` Konva groups: token id → [segments, cells] (FR-MAP-67 attrs). */
async function trails(page: Page): Promise<Record<string, [number, string]>> {
  return page.evaluate(() => {
    type KNode = { id(): string; getAttr(a: string): unknown };
    type KStage = { find(s: string): KNode[] };
    const K = (window as unknown as { Konva?: { stages: KStage[] } }).Konva;
    return Object.fromEntries(
      (K?.stages[0]?.find(".map-drag-trail") ?? []).map((n) => [
        n.id(),
        [Number(n.getAttr("segments")), String(n.getAttr("cells") ?? "")],
      ]),
    );
  });
}

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

test("FR-MAP-67 FR-CBT-97 trails drawn from the token: L1 per client, L2 equal after a reload, L5 Next clears", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const ambush = recordId("battlemap", "scene");
  const mira = recordId("battlemap", "token", 0);
  const goblin = recordId("battlemap", "token", 1);
  const thorn = recordId("thorn-battlemap", "token", 0);
  const errors: string[] = [];

  const dm = await rolePage(browser);
  dm.on("console", (m) => {
    if (m.type() === "error") errors.push(`DM: ${m.text()}`);
  });
  await loginDm(dm, secret);
  await live(dm);
  const viewAmbush = async () => {
    const scenes = await openWindow(dm, "map.scenes");
    await scenes
      .locator(`[data-testid="map-scene-row"][data-record-id="${ambush}"] button`)
      .first()
      .click();
    await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
    await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-loading", "false");
    await showToPlayers(dm, "Goblin Ambush");
    await scenes.getByTestId("ui-window-close").click();
  };
  await viewAmbush();

  const [p1, p2] = [await rolePage(browser), await rolePage(browser)];
  for (const [page, name] of [
    [p1, "Player 1"],
    [p2, "Player 2"],
  ] as const) {
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`${name}: ${m.text()}`);
    });
    await page.goto(link(name));
    await live(page);
    await expect(page.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
    await expect.poll(() => tokenNode(page, mira)).not.toBeNull();
  }

  // L1: A sees Mira 2, Thorn 1, Goblin 1 segments; B and C Mira 2, Thorn 1 and no Goblin trail.
  const dmWant = {
    [mira]: [2, "2,7 4,7 5,6"],
    [thorn]: [1, "2,9 4,10"],
    [goblin]: [1, "12,6 10,6"],
  };
  const playerWant = { [mira]: dmWant[mira], [thorn]: dmWant[thorn] };
  const expectL1 = async () => {
    await expect.poll(() => trails(dm)).toEqual(dmWant);
    for (const p of [p1, p2]) await expect.poll(() => trails(p)).toEqual(playerWant);
  };
  await expectL1();
  // L1's Pending check (R1): the ruled card waits for damage.
  const init = await openWindow(dm, "cbt.initiative");
  const ruled = recordId("late-hit-ruled", "notification");
  const pending = init.locator(`[data-testid="cbt-init-card"][data-record-id="${ruled}"]`);
  await expect(pending).toContainText("Mira: hit Goblin 2 — waiting for damage");

  // L2: B and C reload (and the DM too, sim-8 glitch 6) → the same `cells` on every client.
  for (const p of [p1, p2, dm]) await p.reload();
  for (const p of [p1, p2, dm]) await live(p);
  if ((await dm.getByTestId("map-canvas").getAttribute("data-scene-id")) !== ambush) {
    await viewAmbush();
  }
  await expectL1();
  const initAgain = await openWindow(dm, "cbt.initiative");
  await expect(
    initAgain.locator(`[data-testid="cbt-init-card"][data-record-id="${ruled}"]`),
  ).toContainText("Mira: hit Goblin 2 — waiting for damage");

  // L5: Next → the trails are gone on A, B and C.
  await initAgain.getByTestId("cbt-init-next").click();
  for (const p of [dm, p1, p2]) await expect.poll(() => trails(p)).toEqual({});

  expect(errors).toEqual([]);
});
