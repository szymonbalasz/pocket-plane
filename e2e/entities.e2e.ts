// Thin entities flows (ENT §13 E2E): DM Creatures list rows; dragging a row onto a test drop
// target yields its definitionId; player-1's WS frames hold its character in full and no
// monster records. Bundle: `bun run e2e` loads `sync-probe` (no definitions), so the test
// creates its own via REST. Restart convergence is covered in bun test (entities sync.test.ts).
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

const MIME = "application/x-pp-definition";
const monster = {
  size: "large",
  ac: 11,
  hpMax: 59,
  initBonus: -1,
  attacks: [{ name: "Greatclub", toHit: 6, damage: "2d8+4", damageType: "bludgeoning" }],
  cr: "2",
};
const character = {
  size: "medium",
  ac: 16,
  hpMax: 12,
  initBonus: 2,
  attacks: [{ name: "Shortsword", toHit: 4, damage: "1d6+2", damageType: "piercing" }],
  level: 1,
  className: "Fighter",
};

async function api(page: Page, secret: string, method: string, path: string, data?: unknown) {
  const res = await page.request.fetch(`/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${secret}` },
    ...(data === undefined ? {} : { data }),
  });
  return { status: res.status(), body: (await res.json()) as Record<string, unknown> };
}

test("FR-ENT-15 FR-ENT-18 Creatures list, drag yields definitionId, player-1 frames", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

  const players = (await api(dm, secret, "GET", "/players")).body.players as {
    id: string;
    name: string;
  }[];
  const p1 = players.find((p) => p.name === "Player 1");
  expect(p1).toBeTruthy();
  const ogre = await api(dm, secret, "POST", "/entities", {
    kind: "monster",
    name: "E2E Ogre",
    statBlock: monster,
  });
  expect(ogre.status).toBe(201);
  const hero = await api(dm, secret, "POST", "/entities", {
    kind: "character",
    name: "E2E Hero",
    ownerPlayerId: p1?.id,
    statBlock: character,
  });
  expect(hero.status).toBe(201);
  const ogreId = (ogre.body.entity as { id: string }).id;
  const heroId = (hero.body.entity as { id: string }).id;

  // List: both rows, sorted by name; monster shows CR + XP and the Custom badge.
  const win = await openWindow(dm, "ent.creatures");
  const list = win.getByTestId("ent-list");
  const rows = list.getByTestId("ent-list-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toHaveAttribute("data-record-id", heroId);
  await expect(rows.nth(0).getByTestId("ent-list-row-badge")).toHaveText("Player 1");
  const ogreRow = list.locator(`[data-testid="ent-list-row"][data-record-id="${ogreId}"]`);
  await expect(ogreRow.getByTestId("ent-list-row-cr")).toHaveText("CR 2 · 450 XP");
  await expect(ogreRow.getByTestId("ent-list-row-badge")).toHaveText("Custom");
  await expect(ogreRow.getByTestId("ent-list-row-lock")).toHaveCount(0);
  await win.getByTestId("ent-list-tab-character").click();
  await expect(rows).toHaveCount(1);
  await win.getByTestId("ent-list-tab-all").click();
  await expect(rows).toHaveCount(2);

  // Drag contract (FR-ENT-18): a test drop target outside the window reads the payload.
  await dm.evaluate((mime) => {
    const t = document.createElement("div");
    t.dataset.testid = "e2e-drop-target";
    t.style.cssText =
      "position:fixed;right:20px;bottom:120px;width:120px;height:120px;z-index:9999;background:#333";
    t.addEventListener("dragover", (e) => {
      if (e.dataTransfer?.types.includes(mime)) e.preventDefault();
    });
    t.addEventListener("drop", (e) => {
      e.preventDefault();
      t.dataset.dropped = e.dataTransfer?.getData(mime) ?? "";
    });
    document.body.append(t);
  }, MIME);
  const target = dm.getByTestId("e2e-drop-target");
  await ogreRow.dragTo(target);
  await expect(target).toHaveAttribute("data-dropped", JSON.stringify({ definitionId: ogreId }));

  // Player 1: own character in full, no monster records anywhere in its frames.
  const player = await rolePage(browser);
  const frames: string[] = [];
  player.on("websocket", (ws) => {
    ws.on("framereceived", (f) => frames.push(String(f.payload)));
  });
  await player.goto(link("Player 1"));
  await expect(player.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  await expect.poll(() => frames.some((f) => f.includes('"type":"snapshot"'))).toBe(true);
  const snapshot = JSON.parse(frames.find((f) => f.includes('"type":"snapshot"')) ?? "{}") as {
    records: Record<string, Record<string, unknown>[]>;
  };
  expect(snapshot.records["imported-entity"]).toBeUndefined();
  expect(snapshot.records.entity).toHaveLength(1);
  expect(snapshot.records.entity?.[0]).toMatchObject({ id: heroId, hpCurrent: 12 });

  // A monster edit sends player-1 nothing; a character edit arrives in full.
  const put = await api(dm, secret, "PUT", `/entities/${ogreId}`, {
    name: "E2E Ogre",
    statBlock: { ...monster, hpMax: 70 },
  });
  expect(put.status).toBe(200);
  const renamed = await api(dm, secret, "PUT", `/entities/${heroId}`, {
    name: "E2E Hero Vale",
    ownerPlayerId: p1?.id,
    statBlock: character,
  });
  expect(renamed.status).toBe(200);
  await expect.poll(() => frames.some((f) => f.includes("E2E Hero Vale"))).toBe(true);
  expect(frames.join("\n")).not.toContain("E2E Ogre");
  expect(frames.join("\n")).not.toContain(ogreId);

  // Later specs share the server: leave nobody online.
  await player.context().close();
  await dm.context().close();
});
