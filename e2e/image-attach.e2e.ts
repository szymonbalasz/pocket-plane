// e2e-bundle: party-s5
// Image attach control (ASSET §13 E2E, PARTY §13.1 S5-2 / S5-3): Upload, drop and synthetic paste
// in the handout editor (attachments stay out of the library; the library's poster dropped again
// keeps its id; text wins over an image unless it is a single URL; refusals; caller-side dedupe);
// the control inside a Dialog portal; From library. Queue rules, pre-checks, the paste matrix:
// bun test (attach.test.tsx). Real OS clipboard: the P1 walkthrough.
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { dropOn, pasteInto, pngBytes } from "./support/clipboard";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow, shellWindow } from "./support/shell";

const POSTER = path.join(
  import.meta.dirname,
  "..",
  "fixtures",
  "assets",
  "handouts",
  "wanted-poster.svg",
);
const posterFile = {
  name: "wanted-poster.svg",
  type: "image/svg+xml",
  text: readFileSync(POSTER, "utf8"),
};

async function live(page: Page) {
  await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
}

const stripIds = (editor: Locator) =>
  editor
    .getByTestId("party-editor-image")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-record-id")));

test("FR-PARTY-39 FR-ASSET-20 FR-ASSET-21 FR-ASSET-22 FR-ASSET-23 paste adds an image: upload, drop and paste in the handout editor", async ({
  browser,
}) => {
  const { secret, recordId } = e2eEnv();
  const poster = recordId("handout-images", "asset", 1);
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);

  const board = await openWindow(dm, "party.board");
  await board.getByTestId("party-handout-create").click();
  const win = shellWindow(dm, "party.handout");
  const editor = win.getByTestId("party-editor");
  const control = editor.locator('[data-testid="asset-attach"][data-owner="party-editor"]');
  await editor.getByTestId("party-editor-title").fill("Smuggler's Route");

  // S5-2 Upload a PNG → strip 1; an attachment: From library doesn't list it.
  const red = await pngBytes(editor, "#c33");
  const chooser = dm.waitForEvent("filechooser");
  await control.getByTestId("asset-attach-upload").click();
  await (await chooser).setFiles({ name: "step-1.png", mimeType: "image/png", buffer: red });
  await expect(editor.getByTestId("party-editor-image")).toHaveCount(1);
  await expect(control.getByTestId("asset-attach-progress")).toHaveCount(0);
  const [pngId] = await stripIds(editor);
  expect(pngId).toMatch(/^[A-Za-z0-9_-]{22}$/);
  await control.getByTestId("asset-attach-library").click();
  const picker = dm.getByRole("dialog", { name: "Add an image" });
  await expect(picker.locator(`[data-record-id="${poster}"]`)).toBeVisible();
  await expect(picker.locator(`[data-record-id="${pngId}"]`)).toHaveCount(0);
  await dm.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);

  // Drop the library's poster file → same bytes, same id: strip 2.
  expect(await dropOn(editor, [posterFile])).toBe(true);
  await expect(editor.getByTestId("party-editor-image")).toHaveCount(2);
  expect(await stripIds(editor)).toEqual([pngId, poster]);

  // S5-3 Paste a PNG into the body → strip 3, text unchanged.
  const body = editor.getByTestId("party-editor-body");
  expect(await pasteInto(body, [{ png: "#2a6" }])).toBe(true);
  await expect(editor.getByTestId("party-editor-image")).toHaveCount(3);
  await expect(body).toHaveValue("");

  // Text + image on the clipboard → the text is pasted, no upload.
  expect(await pasteInto(body, [{ png: "#36c" }], "Meet at the docks")).toBe(false);
  await expect(body).toHaveValue("Meet at the docks");
  // A single URL as the text (some browsers' "Copy image") → the image wins, the URL isn't pasted.
  const title = editor.getByTestId("party-editor-title");
  expect(await pasteInto(title, [{ png: "#f80" }], " https://example.com/poster.png ")).toBe(true);
  await expect(editor.getByTestId("party-editor-image")).toHaveCount(4);
  await expect(title).toHaveValue("Smuggler's Route");

  // Drop a .txt → "Unsupported file type", nothing added.
  await dropOn(editor, [{ name: "notes.txt", type: "text/plain", text: "hello" }]);
  await expect(control.getByTestId("asset-attach-error-line")).toHaveText([
    "notes.txt: Unsupported file type",
  ]);
  // The step-1 bytes again → same id; the editor skips it (dedupe is the caller's).
  expect(await pasteInto(body, [{ png: "#c33" }])).toBe(true);
  await expect(editor.getByTestId("party-editor-duplicate")).toHaveText("Already in this handout");
  await expect(editor.getByTestId("party-editor-image")).toHaveCount(4);
  await expect(body).toHaveValue("Meet at the docks");

  await editor.getByTestId("party-editor-save").click();
  const view = win.getByTestId("party-handout-view");
  await expect(view.getByTestId("party-handout-title")).toHaveText("Smuggler's Route");
  await expect(view.getByTestId("party-handout-image")).toHaveCount(4);
});

test("FR-ASSET-20 in a Dialog: paste and drop into targets inside the portal; FR-ASSET-23 From library → onAdd", async ({
  browser,
}) => {
  const { secret, recordId } = e2eEnv();
  const poster = recordId("handout-images", "asset", 1);
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const win = await openWindow(dm, "asset.test");

  await win.getByTestId("asset-test-dialog-open").click();
  const dialog = dm.getByTestId("asset-test-dialog");
  await expect(dialog).toBeVisible();
  const text = dialog.getByTestId("asset-test-dialog-text");
  expect(await pasteInto(text, [{ png: "#909" }])).toBe(true);
  await expect(dialog.getByTestId("asset-test-attached-id")).toHaveCount(1);
  await expect(text).toHaveValue("");
  expect(await dropOn(dialog.getByTestId("asset-test-dialog-drop"), [{ png: "#099" }])).toBe(true);
  await expect(dialog.getByTestId("asset-test-attached-id")).toHaveCount(2);
  await dm.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // The window's own control: From library → Add returns the listed asset's id.
  const control = win.locator('[data-testid="asset-attach"][data-owner="asset-test"]');
  await control.getByTestId("asset-attach-library").click();
  const picker = dm.getByRole("dialog", { name: "Add an image" });
  await picker.locator(`[data-testid="asset-picker-item"][data-record-id="${poster}"]`).click();
  await picker.getByTestId("asset-picker-select").click();
  await expect(picker).toHaveCount(0);
  await expect(win.getByTestId("asset-test-attached-id")).toHaveAttribute("data-record-id", poster);
});

test("FR-ASSET-27 no player upload: the player client renders no attach control", async ({
  browser,
}) => {
  const { link } = e2eEnv();
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);
  const board = await openWindow(p1, "party.board");
  await expect(board.getByTestId("party-handout-row").first()).toBeVisible();
  await expect(p1.getByTestId("asset-attach")).toHaveCount(0);
  await expect(p1.getByTestId("asset-picker")).toHaveCount(0);
});
