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
  // At the line's start (a click on a link chip would follow it, N5).
  await win
    .locator(".cm-line")
    .nth(line - 1)
    .click({ position: { x: 3, y: 6 } });
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
  // r1 (FR-NOTES-15): idle carets stay; their name tags give way after ~2 s.
  const idle = await dmWin.locator('[data-testid="notes-cursor"]').count();
  await dm.waitForTimeout(11_000);
  await expect(dmWin.locator('[data-testid="notes-cursor"]')).toHaveCount(idle);
  await expect(dmWin.locator('[data-testid="notes-cursor"][data-tag="shown"]')).toHaveCount(0);
  // r2: name tags in the kit's smallest text, 12 px.
  expect(
    await dmWin
      .getByTestId("notes-cursor-tag")
      .first()
      .evaluate((el) => getComputedStyle(el).fontSize),
  ).toBe("12px");
  // r1 (FR-NOTES-16): a chip click jumps to an idle person's caret.
  await dmWin.getByTestId("notes-here").filter({ hasNotText: "You" }).first().click();
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

/** Drags the window's resize handle until it is `w` × `h` (as useful-size does). */
async function resizeTo(page: Page, win: Locator, w: number, h: number) {
  const box = await win.boundingBox();
  const handle = await win.getByTestId("ui-window-resize").boundingBox();
  if (!box || !handle) throw new Error("window not shown");
  const x = handle.x + handle.width / 2;
  const y = handle.y + handle.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++)
    await page.mouse.move(x + ((w - box.width) * i) / 5, y + ((h - box.height) * i) / 5);
  await page.mouse.up();
  await expect
    .poll(async () => {
      const b = await win.boundingBox();
      return b && [Math.round(b.width), Math.round(b.height)];
    })
    .toEqual([w, h]);
}

test("r1 FR-NOTES-13 the editor is framed, scrolls inside itself and is named after the note; narrow Notes still reaches the Recycle bin and Restore", async ({
  browser,
}) => {
  const { p1 } = await setup(browser);
  const win = await openNote(p1, "Burnt Ledger");
  const editor = win.getByTestId("notes-editor");
  expect(await editor.evaluate((el) => getComputedStyle(el).borderTopWidth)).not.toBe("0px");
  await expect(win.locator(".cm-content")).toHaveAttribute("aria-label", "Burnt Ledger");
  await win.locator(".cm-content").click();
  await p1.keyboard.press("Control+End");
  for (let i = 0; i < 40; i++) await p1.keyboard.press("Enter");
  await p1.keyboard.type("bottom line");
  const scroll = await win.locator(".cm-scroller").evaluate((el) => ({
    over: el.scrollHeight > el.clientHeight,
    y: getComputedStyle(el).overflowY,
  }));
  expect(scroll).toEqual({ over: true, y: "auto" });
  const body = await win
    .getByTestId("ui-window-body")
    .evaluate((el) => el.scrollHeight <= el.clientHeight + 1);
  expect(body).toBe(true);

  await resizeTo(p1, win, 400, 420);
  await expect(win.getByTestId("notes-picker-narrow")).toBeVisible();
  const bin = win.getByTestId("notes-bin-narrow");
  await expect(bin).toBeVisible();
  await expect(bin).toContainText("Recycle bin"); // r2: a label, not a bare trash can
  await bin.click();
  const dialog = p1.getByTestId("notes-bin-dialog");
  const row = dialog.getByTestId("notes-bin-item").filter({ hasText: "Old rumours" });
  await expect(row.getByTestId("notes-bin-deleted")).toContainText("Deleted by DM ·");
  await row.getByTestId("notes-restore").click();
  await expect(dialog).toHaveCount(0);
  await expect(win.getByTestId("notes-title")).toHaveText("Old rumours");
});

/** The text before `name`'s caret on its line, as drawn in `win` (other carets left out). */
const beforeCaret = (win: Locator, name: string) =>
  win.getByTestId("notes-editor").evaluate((el, who) => {
    const caret = [...el.querySelectorAll(".cm-remote-caret")].find(
      (c) => c.querySelector(".cm-remote-tag")?.textContent === who,
    );
    const line = caret?.closest(".cm-line");
    if (!caret || !line) return null;
    const range = document.createRange();
    range.setStart(line, 0);
    range.setEndBefore(caret);
    const box = document.createElement("div");
    box.appendChild(range.cloneContents());
    for (const other of box.querySelectorAll(".cm-remote-caret")) other.remove();
    return box.textContent;
  }, name);

