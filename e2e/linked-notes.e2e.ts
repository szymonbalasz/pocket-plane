// e2e-bundle: notes
// Thin flows of the Notes window (NOTES N3, FR-NOTES-13 – -18, -20, -04 – -05): the DM and two
// players type into Burnt Ledger at once and end with the same text, with carets and who-is-here
// chips; undo takes back only your own typing; a player typing offline catches up on reconnect;
// delete → the other reader's banner → Recycle bin → Restore. Rules and limits: bun test.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

async function setup(browser: Parameters<typeof rolePage>[0]) {
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
  return { dm, p1, p2 };
}

/** Opens Notes and the note titled `title`; returns the window. */
async function openNote(page: Page, title: string): Promise<Locator> {
  const win = await openWindow(page, "notes.main");
  await win.getByTestId("notes-list-item").filter({ hasText: title }).first().click();
  await expect(win.getByTestId("notes-title")).toHaveText(title);
  await expect(win.getByTestId("notes-status")).toHaveText("Saved");
  return win;
}

/** The editor's text, without other people's caret name tags. */
const docText = (win: Locator) =>
  win.getByTestId("notes-editor").evaluate((el) => {
    const content = el.querySelector(".cm-content");
    if (!content) return "";
    const copy = content.cloneNode(true) as HTMLElement;
    for (const tag of copy.querySelectorAll(".cm-remote-caret")) tag.remove();
    return [...copy.querySelectorAll(".cm-line")].map((l) => l.textContent ?? "").join("\n");
  });

/** Types at the end of line `line` (1-based), as a person would. */
async function typeAtLine(page: Page, win: Locator, line: number, text: string) {
  await win
    .locator(".cm-line")
    .nth(line - 1)
    .click();
  await page.keyboard.press("End");
  await page.keyboard.type(text, { delay: 15 });
}

test("FR-NOTES-14 FR-NOTES-15 FR-NOTES-16 FR-NOTES-17 three people type into Burnt Ledger at once: same text everywhere, carets and chips show, undo takes back only your own", async ({
  browser,
}) => {
  const { dm, p1, p2 } = await setup(browser);
  const wins = [
    await openNote(dm, "Burnt Ledger"),
    await openNote(p1, "Burnt Ledger"),
    await openNote(p2, "Burnt Ledger"),
  ];
  const [dmWin, p1Win, p2Win] = wins as [Locator, Locator, Locator];
  for (const w of wins) await expect(w.getByTestId("notes-here")).toHaveCount(3);

  await Promise.all([
    typeAtLine(dm, dmWin, 1, " [dm-line-1]"),
    typeAtLine(p1, p1Win, 2, " [p1-line-2]"),
    typeAtLine(p2, p2Win, 3, " [p2-line-3]"),
  ]);
  for (const w of wins) await expect(w.getByTestId("notes-status")).toHaveText("Saved");
  await expect
    .poll(async () => new Set(await Promise.all(wins.map(docText))).size, { timeout: 5_000 })
    .toBe(1);
  const text = await docText(dmWin);
  for (const s of ["[dm-line-1]", "[p1-line-2]", "[p2-line-3]"])
    expect(text.split(s).length - 1).toBe(1);

  // FR-NOTES-15: the others' carets, each tagged; FR-NOTES-16: a chip per person.
  await expect(dmWin.locator('[data-testid="notes-cursor"]')).not.toHaveCount(0);
  await expect(p2Win.getByTestId("notes-here").filter({ hasText: "You" })).toHaveCount(1);

  // FR-NOTES-17: Player 1's undo removes only Player 1's typing, for everyone.
  await p1Win.locator(".cm-content").click();
  for (let i = 0; i < 3; i++) await p1.keyboard.press("Control+z");
  await expect.poll(() => docText(p2Win), { timeout: 5_000 }).not.toContain("[p1-line-2]");
  const after = await docText(p2Win);
  expect(after).toContain("[dm-line-1]");
  expect(after).toContain("[p2-line-3]");
  await expect.poll(() => docText(dmWin)).toBe(after);
});

test("FR-NOTES-18 a player typing offline sees Offline, then catches up on reconnect: nothing lost", async ({
  browser,
}) => {
  const { dm, p1 } = await setup(browser);
  const dmWin = await openNote(dm, "Quest log");
  const p1Win = await openNote(p1, "Quest log");
  await p1.context().setOffline(true);
  await expect(p1Win.getByTestId("notes-status")).toHaveText("Offline", { timeout: 15_000 });
  await typeAtLine(p1, p1Win, 1, " (typed offline)");
  await typeAtLine(dm, dmWin, 2, " (DM meanwhile)");
  await expect(dmWin.getByTestId("notes-status")).toHaveText("Saved");
  await p1.context().setOffline(false);
  await live(p1);
  await expect(p1Win.getByTestId("notes-status")).toHaveText("Saved", { timeout: 15_000 });
  await expect.poll(() => docText(dmWin), { timeout: 10_000 }).toContain("(typed offline)");
  expect(await docText(p1Win)).toBe(await docText(dmWin));
  expect(await docText(p1Win)).toContain("(DM meanwhile)");
});

test("FR-NOTES-04 FR-NOTES-05 FR-NOTES-20 delete while another reads it: their banner, the Recycle bin, Restore brings it back intact", async ({
  browser,
}) => {
  const { p1, p2 } = await setup(browser);
  const p2Win = await openNote(p2, "Duke Varen");
  const text = await docText(p2Win);
  const p1Win = await openNote(p1, "Duke Varen");
  const bin = p1Win.getByTestId("notes-bin");
  const before = Number(await bin.getAttribute("data-count"));

  await p1Win.getByTestId("notes-delete").click();
  await p1.getByTestId("notes-delete-confirm").click();
  await expect(p2Win.getByTestId("notes-banner")).toHaveAttribute("data-kind", "deleted");
  await expect(p2Win.getByTestId("notes-banner")).toContainText("This note was deleted");
  await expect(p2Win.getByTestId("notes-copy-text")).toBeVisible();
  await expect(bin).toHaveAttribute("data-count", String(before + 1));
  await expect(p1Win.getByTestId("notes-list-item").filter({ hasText: "Duke Varen" })).toHaveCount(
    0,
  );

  await bin.click();
  const row = p1Win.getByTestId("notes-bin-item").filter({ hasText: "Duke Varen" });
  await row.getByTestId("notes-restore").click();
  await expect(bin).toHaveAttribute("data-count", String(before));
  await expect(p2Win.getByTestId("notes-list-item").filter({ hasText: "Duke Varen" })).toHaveCount(
    1,
  );
  await expect(p1Win.getByTestId("notes-title")).toHaveText("Duke Varen");
  await expect.poll(() => docText(p1Win), { timeout: 5_000 }).toBe(text);
  // The reader re-opens it: the banner goes, the text is intact.
  await p2Win.getByTestId("notes-list-item").filter({ hasText: "Duke Varen" }).click();
  await expect.poll(() => docText(p2Win), { timeout: 5_000 }).toBe(text);
});
