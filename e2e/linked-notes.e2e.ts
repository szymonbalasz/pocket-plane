// e2e-bundle: notes
// Thin flows of the Notes window (NOTES N3, FR-NOTES-13 – -18, -20, -04 – -05): the DM and two
// players type into Burnt Ledger at once and end with the same text, with carets and who-is-here
// chips; undo takes back only your own typing; a player typing offline catches up on reconnect;
// delete → the other reader's banner → Recycle bin → Restore. N8: a note made with a category
// shows in that fold-out for everyone, live; a category change moves it for everyone; Recent puts
// the last edited first and is remembered; the @ picker's Create note asks the category in the
// same popup; Linked from keeps its height. Rules and limits: bun test.
import { expect, type Locator, type Page, test } from "@playwright/test";
import sharp from "sharp";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";
import { storedTheme } from "./support/theme";

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

/** N8: opens every closed category fold-out of the list (their state is per browser). */
async function expandGroups(win: Locator) {
  // The list has loaded: a fold-out, a Recent row or "No notes yet".
  await expect(
    win
      .locator(
        '[data-testid="notes-group"], [data-testid="notes-list"] [data-testid="notes-list-item"], [data-testid="notes-empty"]',
      )
      .first(),
  ).toBeVisible();
  const closed = win.locator('[data-testid="notes-group"][data-state="closed"]');
  while ((await closed.count()) > 0) await closed.first().click();
}

/** N8: + New with a title and a category; the new note opens. */
async function newNote(page: Page, win: Locator, title: string, category = "other") {
  await win.getByTestId("notes-new").click();
  const dialog = page.getByTestId("notes-new-dialog");
  await dialog.getByTestId("notes-new-title").fill(title);
  await dialog.locator(`[data-testid="notes-category-pick"][data-category="${category}"]`).click();
  await dialog.getByTestId("notes-title-save").click();
  await expect(win.getByTestId("notes-title")).toHaveText(title);
}

/** Opens Notes and the note titled `title`; returns the window. */
async function openNote(page: Page, title: string): Promise<Locator> {
  const win = await openWindow(page, "notes.main");
  await expandGroups(win);
  await win.getByTestId("notes-list-item").filter({ hasText: title }).first().click();
  await expect(win.getByTestId("notes-title")).toHaveText(title);
  await expect(win.getByTestId("notes-status")).toHaveText("Saved");
  return win;
}

/**
 * The note's text as the editor holds it (N5: the live preview draws it differently per caret,
 * so the drawn lines aren't the text). CodeMirror's own back-reference on its content element
 * (`cmTile.root.view`, as `EditorView.findFromDOM`; the version is pinned by the lockfile).
 */