test("r2 FR-NOTES-15 FR-NOTES-16 a late joiner sees where everyone sits and can jump there; a typist's caret is drawn where they really are", async ({
  browser,
}) => {
  const { dm, p1, p2 } = await setup(browser);
  const dmWin = await openNote(dm, "Duke Varen");
  const p1Win = await openNote(p1, "Duke Varen");
  await p1Win
    .locator(".cm-line")
    .first()
    .click({ position: { x: 3, y: 6 } }); // P1 sits in line 1, then idles
  await expect(dmWin.locator('[data-testid="notes-cursor"]')).toHaveCount(1);
  await p1.waitForTimeout(3_000);

  // P2 opens the note after everyone settled: P1's caret is there without P1 moving.
  const p2Win = await openNote(p2, "Duke Varen");
  await expect(p2Win.locator('[data-testid="notes-cursor"]')).not.toHaveCount(0);
  await expect(p2Win.locator(".cm-remote-tag", { hasText: "Player 1" })).toHaveCount(1);
  await p2Win.getByTestId("notes-here").filter({ hasText: "Player 1" }).click();
  await expect(
    p2Win.locator(".cm-remote-caret", {
      has: p2.locator(".cm-remote-tag", { hasText: "Player 1" }),
    }),
  ).toBeVisible();

  // Drift: P2's caret after "Keeps ", types "abcde": others draw it right after "abcde".
  await p2Win
    .locator(".cm-line")
    .first()
    .click({ position: { x: 3, y: 6 } });
  await p2.keyboard.press("Home");
  for (let i = 0; i < "Keeps ".length; i++) await p2.keyboard.press("ArrowRight");
  await p2.keyboard.type("abcde", { delay: 20 });
  await expect(p2Win.getByTestId("notes-status")).toHaveText("Saved");
  for (const w of [dmWin, p1Win])
    await expect.poll(() => beforeCaret(w, "Player 2"), { timeout: 5_000 }).toBe("Keeps abcde");
  // At the line's end: "ZQ", drawn at the end, not on the next line.
  await p2.keyboard.press("End");
  await p2.keyboard.type("ZQ", { delay: 20 });
  await expect(p2Win.getByTestId("notes-status")).toHaveText("Saved");
  await expect
    .poll(async () => (await beforeCaret(dmWin, "Player 2"))?.endsWith("ZQ"), { timeout: 5_000 })
    .toBe(true);
});

/** The note's raw text as stored (chips back to `[[…]]`): read from the server-confirmed doc. */
const lineTexts = (win: Locator) =>
  win.locator(".cm-line").evaluateAll((lines) =>
    lines.map((l) => {
      const copy = l.cloneNode(true) as HTMLElement;
      for (const c of copy.querySelectorAll(".cm-remote-caret, .cm-note-die")) c.remove();
      for (const chip of copy.querySelectorAll("[data-testid=notes-link]"))
        chip.replaceWith(`[[${(chip as HTMLElement).dataset.title}]]`);
      return copy.textContent ?? "";
    }),
  );

async function newLine(page: Page, win: Locator) {
  await win
    .locator(".cm-line")
    .first()
    .click({ position: { x: 3, y: 6 } });
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
}

