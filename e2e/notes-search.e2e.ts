// e2e-bundle: notes
// Thin flow of the Notes window's search (NOTES N4, FR-NOTES-22): a player types a new word into
// Quest log; the DM's search finds it at once (the open note's live text) with a snippet, and a
// click opens the note; clearing the box brings the list back. Another player: a note they bin
// stops being a hit, the other campaign's canary never is one; a body word finds Burnt Ledger. Ranking,
// limits, auth and isolation: bun test.
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

test("FR-NOTES-22 search finds titles, bodies and an open note's live text; a click opens the note", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);
  const p2 = await rolePage(browser);
  await p2.goto(link("Player 2"));
  await live(p2);

  // Player 1 types a new word into Quest log (not folded into the stored body yet).
  const p1Win = await openWindow(p1, "notes.main");
  await p1Win.getByTestId("notes-list-item").filter({ hasText: "Quest log" }).first().click();
  await expect(p1Win.getByTestId("notes-status")).toHaveText("Saved");
  await p1Win.locator(".cm-line").first().click();
  await p1.keyboard.press("End");
  await p1.keyboard.type(" zephyrstone vault", { delay: 15 });
  await expect(p1Win.getByTestId("notes-status")).toHaveText("Saved");

  // The DM's search finds it, with a snippet; the list gives way to the results.
  const dmWin = await openWindow(dm, "notes.main");
  await expect(dmWin.getByTestId("notes-list-item").first()).toBeVisible();
  await dmWin.getByTestId("notes-search").fill("zephyr");
  const hit = dmWin.getByTestId("notes-search-result");
  await expect(hit).toHaveCount(1);
  await expect(hit).toContainText("Quest log");
  await expect(hit.getByTestId("notes-search-snippet")).toContainText("zephyrstone vault");
  await expect(dmWin.getByTestId("notes-list-item").first()).toBeHidden();
  await hit.click();
  await expect(dmWin.getByTestId("notes-title")).toHaveText("Quest log");
  await expect(dmWin.getByTestId("notes-status")).toHaveText("Saved");
  await dmWin.getByTestId("notes-search-clear").click();
  await expect(dmWin.getByTestId("notes-search-results")).toHaveCount(0);
  await expect(dmWin.getByTestId("notes-list-item").first()).toBeVisible();

  // Player 2 bins a note of their own: it and the other campaign's canary never show.
  const p2Win = await openWindow(p2, "notes.main");
  await p2Win.getByTestId("notes-new").click();
  await p2.getByTestId("notes-title-input").fill("Zanzibar dossier");
  await p2.getByTestId("notes-title-save").click();
  await expect(p2Win.getByTestId("notes-title")).toHaveText("Zanzibar dossier");
  const box = p2Win.getByTestId("notes-search");
  await box.fill("zanzibar");
  await expect(p2Win.getByTestId("notes-search-result")).toHaveCount(1);
  await box.fill("");
  await p2Win.getByTestId("notes-delete").click();
  await p2.getByTestId("notes-delete-confirm").click();
  await expect(p2.getByTestId("notes-delete-dialog")).toHaveCount(0);
  for (const q of ["zanzibar", "canary"]) {
    await box.fill(q);
    await expect(p2Win.getByTestId("notes-search-empty")).toBeVisible();
    await expect(p2Win.getByTestId("notes-search-result")).toHaveCount(0);
  }
  // A body word: Burnt Ledger ("Found in Duke Varen's office").
  await box.fill("office");
  const ledger = p2Win.getByTestId("notes-search-result");
  await expect(ledger).toHaveCount(1);
  await expect(ledger).toContainText("Burnt Ledger");
  await ledger.click();
  await expect(p2Win.getByTestId("notes-title")).toHaveText("Burnt Ledger");
});