const docText = (win: Locator) =>
  win.getByTestId("notes-editor").evaluate((el) => {
    type Doc = { toString(): string };
    const content = el.querySelector(".cm-content") as
      | (Element & { cmTile?: { root?: { view?: { state: { doc: Doc } } } } })
      | null;
    const view = content?.cmTile?.root?.view;
    if (!view) throw new Error("no editor view");
    return view.state.doc.toString();
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
  // Who deleted it is shown whole (the time may move to a second line, never the name cut).
  const who = row.getByTestId("notes-bin-who");
  await expect(who).toHaveText(/^Deleted by /);
  expect(await who.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await row.getByTestId("notes-restore").click();
  await expect(bin).toHaveAttribute("data-count", String(before));
  await expandGroups(p2Win);
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
  await expect(p2.getByTestId("notes-picker")).toBeVisible();
  await expect(p2.getByTestId("notes-picker-item").first()).toHaveText("Duke Varen");
  await expect(p2.getByTestId("notes-picker-create")).toHaveText('Create note "Du"');
  await p2.keyboard.press("Enter");
  await expect(p2.getByTestId("notes-picker")).toHaveCount(0);
  for (const w of [p2Win, p1Win])
    await expect(w.locator('[data-testid="notes-link"][data-title="Duke Varen"]')).toHaveCount(1);
  // r1: live preview (caret elsewhere): "# Quest log" shows no "#", "- Recover" a bullet.
  await expect(p2Win.locator(".cm-line.cm-note-h1")).toHaveText(/^Quest log/);
  await expect(p2Win.locator(".cm-line.cm-note-li .cm-note-bullet")).toHaveText("•");
  // r1: a chip's hint, and no gap before what follows it.
  const duke = p1Win.locator('[data-testid="notes-link"][data-title="Duke Varen"]');
  await duke.hover();
  await expect(
    p1.getByTestId("ui-tooltip").filter({ hasText: "Open · Alt+click to edit" }),
  ).toBeVisible();
  expect(await duke.evaluate((el) => getComputedStyle(el).paddingRight)).toBe("3px");
  await p1.mouse.move(0, 0);

  // FR-NOTES-12: the DM reading Duke Varen sees "Quest log" join its backlinks, live.
  await expect(dmWin.getByTestId("notes-backlinks")).toHaveAttribute(
    "data-count",
    String(before + 1),
  );
  await expect(dmWin.getByTestId("notes-backlink").filter({ hasText: "Quest log" })).toHaveCount(1);

  // "@Nobody" then Esc: plain text, no link.
  await newLine(p1, p1Win);
  await p1.keyboard.type("@Nobody", { delay: 20 });
  await expect(p1.getByTestId("notes-picker")).toBeVisible();
  await p1.keyboard.press("Escape");
  await expect(p1.getByTestId("notes-picker")).toHaveCount(0);
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
  // r1: dashed, with its hint.
  expect(await missing.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe("dashed");
  await missing.hover();
  await expect(
    p2.getByTestId("ui-tooltip").filter({ hasText: "No note yet · click to create" }),
  ).toBeVisible();
  await missing.click();
  // N8, FR-NOTES-25: the category first, in the picker's popup; a click picks one.
  const step = p2.locator('[data-testid="notes-picker"][data-step="category"]');
  await expect(step.getByTestId("notes-category-pick")).toHaveCount(8);
  await step.locator('[data-testid="notes-category-pick"][data-category="location"]').click();
  await expect(p2Win.getByTestId("notes-title")).toHaveText("Lost tomb");
  await expect(p2Win.getByTestId("notes-category")).toHaveAttribute("data-category", "location");
  // r1: an empty note says how to link.
  await expect(p2Win.locator(".cm-placeholder")).toContainText("Type @ to link a note");
  await expandGroups(p1Win);
  await expect(
    p1Win.locator('[data-testid="notes-list-item"][data-category="location"]', {
      hasText: "Lost tomb",
    }),
  ).toHaveCount(1);
  await expect(p1Win.locator('[data-testid="notes-link"][data-title="Lost tomb"]')).toHaveAttribute(
    "data-missing",
    "false",
  );

  // A chip click follows it (the caret stays where it was).
  await p1Win.locator('[data-testid="notes-link"][data-title="Duke Varen"]').click();
  await expect(p1Win.getByTestId("notes-title")).toHaveText("Duke Varen");
  // FR-NOTES-09 r1: a long-press on touch shows the chip's raw text to edit.
  const theLedger = p1Win.locator('[data-testid="notes-link"][data-title="Burnt Ledger"]');
  await theLedger.dispatchEvent("pointerdown", {
    pointerType: "touch",
    button: 0,
    isPrimary: true,
  });
  await p1.waitForTimeout(700);
  // (The chip is gone by now: the finger lifts on the raw text.)
  await expect(theLedger).toHaveCount(0);
  await expect(p1Win.locator(".cm-line").first()).toContainText("[[Burnt Ledger|the ledger]]");
  await expect(p1Win.getByTestId("notes-title")).toHaveText("Duke Varen"); // not followed

  // FR-NOTES-13, -23: Burnt Ledger's "2d6" has a die; a click rolls, the log reads "Note".
  const ledger = await openNote(p1, "Burnt Ledger");
  const log = await openWindow(dm, "dice.log");
  const die = ledger.locator('[data-testid="notes-die"][data-value="2d6"]');
  const box = await die.boundingBox();
  expect(box && box.width >= 24 && box.height >= 24).toBe(true); // r1: the kit's minimum target
  await die.hover();
  await expect(p1.getByTestId("ui-tooltip").filter({ hasText: "Roll 2d6" })).toBeVisible();
  await die.click();
  const entry = log.getByTestId("dice-log-entry").last();
  await expect(entry).toContainText("Note");
  await expect(entry).not.toContainText("Burnt Ledger");

  // r1: a note nothing links to says so.
  const fresh = await openWindow(dm, "notes.main");
  await newNote(dm, fresh, "Empty page");
  await expect(fresh.getByTestId("notes-backlinks")).toContainText("No links here yet");
});

test("N6 FR-NOTES-11 the DM renames a note while P1 types in a note linking to it: the chip follows for all three, solid, and P1's typing stays", async ({
  browser,
}) => {
  const { dm, p1, p2 } = await setup(browser);
  const p1Win = await openNote(p1, "Burnt Ledger");
  const p2Win = await openNote(p2, "Burnt Ledger");
  const chip = (w: Locator, title: string) =>
    w.locator(`[data-testid="notes-link"][data-title="${title}"]`);
  await expect(chip(p1Win, "Quest log")).toHaveCount(1);

  // The DM opens Quest log and renames it while P1 is typing in Burnt Ledger.
  const dmWin = await openNote(dm, "Quest log");
  await dmWin.getByTestId("notes-rename").click();
  await dm.getByTestId("notes-title-input").fill("Quest journal");
  await p1Win
    .locator(".cm-line")
    .first()
    .click({ position: { x: 3, y: 6 } });
  await p1.keyboard.press("End");
  const typing = p1.keyboard.type(" [typed during the rename]", { delay: 40 });
  await dm.getByTestId("notes-title-save").click();
  await typing;
  await expect(p1Win.getByTestId("notes-status")).toHaveText("Saved");

  for (const w of [p1Win, p2Win]) {
    await expect(chip(w, "Quest journal")).toHaveCount(1);
    await expect(chip(w, "Quest journal")).toHaveAttribute("data-missing", "false");
    await expect(chip(w, "Quest journal")).toHaveText("Quest journal");
    await expect(chip(w, "Quest log")).toHaveCount(0);
  }
  const dmLedger = await openNote(dm, "Burnt Ledger");
  await expect(chip(dmLedger, "Quest journal")).toHaveAttribute("data-missing", "false");
  for (const w of [p1Win, p2Win, dmLedger]) {
    await expect.poll(() => docText(w), { timeout: 5_000 }).toContain("[[Quest journal]]");
    expect(await docText(w)).toContain("[typed during the rename]");
  }
  expect(await docText(p2Win)).toBe(await docText(p1Win));

  // Back to "Quest log" (other specs on this bundle's server use it): the chips follow back.
  await expandGroups(dmWin);
  await dmWin.getByTestId("notes-list-item").filter({ hasText: "Quest journal" }).first().click();
  await dmWin.getByTestId("notes-rename").click();
  await dm.getByTestId("notes-title-input").fill("Quest log");
  await dm.getByTestId("notes-title-save").click();
  await expect(chip(p1Win, "Quest log")).toHaveAttribute("data-missing", "false");
});

test("polish r1 (Gilt & Stone and Simple Dark): unfocused preview, redo, list text holds still, bullets, tags on top, bin names whole, snippets without markers, short words", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser); // Gilt & Stone (a fresh browser's theme)
  await p1.goto(link("Player 1"));
  await live(p1);
  const p2 = await rolePage(browser);
  await storedTheme(p2, "default"); // Simple Dark
  await p2.goto(link("Player 2"));
  await live(p2);

  // An opened note isn't focused: its line-1 heading shows styled, no "#".
  const p2Win = await openNote(p2, "Quest log");
  await expect(p2Win.locator(".cm-line.cm-note-h1")).toHaveText(/^Quest log/);
  const bulletSize = await p2Win
    .locator(".cm-note-bullet-dot")
    .first()
    .evaluate((el) => ({
      bullet: Number.parseFloat(getComputedStyle(el).fontSize),
      line: Number.parseFloat(getComputedStyle(el.closest(".cm-line") as Element).fontSize),
    }));
  expect(bulletSize.bullet).toBeGreaterThan(bulletSize.line); // the kit's readable size

  // A list item's text holds still when the caret enters its line.
  const chipX = async () =>
    (await p2Win.locator('[data-testid="notes-link"]').first().boundingBox())?.x;
  const away = await chipX();
  await p2Win
    .locator(".cm-line.cm-note-li")
    .first()
    .click({ position: { x: 40, y: 6 } });
  await expect(p2Win.locator(".cm-line.cm-note-li .cm-note-bullet")).toHaveCount(0);
  const here = await chipX();
  expect(Math.abs((here ?? 0) - (away ?? 0))).toBeLessThanOrEqual(1);

  // Redo: Ctrl+Shift+Z as well as Ctrl+Y.
  const p1Win = await openNote(p1, "Quest log");
  await p1Win
    .locator(".cm-line")
    .last()
    .click({ position: { x: 3, y: 6 } });
  await p1.keyboard.press("End");
  await p1.keyboard.type(" R1", { delay: 20 });
  await p1.keyboard.press("Control+z");
  await expect.poll(() => docText(p1Win)).not.toContain(" R1");
  await p1.keyboard.press("Control+Shift+Z");
  await expect.poll(() => docText(p1Win)).toContain(" R1");

  // A typist's name tag is on top of the text in both themes.
  await p1.keyboard.type(" ledger keeper, line of fire", { delay: 15 });
  // On top: the tag's left padding, as painted, is the tag's own background (nothing over it).
  const onTop = async (page: Page, win: Locator) => {
    const tag = win.locator(".cm-remote-caret[data-tag=shown] .cm-remote-tag").first();
    const box = await tag.boundingBox();
    if (!box) return false;
    const bg = await tag.evaluate((el) => getComputedStyle(el).backgroundColor);
    const [r, g, b] = (bg.match(/\d+/g) ?? []).map(Number) as [number, number, number];
    const shot = await page.screenshot({
      clip: {
        x: Math.ceil(box.x) + 1,
        y: Math.ceil(box.y) + 2,
        width: 2,
        height: Math.max(2, Math.floor(box.height) - 4),
      },
    });
    const { data, info } = await sharp(shot).raw().toBuffer({ resolveWithObject: true });
    let same = 0;
    for (let i = 0; i < data.length; i += info.channels)
      if (
        Math.abs((data[i] ?? 0) - r) +
          Math.abs((data[i + 1] ?? 0) - g) +
          Math.abs((data[i + 2] ?? 0) - b) <
        40
      )
        same++;
    return same >= (data.length / info.channels) * 0.8;
  };
  // The tag shows for 2 s after its typist's last change (FR-NOTES-15). Under CI load those 2 s can
  // pass before a look, so with no tag shown the typist types one more character.
  const tagOnTop = async (page: Page, win: Locator, typist: Page) => {
    if ((await win.locator(".cm-remote-caret[data-tag=shown]").count()) === 0) {
      await typist.keyboard.type(".");
      return false;
    }
    return onTop(page, win);
  };
  await expect.poll(() => tagOnTop(p2, p2Win, p1), { timeout: 10_000 }).toBe(true);
  await p2.keyboard.press("End");
  await p2.keyboard.type(" P2", { delay: 15 });
  await expect.poll(() => tagOnTop(p1, p1Win, p2), { timeout: 10_000 }).toBe(true);
  await expect(p1Win.getByTestId("notes-status")).toHaveText("Saved");

  // The bin row names who deleted a note in full, in both themes, at the default width.
  await newNote(p1, p1Win, "Throwaway");
  await p1Win.getByTestId("notes-delete").click();
  await p1.getByTestId("notes-delete-confirm").click();
  for (const [page, w] of [
    [p1, p1Win],
    [p2, p2Win],
  ] as const) {
    // Wide: the fold-out under the list; narrow (< 520 px): the Recycle bin button and dialog.
    const wide = await w.getByTestId("notes-bin").isVisible();
    if (wide) await w.getByTestId("notes-bin").click();
    else await w.getByTestId("notes-bin-narrow").click();
    const scope = wide ? w : page.getByTestId("notes-bin-dialog");
    const who = scope
      .getByTestId("notes-bin-who")
      .filter({ hasText: "Deleted by Player 1" })
      .first();
    await expect(who).toBeVisible();
    expect(await who.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    if (!wide) await page.keyboard.press("Escape");
  }

  // Search: snippets without markdown markers; the last word as a prefix; short words whole.
  const dmWin = await openWindow(dm, "notes.main");
  const box = dmWin.getByTestId("notes-search");
  const results = dmWin.getByTestId("notes-search-result");
  await box.fill("recover");
  const snippet = results
    .filter({ hasText: "Quest log" })
    .first()
    .getByTestId("notes-search-snippet");
  await expect(snippet).toContainText("Recover the");
  expect(await snippet.textContent()).not.toMatch(/(^|\s)[#*-]\s|\*\*/);
  await box.fill("ledger k");
  await expect(results.filter({ hasText: "Quest log" })).toHaveCount(1);
  await box.fill("line of");
  await expect(results.filter({ hasText: "Quest log" })).toHaveCount(1);
});

test("N8 FR-NOTES-25 FR-NOTES-26 FR-NOTES-27 FR-NOTES-28 FR-NOTES-30 categories: @ Create note asks one in the popup; + New needs one; groups update live for everyone; a change moves the note for all; Recent is last edited first and remembered; Linked from holds its height", async ({
  browser,
}) => {
  const { dm, p1, p2 } = await setup(browser);
  const group = (w: Locator, c: string) =>
    w.locator(`[data-testid="notes-group"][data-category="${c}"]`);
  const count = async (w: Locator, c: string) =>
    (await group(w, c).count()) === 0 ? 0 : Number(await group(w, c).getAttribute("data-count"));
  const row = (w: Locator, title: string) =>
    w.getByTestId("notes-list-item").filter({ hasText: title });

  // A fresh browser: Session starts open, every other fold-out closed.
  const dmWin = await openWindow(dm, "notes.main");
  await expect(group(dmWin, "item")).toBeVisible();
  for (const c of ["npc", "quest", "item"])
    await expect(group(dmWin, c)).toHaveAttribute("data-state", "closed");
  const npcBefore = await count(dmWin, "npc");

  // P1: "@Tidewatch" → Create note → the categories in the same popup, Session highlighted;
  // the keyboard picks Faction (Enter takes the highlighted one).
  const p1Win = await openNote(p1, "Burnt Ledger");
  await newLine(p1, p1Win);
  // r2: in the title list, the pointer highlights a row as the arrows do.
  await p1.keyboard.type("Ask @", { delay: 20 });
  const titleRows = p1.getByTestId("notes-picker-item");
  await titleRows.nth(1).hover();
  await expect(titleRows.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(titleRows.first()).toHaveAttribute("aria-selected", "false");
  await p1.mouse.move(0, 0);
  await p1.keyboard.type("Tidewatch", { delay: 20 });
  await expect(p1.getByTestId("notes-picker-create")).toHaveText('Create note "Tidewatch"');
  await p1.keyboard.press("Enter");
  const step = p1.locator('[data-testid="notes-picker"][data-step="category"]');
  const picks = step.getByTestId("notes-category-pick");
  await expect(picks).toHaveText([
    "Session",
    "NPC",
    "Quest",
    "Location",
    "Item",
    "Faction",
    "Player",
    "Other",
  ]);
  await expect(picks.first()).toHaveAttribute("aria-selected", "true");
  // r1: all eight are on screen, nothing over them (not clipped by the editor's box).
  await allReachable(picks);
  await expect(p1Win.locator('[data-testid="notes-picker"]')).toHaveCount(0); // in the page layer
  await p1.keyboard.press("ArrowUp"); // wraps to Other
  await p1.keyboard.press("ArrowUp"); // Player
  await p1.keyboard.press("ArrowUp"); // Faction
  await expect(step.locator('[data-category="faction"]')).toHaveAttribute("aria-selected", "true");
  // r2: the pointer moves the highlight too, and the arrows carry on from it.
  await step.locator('[data-category="player"]').hover();
  await expect(step.locator('[data-category="player"]')).toHaveAttribute("aria-selected", "true");
  await expect(step.locator('[data-category="faction"]')).toHaveAttribute("aria-selected", "false");
  await p1.keyboard.press("ArrowUp");
  await expect(step.locator('[data-category="faction"]')).toHaveAttribute("aria-selected", "true");
  await p1.keyboard.press("Enter");
  await expect(step).toHaveCount(0);
  const chip = p1Win.locator('[data-testid="notes-link"][data-title="Tidewatch"]');
  await expect(chip).toHaveAttribute("data-missing", "false");
  // The DM sees the new Faction fold-out live (closed: it was never opened in this browser).
  await expect(group(dmWin, "faction")).toBeVisible();
  await group(dmWin, "faction").click();
  await expect(row(dmWin, "Tidewatch")).toHaveAttribute("data-category", "faction");

  // P2: + New needs a title and a category; none is picked first.
  const p2Win = await openWindow(p2, "notes.main");
  await p2Win.getByTestId("notes-new").click();
  const dialog = p2.getByTestId("notes-new-dialog");
  const title = dialog.getByTestId("notes-new-title");
  await title.fill("Harbour master");
  const pick = (c: string) =>
    dialog.locator(`[data-testid="notes-category-pick"][data-category="${c}"]`);
  await expect(
    dialog.locator('[data-testid="notes-category-pick"][aria-checked="true"]'),
  ).toHaveCount(0);
  const save = dialog.getByTestId("notes-title-save");
  await expect(save).toBeDisabled();
  // r1: Enter with no category says so.
  await title.press("Enter");
  await expect(dialog.getByTestId("notes-category-hint")).toHaveText("Pick a category");
  // r1: one Tab stop for the eight; the arrows move between them; Space picks.
  await title.press("Tab");
  await expect(pick("session")).toBeFocused();
  await p2.keyboard.press("ArrowRight");
  await expect(pick("npc")).toBeFocused();
  const look = (l: Locator) =>
    l.evaluate((el) => {
      const cs = getComputedStyle(el);
      return `${cs.color}|${cs.backgroundColor}|${cs.backgroundImage}`;
    });
  const offLook = await look(pick("npc"));
  const createOff = await look(save);
  await p2.keyboard.press("Space");
  await expect(pick("npc")).toHaveAttribute("aria-checked", "true");
  await expect(dialog.getByTestId("notes-category-hint")).toHaveCount(0);
  await p2.keyboard.press("Tab");
  await expect(dialog.locator('[data-testid="notes-category-pick"]:focus')).toHaveCount(0);
  // r1: picked and enabled read differently from not picked and disabled (Gilt here).
  await expect(save).toBeEnabled();
  await p2.mouse.move(0, 0);
  expect(await look(pick("npc"))).not.toBe(offLook);
  expect(await look(save)).not.toBe(createOff);
  await save.click();
  await expect(p2Win.getByTestId("notes-title")).toHaveText("Harbour master");
  await expect(p2Win.getByTestId("notes-category")).toHaveAttribute("data-category", "npc");

  // The DM's NPC count moves live; opened, the group lists it A–Z with who and when.
  await expect.poll(() => count(dmWin, "npc")).toBe(npcBefore + 1);
  await group(dmWin, "npc").click();
  await expect(row(dmWin, "Harbour master")).toContainText("Player 2 ·");
  const npcTitles = await dmWin
    .locator('[data-testid="notes-list-item"][data-category="npc"] span:first-child')
    .allTextContents();
  expect(npcTitles).toEqual(
    [...npcTitles].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
  );

  // The DM moves it to Location from the editor's header: it moves for P1 and P2.
  await row(dmWin, "Harbour master").click();
  await expect(dmWin.getByTestId("notes-title")).toHaveText("Harbour master");
  await dmWin.getByTestId("notes-category").click();
  await dm.locator('[data-testid="notes-category-option"][data-category="location"]').click();
  // r1: the DM's own list follows the open note into Location, unfolded, the row selected.
  await expect(group(dmWin, "location")).toHaveAttribute("data-state", "open");
  await expect(row(dmWin, "Harbour master")).toHaveAttribute("aria-current", "true");
  await expect(row(dmWin, "Harbour master")).toBeInViewport();
  await expect(p2Win.getByTestId("notes-category")).toHaveAttribute("data-category", "location");
  await expect.poll(() => count(p1Win, "npc")).toBe(npcBefore);
  await expandGroups(p1Win);
  await expect(row(p1Win, "Harbour master")).toHaveAttribute("data-category", "location");

  // Recent (P2): one list, last edited first, the category on each row; kept after a reload.
  await p2Win.getByTestId("notes-sort").click();
  await expect(p2Win.getByTestId("notes-sort")).toHaveAttribute("aria-pressed", "true");
  await expect(p2Win.getByTestId("notes-group")).toHaveCount(0);
  const first = p2Win.getByTestId("notes-list-item").first();
  await expect(first).toContainText("Harbour master");
  await expect(first).toContainText("Location · DM ·");
  await p2.reload();
  await live(p2);
  const again = await openWindow(p2, "notes.main");
  await expect(again.getByTestId("notes-sort")).toHaveAttribute("aria-pressed", "true");
  await expect(again.getByTestId("notes-list-item").first()).toContainText("Harbour master");

  // Linked from: titled with its count, four rows tall, the same height with no links.
  const box = (w: Locator) => w.getByTestId("notes-backlinks-list");
  await expect(p1Win.getByTestId("notes-backlinks")).toContainText("Linked from (");
  const withLinks = (await box(p1Win).boundingBox())?.height ?? 0;
  await expect(dmWin.getByTestId("notes-backlinks")).toContainText("No links here yet");
  const empty = (await box(dmWin).boundingBox())?.height ?? 0;
  expect(withLinks).toBeGreaterThanOrEqual(4 * 24);
  expect(Math.abs(withLinks - empty)).toBeLessThanOrEqual(1);
  // r1: the heading is the kit's section label; counts use lining figures (Gilt: no "(ı)").
  await expect(dmWin.getByTestId("notes-backlinks-title")).toHaveAttribute(
    "data-slot",
    "section-label",
  );
  for (const count of [
    group(dmWin, "item").locator('[data-slot="notes-count"]'),
    dmWin.getByTestId("notes-backlinks-title").locator('[data-slot="notes-count"]'),
  ])
    expect(await count.evaluate((el) => getComputedStyle(el).fontVariantNumeric)).toContain(
      "lining-nums",
    );

  // r1: down to the window's minimum the editor keeps ~3 lines; the box gives way first
  // (title + one row), and grows back to four rows when there is room.
  const editorBox = dmWin.getByTestId("notes-editor-box");
  await resizeTo(dm, dmWin, 320, 280);
  expect((await editorBox.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(66);
  const small = (await box(dmWin).boundingBox())?.height ?? 0;
  expect(small).toBeGreaterThanOrEqual(23);
  expect(small).toBeLessThan(4 * 24);
  await resizeTo(dm, dmWin, 760, 560);
  await expect
    .poll(async () => (await box(dmWin).boundingBox())?.height ?? 0)
    .toBeGreaterThanOrEqual(4 * 24);

  // r1: at 1280 × 720 the category step still shows all eight, reachable.
  await p1.setViewportSize({ width: 1280, height: 720 });
  await p1Win.locator(".cm-content").click();
  await p1.keyboard.press("Control+End");
  await p1.keyboard.type(" @Keelhaul", { delay: 20 });
  await expect(p1.getByTestId("notes-picker-create")).toHaveText('Create note "Keelhaul"');
  await p1.keyboard.press("Enter");
  await allReachable(picks);
  await p1.keyboard.press("ArrowUp"); // Other, the last: still in view
  await expect(step.locator('[data-category="other"]')).toBeInViewport({ ratio: 1 });
  // r2: hovering a category highlights it; Enter takes the hovered one.
  await step.locator('[data-category="location"]').hover();
  await expect(step.locator('[data-category="location"]')).toHaveAttribute("aria-selected", "true");
  await expect(step.locator('[data-category="other"]')).toHaveAttribute("aria-selected", "false");
  await p1.keyboard.press("Enter");
  await expect(step).toHaveCount(0);
  await expect(p1Win.locator('[data-testid="notes-link"][data-title="Keelhaul"]')).toHaveAttribute(
    "data-missing",
    "false",
  );
  await expect(
    dmWin.locator('[data-testid="notes-group"][data-category="location"]'),
  ).toHaveAttribute("data-count", /\d+/);
  await expandGroups(dmWin);
  await expect(
    dmWin.locator('[data-testid="notes-list-item"][data-category="location"]', {
      hasText: "Keelhaul",
    }),
  ).toHaveCount(1);
});

/** r1: each row fully on screen and the topmost element at its centre (nothing over it). */
async function allReachable(rows: Locator) {
  await expect(rows).toHaveCount(8);
  for (const r of await rows.all()) {
    await expect(r).toBeInViewport({ ratio: 1 });
    const hit = await r.evaluate((el) => {
      const b = el.getBoundingClientRect();
      const top = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      return top === el || el.contains(top);
    });
    expect(hit).toBe(true);
  }
}
