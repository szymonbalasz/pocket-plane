// e2e-bundle: image-search
// Image search and tags (ASSET §13.1 E2E, FR-ASSET-44–48; FR-MAP-86, -87): the token Image…
// picker focuses its search, "Gob el" leaves 2 items, the Tokens chip, Esc clears then closes, an
// upload there is tagged Tokens, selecting Elite Goblin sets the token's image; the inline New
// scene picker leaves focus on the name, tags an image and merges a tag through Manage tags. It
// edits tags, so it keeps its own bundle (seams S12). Matcher, chips, editor logic and each host's
// context: bun test (search.test.ts, picker.test.tsx, the hosts' *.test.tsx).
import path from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { konvaNodes } from "./support/konva";
import { openWindow } from "./support/shell";

const OGRE = path.join(
  import.meta.dirname,
  "..",
  "fixtures",
  "assets",
  "library",
  "upload-ogre.svg",
);

async function live(page: Page) {
  await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
}

const ids = (scope: Locator) =>
  scope
    .getByTestId("asset-picker-item")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-record-id")));

const chip = (scope: Locator, tag: string) =>
  scope.locator(`[data-testid="asset-picker-tag-chip"][data-tag="${tag}"]`);

/** A DM token whose centre isn't under a window: its id and centre. */
async function reachableToken(page: Page) {
  await expect.poll(async () => (await konvaNodes(page, "map-token")).length).toBeGreaterThan(0);
  for (const t of await konvaNodes(page, "map-token")) {
    const onCanvas = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.tagName === "CANVAS",
      [t.x, t.y] as const,
    );
    if (onCanvas) return t;
  }
  throw new Error("every token is under a window");
}

/** The token's art as drawn: the `src` of its Konva Image, if any. */
const tokenImageSrc = (page: Page, tokenId: string) =>
  page.evaluate((id) => {
    type KNode = { id(): string; findOne(s: string): { image(): HTMLImageElement } | undefined };
    const K = (window as unknown as { Konva?: { stages: { find(s: string): KNode[] }[] } }).Konva;
    const node = K?.stages.flatMap((s) => s.find(".map-token")).find((n) => n.id() === id);
    return node?.findOne("Image")?.image()?.src ?? null;
  }, tokenId);

test("FR-MAP-87 FR-ASSET-45 FR-ASSET-46 FR-ASSET-41 token Image…: search focused, Gob el → 2 items, Tokens chip, Esc clears then closes, upload tagged Tokens, Elite Goblin set on the token", async ({
  browser,
}) => {
  const { secret, recordId } = e2eEnv();
  const elite = recordId("image-tags", "asset", 0);
  const elder = recordId("image-tags", "asset", 1);
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1280, height: 720 });
  await loginDm(dm, secret);
  await live(dm);

  const token = await reachableToken(dm);
  const openPicker = async () => {
    await dm.mouse.click(token.x, token.y, { button: "right" });
    await dm.getByTestId("map-token-menu-image").click();
    const dialog = dm.getByRole("dialog", { name: "Token image" });
    await expect(dialog).toBeVisible();
    return dialog;
  };

  // IM1: focused on open, `data-context="token"`, every chip off but All.
  let dialog = await openPicker();
  const search = dialog.getByTestId("asset-picker-search");
  await expect(search).toBeFocused();
  await expect(dialog.getByTestId("asset-picker")).toHaveAttribute("data-context", "token");
  await expect(chip(dialog, "all")).toHaveAttribute("data-state", "on");
  const all = (await ids(dialog)).length;
  // ASSET §7: ≥ 2 grid rows visible at 1280 × 720 under the picker's four rows.
  const grid = dialog.getByRole("list", { name: "Images" });
  const gridBox = await grid.boundingBox();
  const gridBottom = (gridBox?.y ?? 0) + (gridBox?.height ?? 0) + 1;
  const boxes = await dialog
    .getByTestId("asset-picker-item")
    .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as DOMRect));
  const fullRows = new Set(
    boxes.filter((b) => b.bottom <= gridBottom).map((b) => Math.round(b.top)),
  );
  expect(fullRows.size).toBeGreaterThanOrEqual(2);

  // Typing filters on each keystroke: exactly Elite Goblin + Goblin Elder (newest first).
  await dm.keyboard.type("Gob el");
  await expect(dialog.getByTestId("asset-picker-item")).toHaveCount(2);
  expect(await ids(dialog)).toEqual([elder, elite]);
  // FR-ASSET-46: Tokens on → still both (AND with the search); one chip at a time.
  await chip(dialog, "tokens").click();
  await expect(chip(dialog, "tokens")).toHaveAttribute("data-state", "on");
  await expect(chip(dialog, "all")).toHaveAttribute("data-state", "off");
  await expect(dialog.getByTestId("asset-picker-item")).toHaveCount(2);
  // Maps + "Gob el" → no match in Maps; Search all images resets the chip.
  await chip(dialog, "maps").click();
  await expect(dialog.getByTestId("asset-picker-no-match")).toContainText(
    "No images match Gob el in Maps",
  );
  await dialog.getByTestId("asset-picker-search-all").click();
  await expect(chip(dialog, "all")).toHaveAttribute("data-state", "on");
  await expect(dialog.getByTestId("asset-picker-item")).toHaveCount(2);
  // Esc clears a non-empty search (the Dialog stays), a second Esc closes it.
  await search.focus();
  await dm.keyboard.press("Escape");
  await expect(search).toHaveValue("");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("asset-picker-item")).toHaveCount(all);
  await dm.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // IM7: an upload in the token picker is tagged Tokens and selected; the Tokens count + 1.
  dialog = await openPicker();
  await expect(dialog.getByTestId("asset-picker-search")).toHaveValue("");
  const tokens = Number(/(\d+)$/.exec((await chip(dialog, "tokens").textContent()) ?? "")?.[1]);
  await dialog.getByTestId("asset-picker-file-input").setInputFiles(OGRE);
  const ogre = dialog.getByTestId("asset-picker-item").filter({ hasText: "upload-ogre" });
  await expect(ogre).toHaveAttribute("aria-pressed", "true");
  await expect(ogre).toHaveAttribute("data-tags", "tokens");
  await expect(chip(dialog, "tokens")).toContainText(String(tokens + 1));

  // Select Elite Goblin → the token draws it.
  await dialog.getByTestId("asset-picker-search").fill("gob el");
  await dialog.locator(`[data-testid="asset-picker-item"][data-record-id="${elite}"]`).click();
  await dialog.getByTestId("asset-picker-select").click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(() => tokenImageSrc(dm, token.id))
    .toContain(`/api/assets/${encodeURIComponent(elite)}/thumb`);
});

