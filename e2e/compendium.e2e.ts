// e2e-bundle: compendium
// Thin compendium read flow (CMP §13, C2): the DM's Creatures window searches the server for
// imported monsters and loads their definitions on demand (CR shown; drag data unchanged); the
// encounter builder's lookup finds an SRD monster; player-1 reads the compendium over REST with
// `Authorization: Player` (no monsters, Fireball readable, no secret homebrew) and its WS frames
// carry no imported definition. The window itself is C3; ranking / visibility matrix: bun test.
import { expect, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

test("FR-CMP-10 FR-CMP-13 FR-CMP-15 FR-CMP-17 Creatures search + lookup via the server; player REST reads", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const dm = await rolePage(browser);
  const dmFrames: string[] = [];
  dm.on("websocket", (ws) => ws.on("framereceived", (f) => dmFrames.push(String(f.payload))));
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

  // Creatures: "gob" → the custom Elite Goblin Warrior (store), SRD Goblin + Hobgoblin and the
  // fixture Goblin (server); CR from the definitions loaded on demand.
  const win = await openWindow(dm, "ent.creatures");
  await win.getByTestId("ent-list-search").fill("gob");
  const rows = win.getByTestId("ent-list-row");
  await expect(rows.getByTestId("ent-list-row-name")).toHaveText([
    "Elite Goblin Warrior",
    "Goblin",
    "Goblin",
    "Hobgoblin",
  ]);
  const hob = rows.filter({ hasText: "Hobgoblin" });
  await expect(hob.getByTestId("ent-list-row-cr")).toHaveText("CR 1/2 · 100 XP");
  await expect(hob.getByTestId("ent-list-row-lock")).toHaveCount(1);
  // The snapshot held no imported definition; they came by `sync.load` (FR-CMP-15).
  const snapshot = dmFrames.find((f) => f.includes('"type":"snapshot"')) ?? "";
  expect(snapshot).not.toContain('"imported-entity"');
  expect(dmFrames.some((f) => f.includes('"type":"ack"') && f.includes("Hobgoblin"))).toBe(true);

  // Encounter builder lookup: "og" → Ogre (SRD), from the server search.
  const enc = await openWindow(dm, "cbt.encounters");
  await enc
    .locator(
      `[data-testid="cbt-enc-row"][data-record-id="${recordId("encounter-1", "encounter")}"]`,
    )
    .click();
  const lookup = enc.getByTestId("cbt-lookup-input");
  await lookup.fill("og");
  const ogre = dm.getByTestId("cbt-lookup-option").filter({ hasText: "Ogre" });
  await expect(ogre).toHaveCount(1);
  await expect(ogre).toContainText("CR 2 · 450 XP");
  await lookup.press("Escape");

  // Player 1: REST with the link token; WS frames never carry an imported definition.
  const player = await rolePage(browser);
  const frames: string[] = [];
  player.on("websocket", (ws) => ws.on("framereceived", (f) => frames.push(String(f.payload))));
  const url = link("Player 1");
  await player.goto(url);
  await expect(player.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const token = url.split("/p/").pop()?.split(/[?#]/)[0] as string;
  const get = async (path: string) => {
    const res = await player.request.get(`/api/compendium${path}`, {
      headers: { Authorization: `Player ${token}` },
    });
    expect(res.headers()["cache-control"]).toBe("private, no-cache");
    return { status: res.status(), text: await res.text() };
  };
  const goblin = await get("/search?q=goblin");
  expect(goblin.status).toBe(200);
  expect(goblin.text).not.toContain('"kind":"monster"');
  const fire = JSON.parse((await get("/search?q=fire")).text) as {
    results: { id: string; name: string }[];
  };
  expect(fire.results.map((r) => r.name)).toEqual(["Fireball"]);
  const fireball = await get(`/entries/${fire.results[0]?.id}`);
  expect(fireball.status).toBe(200);
  expect(fireball.text).toContain("Level 3 evocation");
  expect((await get("/search?q=CMP-SECRET")).text).not.toContain("CMP-SECRET-ITEM");
  const raw = frames.join("\n");
  for (const s of ["imported-entity", "Hobgoblin", "CMP-SECRET-ITEM"]) expect(raw).not.toContain(s);
});
