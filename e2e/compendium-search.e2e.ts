// e2e-bundle: compendium-full
// Thin S4 search flow (CMP §13 E2E, C-search): over the full SRD import the DM searches "potion
// heal" → Potion of Healing first (the DM-only homebrew one, then the SRD one); the All tab's
// default list shows one "Ability Score Improvement" row whose `sameAs` lists 12 members;
// player-1's "potion heal" starts with the SRD potion and never shows the hidden homebrew one.
// Group expand / collapse in the window is C-all; ranking table, leak scans: bun test
// (search-s4.test.ts).
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

async function live(page: Page) {
  await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
}

test("FR-CMP-33 FR-CMP-35 FR-CMP-36 DM: 'potion heal' → Potion of Healing first; All tab shows one ASI group (12 via sameAs); player-1 never sees the hidden homebrew potion", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();

  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const win = await openWindow(dm, "cmp.compendium");
  await win.getByTestId("cmp-search").fill("potion heal");
  const results = win.getByTestId("cmp-result");
  await expect(results.getByTestId("cmp-result-name")).toHaveText([
    "Potion of Healing",
    "Potion of Healing",
    "Healing Draught",
    "Potion of Poison",
    "Robe of Useful Items",
  ]);
  await expect(results.nth(0)).toContainText("Homebrew");
  await expect(results.nth(1)).toContainText("SRD");
  // Word order doesn't matter.
  await win.getByTestId("cmp-search").fill("heal potion");
  await expect(results.first()).toContainText("Potion of Healing");
  await expect(results).toHaveCount(5);

  // All tab, empty search: one ASI row (a group of 12, by folded name).
  await win.getByTestId("cmp-search").fill("");
  const asi = results.filter({
    has: dm.getByTestId("cmp-result-name").getByText("Ability Score Improvement", { exact: true }),
  });
  await expect(asi).toHaveCount(1);
  await expect(asi).toContainText("12 entries · Barbarian, Bard, Cleric");
  const asiId = (await asi.getAttribute("data-record-id")) as string;
  const members = await dm.request.get(
    `/api/compendium/search?${new URLSearchParams({ sameAs: asiId })}`,
    { headers: { Authorization: `Bearer ${secret}` } },
  );
  expect(members.status()).toBe(200);
  const body = (await members.json()) as { results: { line: string }[] };
  expect(body.results).toHaveLength(12);
  expect(body.results[0]?.line).toBe("Barbarian · 4th level");

  // Player-1: the SRD potion first, the shared Healing Draught next; no hidden homebrew.
  const p1 = await rolePage(browser);
  const responses: string[] = [];
  p1.on("response", async (r) => {
    if (r.url().includes("/api/compendium/")) responses.push(await r.text().catch(() => ""));
  });
  await p1.goto(link("Player 1"));
  await live(p1);
  const pw = await openWindow(p1, "cmp.compendium");
  await pw.getByTestId("cmp-search").fill("potion heal");
  const pr = pw.getByTestId("cmp-result");
  await expect(pr.getByTestId("cmp-result-name")).toHaveText([
    "Potion of Healing",
    "Healing Draught",
    "Potion of Poison",
    "Robe of Useful Items",
  ]);
  await expect(pr.first()).toContainText("SRD");
  const raw = responses.join("\n");
  expect(raw).not.toContain("CMP-HB-POTION");
  expect(raw).not.toContain('"kind":"monster"');
});
