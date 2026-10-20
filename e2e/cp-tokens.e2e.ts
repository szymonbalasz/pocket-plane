// e2e-bundle: cp-tokens
// Sprint 6 CP5 (MAP FR-MAP-76, -77; CBT §13.3 C2's marker, thin): DM (A), player-1 (B, Mira) and
// player-2 (C, Thorn) at 1440×900 on Goblin Ambush, no fight. Mira's Owlbear and Thorn's Wolf
// carry a paw chip (`map-token-companion`) in their owner's colour over the dark casing, the same
// on A, B and C, with "Player 1's companion" / "Player 2's companion" on hover; PC tokens carry
// none. Double-click on the Owlbear: B and A open the companion card, C gets nothing (with the
// card not yet registered, nobody does). Overlay rule, compact sizes, bound-combatant case: bun
// test (companion-token.test.ts).
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { konvaNodes, tokenNode } from "./support/konva";
import { showToPlayers } from "./support/scenes";
import { launcherButton, shellWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

interface Marker {
  id: string;
  color: string | null;
  tip: string | null;
  compact: boolean;
}

/** The companion markers drawn now, with their colour, tooltip and chip attrs. */
function markers(page: Page): Promise<Marker[]> {
  return page.evaluate(() => {
    type KNode = { id(): string; getAttr(a: string): unknown };
    const K = (window as unknown as { Konva?: { stages: { find(s: string): KNode[] }[] } }).Konva;
    return (K?.stages[0]?.find(".map-token-companion") ?? []).map((n) => ({
      id: n.id(),
      color: (n.getAttr("color") as string | undefined) ?? null,
      tip: (n.getAttr("tip") as string | undefined) ?? null,
      compact: n.getAttr("compact") === true,
    }));
  });
}

async function dblClickToken(page: Page, tokenId: string) {
  const t = await tokenNode(page, tokenId);
  if (!t) throw new Error(`token ${tokenId} not drawn`);
  await page.mouse.dblclick(t.x, t.y);
}

test("FR-MAP-76 FR-MAP-77 cp-tokens: a paw in the owner's colour on owned pet tokens for DM and players; owner and DM double-click to the card, another player gets nothing", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const owl = recordId("pet-owlbear", "token");
  const wolf = recordId("cp-pet-thorn", "token");
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1440, height: 900 });
  await p1.goto(link("Player 1"));
  await live(p1);
  const p2 = await rolePage(browser);
  await p2.setViewportSize({ width: 1440, height: 900 });
  await p2.goto(link("Player 2"));
  await live(p2);

  // The DM views Goblin Ambush and shows it to players.
  const ambush = recordId("battlemap", "scene");
  await showToPlayers(dm, "Goblin Ambush");
  await shellWindow(dm, "map.scenes")
    .locator(`[data-testid="map-scene-row"][data-record-id="${ambush}"] button`)
    .first()
    .click();
  for (const page of [dm, p1, p2]) {
    await expect(page.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  }

  // FR-MAP-76: the same markers on every client, only on the owned pet tokens.
  const seen: Record<string, Marker[]> = {};
  for (const [name, page] of [
    ["dm", dm],
    ["p1", p1],
    ["p2", p2],
  ] as const) {
    await expect
      .poll(async () => (await markers(page)).map((m) => m.id).sort())
      .toEqual([owl, wolf].sort());
    const ms = await markers(page);
    for (const m of ms) {
      expect(m.compact).toBe(true);
      expect(m.color).toMatch(/^#[0-9a-f]{6}$/i);
      // Over the dark casing (FR-MAP-72).
      expect((await konvaNodes(page, "map-casing", m.id)).length).toBeGreaterThan(0);
    }
    seen[name] = ms.sort((a, b) => a.id.localeCompare(b.id));
  }
  expect(seen.p1).toEqual(seen.dm);
  expect(seen.p2).toEqual(seen.dm);
  const byId = new Map(seen.dm?.map((m) => [m.id, m]));
  expect(byId.get(owl)?.tip).toBe("Player 1's companion");
  expect(byId.get(wolf)?.tip).toBe("Player 2's companion");
  expect(byId.get(owl)?.color).not.toBe(byId.get(wolf)?.color);

  // FR-MAP-77: double-click on the Owlbear. The card (CP4) may not be registered yet: then no
  // client opens anything.
  const card = (page: Page) => shellWindow(page, "charx.companion");
  const registered = (await launcherButton(p1, "charx.companion").count()) > 0;
  await dblClickToken(p2, owl);
  await dblClickToken(p1, owl);
  await dblClickToken(dm, owl);
  if (registered) {
    await expect(card(p1)).toBeVisible();
    await expect(card(dm)).toBeVisible();
  } else {
    await dm.waitForTimeout(500);
    await expect(card(p1)).toHaveCount(0);
    await expect(card(dm)).toHaveCount(0);
  }
  await expect(card(p2)).toHaveCount(0);
});
