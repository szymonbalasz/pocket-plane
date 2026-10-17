// e2e-bundle: compendium-full
// Thin All tab flow (CMP §13 S1 / S5, C-all): over the full SRD import the DM's empty search
// shows one "Ability Score Improvement" group row (12 entries), expands it to 12 member rows with
// class lines, opens "Fighter · 4th level", Back keeps the group open, a click collapses it; a
// search with no match says every word must match. player-1's Features tab shows the same one
// group. Group / sameAs counts and leak scans: bun test (search-s4.test.ts).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

async function live(page: Page) {
  await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
}

const asiRow = (win: Locator) =>
  win.getByTestId("cmp-result").filter({
    has: win
      .page()
      .getByTestId("cmp-result-name")
      .getByText("Ability Score Improvement", { exact: true }),
  });

test("FR-CMP-35 FR-CMP-36 All tab: one ASI group row (12 entries) expands in place to 12 class rows; open Fighter, Back keeps it open; 'zzqx' → every word must match; player-1 Features shows the same group", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();

  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const win = await openWindow(dm, "cmp.compendium");
  await expect(win.getByTestId("cmp-search")).toHaveAttribute(
    "placeholder",
    "Search: words in any order",
  );

  // Empty search, All tab: one collapsed ASI row, not 12.
  const asi = asiRow(win);
  await expect(asi).toHaveCount(1);
  await expect(asi).toHaveAttribute("data-group-count", "12");
  await expect(asi).toContainText("12 entries · Barbarian, Bard, Cleric");
  const toggle = asi.getByTestId("cmp-group-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  const members = win.getByTestId("cmp-group-member");
  await expect(members).toHaveCount(0);

  // Expand → 12 members in place, by line.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(members).toHaveCount(12);
  await expect(members.first()).toContainText("Barbarian · 4th level");

  // Open a member → its entry; Back → the group is still open.
  const fighter = members.filter({ hasText: "Fighter · 4th level" });
  const fighterId = (await fighter.getAttribute("data-record-id")) as string;
  await fighter.click();
  await expect(win.getByTestId("cmp-entry")).toHaveAttribute("data-record-id", fighterId);
  await expect(win.getByTestId("cmp-entry")).toContainText("Ability Score Improvement");
  await win.getByTestId("cmp-back").click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(members).toHaveCount(12);

  // Click the row again → collapsed.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(members).toHaveCount(0);

  // A new search collapses groups; one with every member matching keeps the count.
  await toggle.click();
  await win.getByTestId("cmp-search").fill("ability score");
  await expect(asi).toHaveAttribute("data-group-count", "12");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");

  // No match: the full empty copy.
  await win.getByTestId("cmp-search").fill("zzqx");
  await expect(win.getByTestId("cmp-empty")).toHaveText(
    "No matches for ‘zzqx’. Every word must match.",
  );

  // player-1: Features tab, empty search → one ASI group; it expands to 12.
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);
  const pw = await openWindow(p1, "cmp.compendium");
  await pw.getByTestId("cmp-tab").and(pw.locator('[data-value="feature"]')).click();
  const pAsi = asiRow(pw);
  await expect(pAsi).toHaveCount(1);
  await expect(pAsi).toHaveAttribute("data-group-count", "12");
  await pAsi.getByTestId("cmp-group-toggle").click();
  await expect(pw.getByTestId("cmp-group-member")).toHaveCount(12);
});
