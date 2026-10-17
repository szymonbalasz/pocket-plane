// e2e-bundle: rules-effects
// Thin trigger-badge flow (MOD §13.1 steps 2, 6a, 10; FR-CBTX-52, -53): DM, player-1 (Brakka,
// Mira), player-2 (Thorn). Mira's row shows "Searing Strike 1" for the DM and player-1 only;
// Thorn's "Sneak Attack" for the DM and player-2 only. The DM forces Brakka's Rage on during the
// Wolf's turn → "Divine Fury" waiting (neutral) on her row and a muted lightning icon on her token
// for the DM and player-1; DM Next → ready for both. player-2 never sees Brakka's badge or row.
// Words per state, uses, "+N" fitting, visibility per role: bun test.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { showToPlayers } from "./support/scenes";
import { openWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

async function idByName(scope: Locator, name: string): Promise<string> {
  const r = scope.locator('[data-testid="cbt-init-row"]').filter({
    has: scope.page().locator(`[data-testid="cbt-init-row-name"][data-value="${name}"]`),
  });
  return (await r.first().getAttribute("data-record-id")) as string;
}

/** The trigger chips on one Initiative row. */
const chips = (init: Locator, rowId: string) =>
  init
    .locator(`[data-testid="cbt-init-row"][data-record-id="${rowId}"]`)
    .getByTestId("cbtx-trigger-chip");

/** `value` attrs of the token's trigger icon (`ready` / `used`); [] = no icon. */
async function tokenTrigger(page: Page, tokenId: string): Promise<unknown[]> {
  return page.evaluate((tokenId) => {
    type KNode = { id(): string; getAttr(a: string): unknown; isVisible(): boolean };
    type KStage = { find(s: string): KNode[] };
    const K = (window as unknown as { Konva?: { stages: KStage[] } }).Konva;
    return (K?.stages[0]?.find(".cbtx-token-trigger") ?? [])
      .filter((n) => n.id() === tokenId && n.isVisible())
      .map((n) => n.getAttr("value"));
  }, tokenId);
}

/** One DM intent over a socket of its own (hello → snapshot → intent → ack result). */
function dmIntent(page: Page, secret: string, name: string, payload: unknown) {
  return page.evaluate(
    ([secret, name, payload]) =>
      new Promise<unknown>((resolve, reject) => {
        const ws = new WebSocket(`${location.origin.replace(/^http/, "ws")}/ws`);
        ws.onopen = () =>
          ws.send(JSON.stringify({ type: "hello", credential: { role: "dm", secret } }));
        ws.onmessage = (m) => {
          const f = JSON.parse(String(m.data)) as { type: string; result?: unknown };
          if (f.type === "snapshot") {
            ws.send(
              JSON.stringify({ type: "intent", intentId: crypto.randomUUID(), name, payload }),
            );
          } else if (f.type === "ack") {
            ws.close();
            resolve(f.result);
          } else if (f.type === "reject" || f.type === "error") {
            ws.close();
            reject(new Error(String(m.data)));
          }
        };
      }),
    [secret, name, payload] as const,
  );
}

test("FR-CBTX-52 FR-CBTX-53 trigger chips and the token icon follow the state, DM and owner only", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const ambush = recordId("battlemap", "scene");
  const brakkaToken = recordId("char-brakka", "token");
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);
  const p2 = await rolePage(browser);
  const p2Frames: string[] = [];
  p2.on("websocket", (ws) => ws.on("framereceived", (f) => p2Frames.push(String(f.payload))));
  await p2.goto(link("Player 2"));
  await live(p2);

  // The DM views the ambush and shows it to players.
  const scenes = await openWindow(dm, "map.scenes");
  await scenes
    .locator(`[data-testid="map-scene-row"][data-record-id="${ambush}"] button`)
    .first()
    .click();
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  await showToPlayers(dm, "Goblin Ambush");
  for (const p of [p1, p2]) {
    await expect(p.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  }

  const init = await openWindow(dm, "cbt.initiative");
  const init1 = await openWindow(p1, "cbt.initiative");
  const init2 = await openWindow(p2, "cbt.initiative");
  const [mira, thorn, brakka] = [
    await idByName(init, "Mira"),
    await idByName(init, "Thorn"),
    await idByName(init, "Brakka"),
  ];

  // Mira's feature trigger shows its uses left (1 of 2) for the DM and her owner.
  for (const scope of [init, init1]) {
    const sf = chips(scope, mira);
    await expect(sf).toHaveCount(1);
    await expect(sf).toHaveAttribute("data-state", "uses");
    await expect(sf).toHaveAttribute("data-value", "1");
    await expect(sf).toContainText("Searing Strike");
  }
  await expect(chips(init2, mira)).toHaveCount(0);
  // Thorn's Sneak Attack: the DM and player-2, not player-1.
  await expect(chips(init, thorn)).toHaveCount(1);
  await expect(chips(init2, thorn)).toHaveCount(1);
  await expect(chips(init1, thorn)).toHaveCount(0);

  // Rage off (0 / 3 left): Divine Fury is not in effect → no chip, no token icon.
  await expect(chips(init, brakka)).toHaveCount(0);
  expect(await tokenTrigger(dm, brakkaToken)).toEqual([]);

  // DM forces Rage on during the Wolf's turn → Divine Fury waits for Brakka's turn.
  await dmIntent(dm, secret, "mod.toggle", {
    characterId: recordId("char-brakka", "entity"),
    presetId: recordId("trg-brakka", "effect-preset"),
    on: true,
    force: true,
  });
  for (const [scope, page] of [
    [init, dm],
    [init1, p1],
  ] as const) {
    const fury = chips(scope, brakka);
    await expect(fury).toHaveCount(1);
    await expect(fury).toHaveAttribute("data-state", "waiting");
    await expect(fury).toContainText("Divine Fury");
    await expect.poll(() => tokenTrigger(page, brakkaToken)).toEqual(["used"]);
  }

  // DM Next (Wolf → Brakka) → ready for both, the icon at full tone.
  await init.getByTestId("cbt-init-next").click();
  for (const [scope, page] of [
    [init, dm],
    [init1, p1],
  ] as const) {
    await expect(chips(scope, brakka)).toHaveAttribute("data-state", "ready");
    await expect.poll(() => tokenTrigger(page, brakkaToken)).toEqual(["ready"]);
  }

  // player-2: nothing of Brakka's, ever.
  await expect(chips(init2, brakka)).toHaveCount(0);
  expect(await tokenTrigger(p2, brakkaToken)).toEqual([]);
  expect(p2Frames.some((f) => f.includes("Divine Fury") || f.includes("Searing Strike"))).toBe(
    false,
  );

  for (const page of [p1, p2, dm]) await page.context().close();
});
