// e2e-bundle: notes-token
// Token notes (FR-NOTES-29, N9), DM + player-1 + player-2 in their own contexts: player-1
// right-clicks their character token Mira → Create note → the note opens for them and shows in the
// DM's list; player-2 right-clicks the NPC also named Mira → Open note → the same note. The DM's
// Create on the hidden Shadow asks first ("Players will see this note's title").
import { expect, type Page, test } from "@playwright/test";
import { NOTES_TOKENS } from "../fixtures/units/linked-notes/notes-tokens";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { konvaNodes } from "./support/konva";
import { mapPoint } from "./support/map";
import { openWindow, shellWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

/** Town's character token Mira (player-1's), from the `town` fixture. */
const PC_MIRA = { col: 5, row: 5 };

async function open(browser: Parameters<typeof rolePage>[0], url?: string) {
  const page = await rolePage(browser);
  await page.setViewportSize({ width: 1440, height: 900 });
  if (url) await page.goto(url);
  return page;
}

/** Waits until the map draws `n` token labels (the DM sees the hidden one too). */
const tokensDrawn = (page: Page, n: number) =>
  expect.poll(async () => (await konvaNodes(page, "map-token-label")).length).toBe(n);

/** Right-clicks the token on `cell`; returns the menu's note line once the menu shows. */
async function tokenNoteLine(page: Page, cell: { col: number; row: number }, name: string) {
  const at = await mapPoint(page, cell.col, cell.row);
  await page.mouse.click(at.x, at.y, { button: "right" });
  const menu = page.getByTestId("map-token-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByTestId("map-token-menu-label")).toHaveText(name);
  const line = menu.getByTestId("notes-token-note");
  await expect(line).toHaveAttribute(
    "data-record-id",
    (await menu.getAttribute("data-record-id")) ?? "",
  );
  return line;
}

const notesTitle = (page: Page) => shellWindow(page, "notes.main").getByTestId("notes-title");

test("FR-NOTES-29 token notes: a player creates Mira's note from her token, the other player opens it from a same-named NPC, the DM is asked first on a hidden token (DM + player-1 + player-2)", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();
  const dm = await open(browser);
  await loginDm(dm, secret);
  const p1 = await open(browser, link("Player 1"));
  const p2 = await open(browser, link("Player 2"));
  await live(dm);
  await live(p1);
  await live(p2);
  await tokensDrawn(dm, 3);
  await tokensDrawn(p1, 2);
  await tokensDrawn(p2, 2);

  // player-1: their character token → Create note → the Mira note opens for them.
  const create = await tokenNoteLine(p1, PC_MIRA, "Mira");
  await expect(create).toHaveText("Create note");
  await create.click();
  await expect(p1.getByTestId("map-token-menu")).toHaveCount(0);
  await expect(notesTitle(p1)).toHaveText("Mira");

  // The DM sees it in their list.
  const dmNotes = await openWindow(dm, "notes.main");
  await expect(dmNotes.getByTestId("notes-list-item").filter({ hasText: /^Mira/ })).toHaveCount(1);

  // player-2: the NPC also named Mira → Open note → the same note.
  const openLine = await tokenNoteLine(p2, NOTES_TOKENS.npcMira, NOTES_TOKENS.npcMira.name);
  await expect(openLine).toHaveText("Open note");
  await openLine.click();
  await expect(notesTitle(p2)).toHaveText("Mira");
  await expect(dmNotes.getByTestId("notes-list-item").filter({ hasText: /^Mira/ })).toHaveCount(1);

  // The DM's own menu has the line too: Open note on Mira.
  await expect(await tokenNoteLine(dm, PC_MIRA, "Mira")).toHaveText("Open note");
  await dm.keyboard.press("Escape");
  await expect(dm.getByTestId("map-token-menu")).toHaveCount(0);

  // The DM on the hidden Shadow: Create asks first; Cancel creates nothing.
  const shadow = NOTES_TOKENS.hidden;
  const hiddenLine = await tokenNoteLine(dm, shadow, shadow.name);
  await expect(hiddenLine).toHaveText("Create note");
  await hiddenLine.click();
  const ask = dm.getByTestId("notes-token-note-dialog");
  await expect(ask).toBeVisible();
  await expect(dm.getByTestId("notes-token-note-warning")).toHaveText(
    "Players will see this note's title.",
  );
  await dm.getByTestId("notes-token-note-cancel").click();
  await expect(ask).toHaveCount(0);
  await expect(dmNotes.getByTestId("notes-list-item").filter({ hasText: /^Shadow/ })).toHaveCount(
    0,
  );
  // …then Create: the note opens for the DM, and players see its title.
  await (await tokenNoteLine(dm, shadow, shadow.name)).click();
  await dm.getByTestId("notes-token-note-confirm").click();
  await expect(notesTitle(dm)).toHaveText(shadow.name);
  const p2Notes = shellWindow(p2, "notes.main");
  await expect(p2Notes.getByTestId("notes-list-item").filter({ hasText: /^Shadow/ })).toHaveCount(
    1,
  );

  for (const page of [dm, p1, p2]) await page.context().close();
});