test("N5 FR-NOTES-07 – -12 FR-NOTES-23 the @ picker links for everyone; chips follow, delete whole and create missing notes; backlinks update live; a die rolls as 'Note'", async ({
  browser,
}) => {
  const { dm, p1, p2 } = await setup(browser);
  const dmWin = await openNote(dm, "Duke Varen");
  const before = Number(await dmWin.getByTestId("notes-backlinks").getAttribute("data-count"));
  const p1Win = await openNote(p1, "Quest log");
  const p2Win = await openNote(p2, "Quest log");

  // FR-NOTES-13: headings, lists and bold are styled in place ("# Quest log", "- Recover…").
  await expect(p2Win.locator(".cm-line.cm-note-h1")).toHaveCount(1);
  await expect(p2Win.locator(".cm-line.cm-note-li")).toHaveCount(1);
  await newLine(p1, p1Win);
  await p1.keyboard.type("**Bold** move", { delay: 10 });
  await expect(p2Win.locator(".cm-note-bold")).toHaveText("Bold");

  // @ picker: "@Du" + Enter inserts a Duke Varen chip, for everyone.
  await newLine(p2, p2Win);
  await p2.keyboard.type("Ask @Du", { delay: 20 });
  await expect(p2Win.getByTestId("notes-picker")).toBeVisible();
  await expect(p2Win.getByTestId("notes-picker-item").first()).toHaveText("Duke Varen");
  await expect(p2Win.getByTestId("notes-picker-create")).toHaveText('Create note "Du"');
  await p2.keyboard.press("Enter");
  await expect(p2Win.getByTestId("notes-picker")).toHaveCount(0);
  for (const w of [p2Win, p1Win])
    await expect(w.locator('[data-testid="notes-link"][data-title="Duke Varen"]')).toHaveCount(1);
  // FR-NOTES-12: the DM reading Duke Varen sees "Quest log" join its backlinks, live.
  await expect(dmWin.getByTestId("notes-backlinks")).toHaveAttribute(
    "data-count",
    String(before + 1),
  );
  await expect(dmWin.getByTestId("notes-backlink").filter({ hasText: "Quest log" })).toHaveCount(1);

  // "@Nobody" then Esc: plain text, no link.
  await newLine(p1, p1Win);
  await p1.keyboard.type("@Nobody", { delay: 20 });
  await expect(p1Win.getByTestId("notes-picker")).toBeVisible();
  await p1.keyboard.press("Escape");
  await expect(p1Win.getByTestId("notes-picker")).toHaveCount(0);
  await expect.poll(async () => (await lineTexts(p2Win)).at(-1)).toBe("@Nobody");

  // Backspace just after a chip removes it whole (Quest log already links Burnt Ledger once).
  const ledgerChips = p2Win.locator('[data-testid="notes-link"][data-title="Burnt Ledger"]');
  const had = await ledgerChips.count();
  await newLine(p2, p2Win);
  await p2.keyboard.type("@Burnt", { delay: 20 });
  await p2.keyboard.press("Enter");
  await expect(ledgerChips).toHaveCount(had + 1);
  await p2.keyboard.press("Backspace");
  await expect(ledgerChips).toHaveCount(had);
  expect((await lineTexts(p2Win)).at(-1)).toBe("");

  // A hand-typed link to a missing note: dotted; a click creates and opens it.
  await p2.keyboard.type("[[Lost tomb]] ", { delay: 10 });
  await p2.keyboard.press("Escape");
  const missing = p2Win.locator('[data-testid="notes-link"][data-title="Lost tomb"]');
  await expect(missing).toHaveAttribute("data-missing", "true");
  await expect(p2Win.getByTestId("notes-status")).toHaveText("Saved");
  await missing.click();
  await expect(p2Win.getByTestId("notes-title")).toHaveText("Lost tomb");
  await expect(p1Win.getByTestId("notes-list-item").filter({ hasText: "Lost tomb" })).toHaveCount(
    1,
  );
  await expect(p1Win.locator('[data-testid="notes-link"][data-title="Lost tomb"]')).toHaveAttribute(
    "data-missing",
    "false",
  );

  // A chip click follows it (the caret stays where it was).
  await p1Win.locator('[data-testid="notes-link"][data-title="Duke Varen"]').click();
  await expect(p1Win.getByTestId("notes-title")).toHaveText("Duke Varen");

  // FR-NOTES-13, -23: Burnt Ledger's "2d6" has a die; a click rolls, the log reads "Note".
  const ledger = await openNote(p1, "Burnt Ledger");
  const log = await openWindow(dm, "dice.log");
  await ledger.locator('[data-testid="notes-die"][data-value="2d6"]').click();
  const entry = log.getByTestId("dice-log-entry").last();
  await expect(entry).toContainText("Note");
  await expect(entry).not.toContainText("Burnt Ledger");
});