test("FR-MAP-86 FR-ASSET-47 New scene: the name keeps focus; add a tag, Rename merges it into Maps; built-ins have no Rename", async ({
  browser,
}) => {
  const { secret, recordId } = e2eEnv();
  const misc = recordId("image-tags", "asset", 23);
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1280, height: 720 });
  await loginDm(dm, secret);
  await live(dm);

  const scenes = await openWindow(dm, "map.scenes");
  await scenes.getByTestId("map-scene-new").click();
  const dialog = dm.getByRole("dialog", { name: "New scene" });
  await expect(dialog.getByTestId("map-scene-new-name")).toBeFocused();
  const picker = dialog.getByTestId("asset-picker");
  await expect(picker).toHaveAttribute("data-context", "map");

  // IM8: Misc Sketch (Untagged) → Add tag Dungeon (Enter).
  await picker.getByTestId("asset-picker-search").fill("misc");
  // Enter in the search never submits the New scene form.
  await picker.getByTestId("asset-picker-search").press("Enter");
  await expect(dialog.getByTestId("map-scene-new-error")).toHaveCount(0);
  const item = picker.locator(`[data-testid="asset-picker-item"][data-record-id="${misc}"]`);
  await item.click();
  const editor = picker.getByTestId("asset-tags-editor");
  await expect(editor).toHaveAttribute("data-record-id", misc);
  await editor.getByTestId("asset-tags-add").fill("Dungeon");
  await editor.getByTestId("asset-tags-add").press("Enter");
  await expect(editor.locator('[data-testid="asset-tags-chip"][data-tag="dungeon"]')).toBeVisible();
  await expect(chip(picker, "dungeon")).toContainText("1");
  await expect(item).toHaveAttribute("data-tags", "dungeon");

  // Manage → Rename Dungeon → "maps": a merge into the built-in Maps.
  await picker.getByTestId("asset-tags-manage").click();
  await expect(dm.locator('[data-testid="asset-tags-rename"][data-tag="tokens"]')).toHaveCount(0);
  await expect(dm.locator('[data-testid="asset-tags-delete"][data-tag="tokens"]')).toHaveCount(1);
  await dm.locator('[data-testid="asset-tags-rename"][data-tag="dungeon"]').click();
  const rename = dm.getByTestId("asset-tags-dialog");
  await rename.getByTestId("asset-tags-rename-to").fill("maps");
  await expect(rename.getByTestId("asset-tags-prompt")).toHaveText(
    "Merge Dungeon into Maps? 1 image",
  );
  await rename.getByTestId("asset-tags-confirm").click();
  await expect(rename).toHaveCount(0);
  await expect(chip(picker, "dungeon")).toHaveCount(0);
  await expect(item).toHaveAttribute("data-tags", "maps");
  // The Rename form sits in a portal: confirming it didn't submit New scene.
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("map-scene-new-error")).toHaveCount(0);
});
