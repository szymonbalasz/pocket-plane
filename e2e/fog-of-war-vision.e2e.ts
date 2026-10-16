// e2e-bundle: vision
// Thin dynamic-vision flow (FOG §13 E2E, V2: server-visible assertions; V3 draws the vision). DM,
// player-1 (Mira, torch 30 ft) and player-2 (Thorn) in separate contexts: the DM shows Goblin
// Ambush and opens d1; player-1 drags Mira to (7, 5) → the Goblin reaches player-1 only; a reload
// keeps it; a darkness circle over the Goblin hides it, Undo brings it back; the DM sets the
// Goblin Invisible (an intent over the DM's own socket: the menu line is V3) → gone again.
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { konvaNodes, tokenNode } from "./support/konva";
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

/** The token's cell (Goblin Ambush: 70 px cells, offset 0). */
async function cellOf(page: Page, tokenId: string) {
  return page.evaluate((id) => {
    const K = (
      window as unknown as {
        Konva?: { stages: { findOne(s: string): { x(): number; y(): number } | undefined }[] };
      }
    ).Konva;
    const n = K?.stages[0]?.findOne(`#${id}`);
    return n ? { col: Math.round(n.x() / 70), row: Math.round(n.y() / 70) } : null;
  }, tokenId);
}

/** Drags a token from its cell to `(col, row)` in small steps. */
async function dragTo(page: Page, tokenId: string, col: number, row: number) {
  const t = (await tokenNode(page, tokenId)) as { x: number; y: number };
  const to = await mapToPage(page, col * 70 + 35, row * 70 + 35);
  await page.mouse.move(t.x, t.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(t.x + ((to.x - t.x) * i) / 8, t.y + ((to.y - t.y) * i) / 8);
  }
  await page.mouse.up();
}

/** One DM intent over a second DM socket in the DM's page (no UI for it before V3). */
async function dmIntent(page: Page, secret: string, name: string, payload: object) {
  return page.evaluate(
    ([secret, name, payload]) =>
      new Promise<string>((resolve, reject) => {
        const ws = new WebSocket(`${location.origin.replace(/^http/, "ws")}/ws`);
        ws.onopen = () =>
          ws.send(JSON.stringify({ type: "hello", credential: { role: "dm", secret } }));
        ws.onmessage = (m) => {
          const f = JSON.parse(String(m.data)) as { type: string; intentId?: string };
          if (f.type === "snapshot") {
            ws.send(JSON.stringify({ type: "intent", intentId: "e2e-vision-1", name, payload }));
          }
          if ((f.type === "ack" || f.type === "reject") && f.intentId === "e2e-vision-1") {
            ws.close();
            resolve(f.type);
          }
        };
        ws.onerror = () => reject(new Error("socket error"));
      }),
    [secret, name, payload] as const,
  );
}

test("FR-FOG-34 / -37 / -44 / -45 vision: d1 open, Mira → (7, 5) → Goblin for player-1 only; reload keeps it; darkness hides it, Undo → back; Invisible → gone (DM + player-1 + player-2)", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const ambush = recordId("battlemap", "scene");
  const mira = recordId("battlemap", "token", 0);
  const goblin = recordId("battlemap", "token", 1);

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
  await scenes.getByTestId("ui-window-close").click();
  await dm.getByTestId("map-show-to-players").click();

  const p1 = await rolePage(browser);
  const p2 = await rolePage(browser);
  const p2Frames: string[] = [];
  p2.on("websocket", (ws) => ws.on("framereceived", (f) => p2Frames.push(String(f.payload))));
  for (const [page, name] of [
    [p1, "Player 1"],
    [p2, "Player 2"],
  ] as const) {
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`${name}: ${m.text()}`);
    });
    await page.goto(link(name));
    await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
    await expect(page.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
    await expect(page.getByTestId("map-canvas")).toHaveAttribute("data-loading", "false");
    await expect.poll(() => tokenNode(page, mira)).not.toBeNull();
    expect(await tokenNode(page, goblin)).toBeNull();
  }

  // The DM double-clicks d1 open; player-1 drags Mira through to (7, 5): the Goblin (12, 6) is
  // in her 30 ft through the doorway (FR-FOG-33 / -34).
  const d1 = (await konvaNodes(dm, "scn-door", "door-4"))[0] as { x: number; y: number };
  await dm.mouse.dblclick(d1.x, d1.y);
  await dragTo(p1, mira, 7, 5);
  await expect.poll(() => cellOf(dm, mira)).toEqual({ col: 7, row: 5 });
  await expect.poll(() => tokenNode(p1, goblin)).not.toBeNull();
  await expect.poll(() => cellOf(p2, mira)).toEqual({ col: 7, row: 5 });
  expect(await tokenNode(p2, goblin)).toBeNull();

  // Reload: the snapshot computes player-1's sight again.
  await p1.reload();
  await expect(p1.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  await expect(p1.getByTestId("map-canvas")).toHaveAttribute("data-loading", "false");
  await expect.poll(() => tokenNode(p1, goblin)).not.toBeNull();

  // Darkness circle [12.5, 6.5, 1.5] over the Goblin (Mira can't see into it) → gone; Undo → back.
  await dm.getByTestId("map-tool-fog").click();
  const undo = dm.getByTestId("fog-undo");
  const depth = Number(await undo.getAttribute("data-depth"));
  await dm.getByTestId("fog-mode-darkness").click();
  await dm.getByTestId("fog-shape-circle").click();
  const c = await mapToPage(dm, 12.5 * 70, 6.5 * 70);
  const edge = await mapToPage(dm, 14 * 70, 6.5 * 70);
  await dm.keyboard.down("Control");
  await dm.mouse.move(c.x, c.y);
  await dm.mouse.down();
  for (let i = 1; i <= 5; i++) await dm.mouse.move(c.x + ((edge.x - c.x) * i) / 5, c.y);
  await dm.mouse.up();
  await dm.keyboard.up("Control");
  await expect(undo).toHaveAttribute("data-depth", String(depth + 1));
  await expect.poll(() => tokenNode(p1, goblin)).toBeNull();
  await undo.click();
  await expect(undo).toHaveAttribute("data-depth", String(depth));
  await expect.poll(() => tokenNode(p1, goblin)).not.toBeNull();

  // #210: the DM sets the Goblin Invisible → gone for player-1 (no Sees invisible source).
  expect(await dmIntent(dm, secret, "fog.setInvisible", { tokenId: goblin, invisible: true })).toBe(
    "ack",
  );
  await expect.poll(() => tokenNode(p1, goblin)).toBeNull();

  // No player-2 frame ever named the Goblin; no `invisible` key reached a player.
  for (const f of p2Frames) {
    expect(f).not.toContain(goblin);
    expect(f).not.toContain('"invisible"');
  }
  expect(errors).toEqual([]);
});
