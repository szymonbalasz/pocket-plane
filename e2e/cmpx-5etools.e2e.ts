// e2e-bundle: cmpx-5etools
// Thin 5etools flow (compendium-expansion §13 E2E): the DM imports both fixture books from the
// panel; "goblin" → one row badged TB1; drag it onto the map; player-1 finds the TB1 spell and no
// monsters. States, versions, crash, credits, visibility: bun test (cmpx-panel, five-etools).
//
// This spec runs its own server: the folder is a per-server env value (`PP_5ETOOLS_DIR`), and
// `bun run e2e` gives every bundle the same env. It prepares the fixture folder, loads the bundle
// the same way and stops the server after; the runner's own server for this bundle goes unused.
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { loginDm } from "./support/env";
import { konvaNodes } from "./support/konva";
import { mapPoint } from "./support/map";
import { openWindow } from "./support/shell";

const run = promisify(execFile);
const ROOT = path.join(import.meta.dirname, "..");
const SECRET = `e2e-${crypto.randomUUID()}`;
const START_TIMEOUT_MS = 60_000;

let dir: string;
let server: ChildProcess;
let baseURL: string;
let playerLink: string;

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

const rolePage = async (browser: Browser) => (await browser.newContext({ baseURL })).newPage();

test.beforeAll(async () => {
  test.setTimeout(START_TIMEOUT_MS + 60_000);
  dir = mkdtempSync(path.join(os.tmpdir(), "pp-e2e-cmpx-"));
  const folder = path.join(dir, "5etools");
  const env = {
    ...process.env,
    PP_PROFILE: "verify",
    PP_PORT: "0",
    PP_DATA_DIR: dir,
    PP_DB_PATH: "",
    PP_ASSET_DIR: "",
    PP_DATA_DISPOSABLE: "1",
    PP_TEST_MODE: "1",
    PP_DM_SECRET: SECRET,
    PP_PUBLIC_BASE_URL: "",
    PP_5ETOOLS_DIR: folder,
  };
  await run("bun", ["fixtures/5etools-mini/prepare.ts", folder], { cwd: ROOT, env });
  await run("bun", ["scripts/fixtures.ts", "reset-load", "cmpx-5etools"], { cwd: ROOT, env });
  server = spawn("bun", ["src/server/index.ts", "--stop-on-stdin-close", "--client"], {
    cwd: ROOT,
    env,
    stdio: ["pipe", "inherit", "inherit"],
  });
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (!baseURL) {
    if (Date.now() > deadline) throw new Error("Server did not start");
    if (server.exitCode !== null) throw new Error(`Server exited (${server.exitCode})`);
    await new Promise((r) => setTimeout(r, 100));
    try {
      const lock = JSON.parse(readFileSync(path.join(dir, "server.lock"), "utf8"));
      if (lock.owner === "server" && lock.port) baseURL = `http://127.0.0.1:${lock.port}`;
    } catch {
      // Not written yet.
    }
  }
  const manifest = JSON.parse(readFileSync(path.join(dir, "load-manifest.json"), "utf8"));
  playerLink = manifest.playerLinks.find((l: { player: string }) => l.player === "Player 1").url;
});

test.afterAll(async () => {
  if (server && server.exitCode === null) {
    const gone = new Promise((r) => server.once("exit", r));
    server.stdin?.end();
    const t = setTimeout(() => server.kill(), 3_000);
    await gone;
    clearTimeout(t);
  }
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  } catch {
    // Windows may hold the WAL briefly; a leftover temp dir is harmless.
  }
});

test("FR-CMPX-17 FR-CMPX-14 FR-CMPX-16 import both books, 'goblin' → one TB1 row, drag to the map; player: the TB1 spell, no monsters", async ({
  browser,
}) => {
  const dm = await rolePage(browser);
  await loginDm(dm, SECRET);
  await live(dm);
  const win = await openWindow(dm, "cmp.compendium");

  // The panel: ready, two new books, Import selected off until one is ticked.
  await expect(win.getByTestId("cmpx-status")).toHaveAttribute("data-state", "ready");
  const books = win.getByTestId("cmpx-book");
  await expect(books).toHaveCount(2);
  await expect(win.getByTestId("cmpx-import")).toBeDisabled();
  for (const b of await books.all()) {
    await expect(b).toHaveAttribute("data-state", "new");
    await b.getByTestId("cmpx-book-check").click();
  }

  // Confirm → both books → Toast with the totals and warning count.
  await win.getByTestId("cmpx-import").click();
  const dialog = dm.getByTestId("cmp-import-dialog");
  await expect(dialog).toContainText("Players will pause for a few seconds per book");
  await dialog.getByTestId("cmp-import-confirm").click();
  await expect(
    dm.getByText(/^2 books: \d+ new · 0 updated · 0 unchanged · \d+ warnings?$/),
  ).toBeVisible();
  for (const b of await books.all()) await expect(b).toHaveAttribute("data-state", "imported");

  // "goblin": one Goblin, the book's, not the SRD's too.
  await win.getByTestId("cmp-search").fill("goblin");
  const goblin = win
    .getByTestId("cmp-result")
    .filter({ has: dm.getByTestId("cmp-result-name").getByText("Goblin", { exact: true }) });
  await expect(goblin).toHaveCount(1);
  await expect(goblin).toContainText("TB1");

  // Drag onto the map: one more token.
  const canvas = dm.getByTestId("map-canvas");
  await expect(canvas).toHaveAttribute("data-loading", "false");
  const before = (await konvaNodes(dm, "map-token")).length;
  const to = await mapPoint(dm, 7, 5);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("No map canvas");
  await goblin.dragTo(canvas, { targetPosition: { x: to.x - box.x, y: to.y - box.y } });
  await expect.poll(async () => (await konvaNodes(dm, "map-token")).length).toBe(before + 1);

  // Player: the TB1 spell with its badge; no Monsters tab, "goblin" finds nothing.
  const p1 = await rolePage(browser);
  await p1.goto(playerLink);
  await live(p1);
  const pw = await openWindow(p1, "cmp.compendium");
  await expect(pw.getByTestId("cmpx-panel")).toHaveCount(0);
  await expect(pw.locator('[data-testid="cmp-tab"][data-value="monster"]')).toHaveCount(0);
  await pw.getByTestId("cmp-search").fill("quarry");
  const spell = pw.getByTestId("cmp-result").filter({ hasText: "Quarry Sign" });
  await expect(spell).toHaveCount(1);
  await expect(spell).toContainText("TB1");
  await pw.getByTestId("cmp-search").fill("goblin");
  await expect(pw.getByTestId("cmp-result")).toHaveCount(0);
});
