// e2e-bundle: agent-api
// Thin agent-api flow (AGENT §13 E2E): `bun run mcp:call character_put_row` adds an item to Mira →
// player-1's sheet Items shows it with no reload. Reach, visibility, leak scan, plan_check, errors:
// bun test (src/mcp). The spawned process gets explicit env: CI has no .env.
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

const run = promisify(execFile);
const ITEM = "Orc-tooth necklace";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

/** `bun run mcp:call <tool> '<json>' --profile verify` against this bundle's server. */
async function mcpCall(tool: string, input: unknown) {
  const { secret } = e2eEnv();
  const manifest = process.env.E2E_MANIFEST as string;
  const { stdout } = await run(
    "bun",
    ["run", "mcp:call", tool, JSON.stringify(input), "--profile", "verify"],
    {
      cwd: path.join(import.meta.dirname, ".."),
      env: {
        ...process.env,
        // The bundle's data dir holds its manifest and server.lock (scripts/e2e.ts).
        PP_DATA_DIR: path.dirname(manifest),
        PP_DM_SECRET: secret,
        PP_PROFILE: "verify",
      },
      timeout: 30_000,
    },
  );
  return JSON.parse(stdout) as Record<string, unknown>;
}

test("FR-AGENT-28 mcp:call character_put_row → player-1's sheet Items shows the item, no reload", async ({
  browser,
}) => {
  const { link, recordId } = e2eEnv();
  const mira = recordId("char-mira", "entity");
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);
  const win = await openWindow(p1, "char.sheet");
  await expect(win.getByTestId("char-sheet")).toHaveAttribute("data-record-id", mira);
  await win.locator('[data-testid="charx-tab"][data-value="inventory"]').click();
  await expect(win.getByTestId("charx-item").filter({ hasText: ITEM })).toHaveCount(0);
  // A marker on the window object: a reload would drop it.
  await p1.evaluate(() => {
    (window as unknown as { agentE2e: number }).agentE2e = 1;
  });

  const r = await mcpCall("character_put_row", {
    creatureId: mira,
    list: "items",
    row: { name: ITEM, qty: 1, equipped: false, notes: "" },
  });
  expect(r).toMatchObject({ creatureId: mira, list: "items", rowId: expect.any(String) });

  const item = win.locator(`[data-testid="charx-item"][data-record-id="${r.rowId}"]`);
  await expect(item).toBeVisible();
  await expect(item).toContainText(ITEM);
  expect(await p1.evaluate(() => (window as unknown as { agentE2e?: number }).agentE2e)).toBe(1);
  await p1.context().close();
});
