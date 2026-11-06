// e2e-bundle: notes-token
// Token notes (FR-NOTES-29, N9), DM + player-1 + player-2 in their own contexts: player-1
// right-clicks their character token Mira → Create note → the note opens for them and shows in the
// DM's list; player-2 right-clicks the NPC also named Mira → Open note → the same note. The DM's
// Create on the hidden Shadow asks first ("Players will see this note's title"). r1: on touch
// (real touch input), a ~500 ms hold on a token opens the same menu for a player and the DM; a
// touch drag moves the token and opens none.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { NOTES_TOKENS } from "../fixtures/units/linked-notes/notes-tokens";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { konvaNodes, tokenNode } from "./support/konva";
import { mapPoint } from "./support/map";
import { openWindow, shellWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

/** Town's character token Mira (player-1's), from the `town` fixture. */
const PC_MIRA = { col: 5, row: 5 };

async function open(browser: Parameters<typeof rolePage>[0], url?: string) {
  const page = await rolePage(browser);
  // Room for Notes' wide layout (category fold-outs) beside the open windows.
  await page.setViewportSize({ width: 1920, height: 1080 });
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

/** N8: a category fold-out of the list; its `data-count` (absent = 0, empty groups don't show). */
const group = (win: Locator, category: string) =>
  win.locator(`[data-testid="notes-group"][data-category="${category}"]`);
const groupCount = async (win: Locator, category: string) =>
  (await group(win, category).count()) === 0
    ? 0
    : Number(await group(win, category).getAttribute("data-count"));

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

  // The DM sees it in their list, in the Player fold-out (a character token's note).
  const dmNotes = await openWindow(dm, "notes.main");
  await expect.poll(() => groupCount(dmNotes, "player")).toBe(1);
  await group(dmNotes, "player").click();
  await expect(group(dmNotes, "player")).toHaveAttribute("data-state", "open");
  await expect(dmNotes.getByTestId("notes-list-item").filter({ hasText: /^Mira/ })).toHaveCount(1);
  const npcBefore = await groupCount(dmNotes, "npc");

  // player-2: the NPC also named Mira → Open note → the same note.
  const openLine = await tokenNoteLine(p2, NOTES_TOKENS.npcMira, NOTES_TOKENS.npcMira.name);
  await expect(openLine).toHaveText("Open note");
  await openLine.click();
  await expect(notesTitle(p2)).toHaveText("Mira");
  // Still one note, still Player (the NPC token didn't make a second one).
  await expect(dmNotes.getByTestId("notes-list-item").filter({ hasText: /^Mira/ })).toHaveCount(1);
  expect(await groupCount(dmNotes, "player")).toBe(1);
  expect(await groupCount(dmNotes, "npc")).toBe(npcBefore);

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
  await dm.waitForTimeout(300);
  expect(await groupCount(dmNotes, "npc")).toBe(npcBefore);
  // …then Create: the note opens for the DM, and players see its title.
  await (await tokenNoteLine(dm, shadow, shadow.name)).click();
  await dm.getByTestId("notes-token-note-confirm").click();
  await expect(notesTitle(dm)).toHaveText(shadow.name);
  // An NPC note (no character): the NPC fold-out, for the players too.
  await expect.poll(() => groupCount(dmNotes, "npc")).toBe(npcBefore + 1);
  const p2Notes = shellWindow(p2, "notes.main");
  await expect.poll(() => groupCount(p2Notes, "npc")).toBe(npcBefore + 1);

  for (const page of [dm, p1, p2]) await page.context().close();
});

/** A touch-screen page (real touch input: Chromium turns it into `pointerType: "touch"`). */
async function touchPage(browser: Parameters<typeof rolePage>[0], url?: string) {
  const ctx = await browser.newContext({ hasTouch: true, viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  if (url) await page.goto(url);
  const cdp = await ctx.newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", x = 0, y = 0) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x: Math.round(x), y: Math.round(y) }],
    });
  return { page, touch };
}

