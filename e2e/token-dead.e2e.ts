// e2e-bundle: spell-fx
// Mark dead (FR-MAP-151), DM + player-1 in their own contexts: right-click Mira → Mark dead → the
// red X on both screens, outside combat; Mark alive takes it off.
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { konvaNodes, tokenNode } from "./support/konva";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

async function tokenId(page: Page, name: string): Promise<string | null> {
  const labels = await konvaNodes(page, "map-token-label");
  return labels.find((l) => l.text === name)?.id ?? null;
}

test("FR-MAP-151 token menu → Mark dead: the X on both screens; Mark alive clears it", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1440, height: 900 });
  await p1.goto(link("Player 1"));
  await live(dm);
  await live(p1);
  await expect.poll(() => tokenId(dm, "Mira")).not.toBeNull();
  const mira = (await tokenId(dm, "Mira")) as string;
  await expect.poll(() => tokenNode(p1, mira)).not.toBeNull();
  const crosses = async (page: Page) => (await konvaNodes(page, "map-token-dead", mira)).length;
  expect(await crosses(dm)).toBe(0);

  const menu = async () => {
    const t = await tokenNode(dm, mira);
    if (!t) throw new Error("Mira not on the DM's map");
    await dm.mouse.click(t.x, t.y, { button: "right" });
    return dm.getByTestId("map-token-menu-dead");
  };

  const mark = await menu();
  await expect(mark).toHaveText(/Mark dead/);
  await mark.click();
  await expect.poll(() => crosses(dm)).toBe(1);
  await expect.poll(() => crosses(p1)).toBe(1);

  const unmark = await menu();
  await expect(unmark).toHaveAttribute("data-dead", "true");
  await expect(unmark).toHaveText(/Mark alive/);
  await unmark.click();
  await expect.poll(() => crosses(dm)).toBe(0);
  await expect.poll(() => crosses(p1)).toBe(0);
});
