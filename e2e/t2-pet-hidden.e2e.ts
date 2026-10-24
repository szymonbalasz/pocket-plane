// e2e-bundle: t2-pet-hidden-e2e
// Sprint 10 T2 (BL-114, FR-ENT-37, FR-PARTY-61): the DM hides Mira's Owlbear (its token) in the
// running ambush. Player 2 loses its Party status row and its snapshot no longer holds the pet's
// redacted entity, also after a reload; player 1 (the owner) keeps it. Shown → back for player 2.
// The hide / show go over a DM socket of its own. Rules and leak scans: bun test.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";
import { closeToasts } from "./support/toasts";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

type Cred = { role: "dm"; secret: string } | { role: "player"; token: string };
type Records = Record<string, Record<string, unknown>[]>;

/** A socket of its own: hello → snapshot (its records) → optional intent → ack. */
function socket(page: Page, credential: Cred, intent?: { name: string; payload: unknown }) {
  return page.evaluate(
    ([credential, intent]) =>
      new Promise<Records>((resolve, reject) => {
        const ws = new WebSocket(`${location.origin.replace(/^http/, "ws")}/ws`);
        ws.onopen = () => ws.send(JSON.stringify({ type: "hello", credential }));
        let records: Records = {};
        ws.onmessage = (m) => {
          const f = JSON.parse(String(m.data)) as { type: string; records?: Records };
          if (f.type === "snapshot") {
            records = f.records ?? {};
            if (!intent) {
              ws.close();
              resolve(records);
              return;
            }
            ws.send(JSON.stringify({ type: "intent", intentId: crypto.randomUUID(), ...intent }));
          } else if (f.type === "ack") {
            ws.close();
            resolve(records);
          } else if (f.type === "reject") {
            ws.close();
            reject(new Error(String(m.data)));
          }
        };
      }),
    [credential, intent ?? null] as const,
  );
}

/** Party Manager on its Party status tab (companions under their PCs, FR-PARTY-61). */
async function status(page: Page): Promise<Locator> {
  const board = await openWindow(page, "party.board");
  await closeToasts(page);
  await board.locator('[data-testid="party-tab"][data-value="status"]').click();
  await expect(board.getByTestId("party-status")).toBeVisible();
  return board;
}

test("FR-ENT-37 FR-PARTY-61 BL-114 a hidden pet: player 2 loses its row and its entity (also after a reload); owner keeps it; back on show", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();
  const dmCred: Cred = { role: "dm", secret };
  const p2Cred: Cred = { role: "player", token: link("Player 2").split("/p/")[1] as string };
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);
  const p2 = await rolePage(browser);
  await p2.goto(link("Player 2"));
  await live(p2);

  // The ambush's scene active (the snapshot holds the active scene's tokens, ADR-0041).
  const first = await socket(dm, dmCred);
  const enc = (first.encounter ?? []).find((e) => e.status === "started") as { sceneId: string };
  const all = await socket(dm, dmCred, {
    name: "map.activateScene",
    payload: { sceneId: enc.sceneId },
  }).then(() => socket(dm, dmCred));
  const pet = (all.entity ?? []).find((e) => e.name === "Owlbear" && e.companionOf) as {
    id: string;
  };
  const tok = (all.token ?? []).find((t) => t.definitionId === pet.id) as { id: string };
  const owlbear = (b: Locator) =>
    b.getByTestId("party-companion-row").filter({ hasText: "Owlbear" });
  const has = async (cred: Cred) =>
    ((await socket(p2, cred)).entity ?? []).some((e) => e.id === pet.id);

  const b1 = await status(p1);
  let b2 = await status(p2);
  await expect(owlbear(b2)).toHaveCount(1);
  expect(await has(p2Cred)).toBe(true);

  await socket(dm, dmCred, {
    name: "map.setTokenHidden",
    payload: { tokenId: tok.id, hidden: true },
  });
  await expect(owlbear(b2)).toHaveCount(0);
  await expect(owlbear(b1)).toHaveCount(1);
  expect(await has(p2Cred)).toBe(false);
  await p2.reload();
  await live(p2);
  b2 = await status(p2);
  await expect(owlbear(b2)).toHaveCount(0);
  expect(await has(p2Cred)).toBe(false);

  await socket(dm, dmCred, {
    name: "map.setTokenHidden",
    payload: { tokenId: tok.id, hidden: false },
  });
  await expect(owlbear(b2)).toHaveCount(1);
  expect(await has(p2Cred)).toBe(true);

  for (const page of [p2, p1, dm]) await page.context().close();
});