/** The token's id at a cell, from its label (the labels sit under their tokens). */
async function tokenAt(page: Page, name: string, cell: { col: number; row: number }) {
  const at = await mapPoint(page, cell.col, cell.row);
  const labels = (await konvaNodes(page, "map-token-label")).filter((l) => l.text === name);
  labels.sort((a, b) => Math.abs(a.x - at.x) - Math.abs(b.x - at.x));
  const id = labels[0]?.id;
  if (!id) throw new Error(`no token ${name}`);
  return { id, at };
}

test("FR-NOTES-29 r1 touch: a long-press on a token opens its menu (player and DM), with no drag; a touch drag moves the token and opens no menu", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();
  const p1 = await touchPage(browser, link("Player 1"));
  const dm = await touchPage(browser);
  await loginDm(dm.page, secret);
  await live(p1.page);
  await live(dm.page);
  await tokensDrawn(p1.page, 2);
  await tokensDrawn(dm.page, 3);

  // player-1 holds their Mira still for 700 ms: the menu, and Mira stays on her cell.
  const mira = await tokenAt(p1.page, "Mira", PC_MIRA);
  const before = await tokenNode(p1.page, mira.id);
  await p1.touch("touchStart", mira.at.x, mira.at.y);
  await p1.touch("touchMove", mira.at.x + 3, mira.at.y + 2); // a still finger wobbles
  await p1.page.waitForTimeout(700);
  const menu = p1.page.getByTestId("map-token-menu");
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute("data-record-id", mira.id);
  await p1.touch("touchMove", mira.at.x + 90, mira.at.y); // moving after the menu opened: no drag
  await p1.touch("touchEnd");
  await expect(menu).toBeVisible();
  // (The first test may have made the Mira note already.)
  await expect(menu.getByTestId("notes-token-note")).toHaveText(/(Create|Open) note/);
  await p1.page.waitForTimeout(300);
  expect(await tokenNode(p1.page, mira.id)).toMatchObject({ x: before?.x, y: before?.y });
  await p1.page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  // A short tap opens nothing.
  await p1.touch("touchStart", mira.at.x, mira.at.y);
  await p1.page.waitForTimeout(150);
  await p1.touch("touchEnd");
  await p1.page.waitForTimeout(700);
  await expect(menu).toHaveCount(0);

  // A touch drag two cells right moves Mira and opens no menu.
  const cell = (await mapPoint(p1.page, PC_MIRA.col + 1, PC_MIRA.row)).x - mira.at.x;
  await p1.touch("touchStart", mira.at.x, mira.at.y);
  for (let i = 1; i <= 8; i++) {
    await p1.touch("touchMove", mira.at.x + (2 * cell * i) / 8, mira.at.y);
    await p1.page.waitForTimeout(40);
  }
  await p1.page.waitForTimeout(700); // held after the drag: still no menu
  await p1.touch("touchEnd");
  await expect
    .poll(async () => ((await tokenNode(p1.page, mira.id))?.x ?? 0) - (before?.x ?? 0))
    .toBeGreaterThan(cell * 1.5);
  await expect(menu).toHaveCount(0);

  // The DM's long-press on the hidden Shadow: the DM menu, its note line.
  const shadow = await tokenAt(dm.page, NOTES_TOKENS.hidden.name, NOTES_TOKENS.hidden);
  await dm.touch("touchStart", shadow.at.x, shadow.at.y);
  await dm.page.waitForTimeout(700);
  await dm.touch("touchEnd");
  const dmMenu = dm.page.getByTestId("map-token-menu");
  await expect(dmMenu).toBeVisible();
  await expect(dmMenu).toHaveAttribute("data-record-id", shadow.id);
  await expect(dmMenu.getByTestId("notes-token-note")).toHaveText(/(Create|Open) note/);

  for (const page of [p1.page, dm.page]) await page.context().close();
});
