// e2e-bundle: cb-turn-ring-e2e
// Thin CB2 flow (CBTX §13.1 E2E): the DM clicks Next through the round; on each turn the
// `cbt-token-turn` ring sits on the turn token for the DM and player 1 (inside the token's group,
// under the body, never hit), dashed for the DM only on a hidden turn, and none for player 1 on the
// hidden Elite's turn. Per-viewer rules, reconnect and leaks: bun test.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { turnRings } from "./support/canvas";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { tokenNode } from "./support/konva";
import { showToPlayers } from "./support/scenes";
import { openWindow, shellWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

interface Row {
  id: string;
  name: string;
  tokenId: string | null;
  hidden: boolean;
}

/** The DM's combatant rows from a snapshot over a socket of its own (combatant → token). */
function dmCombatants(page: Page, secret: string) {
  return page.evaluate(
    (secret) =>
      new Promise<Row[]>((resolve) => {
        const ws = new WebSocket(`${location.origin.replace(/^http/, "ws")}/ws`);
        ws.onopen = () =>
          ws.send(JSON.stringify({ type: "hello", credential: { role: "dm", secret } }));
        ws.onmessage = (m) => {
          const f = JSON.parse(String(m.data)) as {
            type: string;
            records?: Record<
              string,
              { id: string; name: string; tokenId: string | null; hidden: boolean }[]
            >;
          };
          if (f.type !== "snapshot") return;
          ws.close();
          resolve(
            (f.records?.combatant ?? []).map(({ id, name, tokenId, hidden }) => ({
              id,
              name,
              tokenId,
              hidden,
            })),
          );
        };
      }),
    secret,
  );
}

const turnRowId = (init: Locator) =>
  init.locator('li[data-testid="cbt-init-row"][data-turn="true"]').getAttribute("data-record-id");

test("FR-CBT-166 FR-MAP-108 FR-MAP-112 Next → the turn ring on the turn token for the DM and player 1; none for player 1 on the hidden Elite's turn", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);
  // The fight's scene, shown to players and viewed by the DM.
  const ambush = recordId("battlemap", "scene");
  await showToPlayers(dm, "Goblin Ambush");
  const scenes = shellWindow(dm, "map.scenes");
  await scenes
    .locator(`[data-testid="map-scene-row"][data-record-id="${ambush}"] button`)
    .first()
    .click();
  for (const page of [dm, p1]) {
    await expect(page.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  }
  await scenes.getByTestId("ui-window-close").click();
  const init = await openWindow(dm, "cbt.initiative");
  const rows = new Map((await dmCombatants(dm, secret)).map((r) => [r.id, r]));

  let sawHidden = false;
  let sawShared = false;
  for (let i = 0; i < 14 && !(sawHidden && sawShared); i++) {
    const before = await turnRowId(init);
    await init.getByTestId("cbt-init-next").first().click();
    await expect.poll(() => turnRowId(init)).not.toBe(before);
    const turn = rows.get((await turnRowId(init)) as string);
    if (!turn?.tokenId) continue;
    const token = turn.tokenId;
    // DM: the ring on the turn token, inside its group under the body; dashed iff hidden.
    await expect
      .poll(async () => (await turnRings(dm)).find((r) => r.id === token)?.hidden)
      .toBe(turn.hidden);
    const ring = (await turnRings(dm)).find((r) => r.id === token);
    // FR-MAP-109: the glow only on cells of 48 px and up (BL-35's compact rule), never when hidden.
    const cellPx = Number(await dm.getByTestId("map-canvas").getAttribute("data-cell-px"));
    expect(ring).toMatchObject({
      parent: { name: "map-token", id: token },
      index: 1,
      listening: false,
      dashed: turn.hidden,
      glow: !turn.hidden && cellPx >= 48,
    });
    // Centred on the footprint (it hugs the token's shape).
    expect(Math.abs((ring?.x ?? 0) - (ring?.footprint.x ?? 0))).toBeLessThan(1);
    expect(Math.abs((ring?.y ?? 0) - (ring?.footprint.y ?? 0))).toBeLessThan(1);
    if (turn.hidden) {
      // Player 1: no ring at all (the hidden turn's id and token never reach it).
      await expect.poll(async () => (await turnRings(p1)).length).toBe(0);
      expect(await tokenNode(p1, token)).toBeNull();
      if (turn.name.startsWith("Elite")) sawHidden = true;
    } else if (await tokenNode(p1, token)) {
      await expect
        .poll(async () => (await turnRings(p1)).map((r) => [r.id, r.hidden, r.dashed]))
        .toContainEqual([token, false, false]);
      sawShared = true;
    }
  }
  expect(sawHidden).toBe(true);
  expect(sawShared).toBe(true);
});
