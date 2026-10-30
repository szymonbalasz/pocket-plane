// e2e-bundle: scenes-list
// The Scenes window's list (MAP §7): drag to arrange and into folders (FR-MAP-116), nested folders
// (FR-MAP-02), the right-click menus (FR-MAP-118), the Show button and its confirm (FR-MAP-119), the
// delete confirm (FR-MAP-120). The drag test runs first: it asserts the bundle's order.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { confirmShow, sceneRow } from "./support/scenes";
import { openWindow, shellWindow } from "./support/shell";

const names = (win: Locator) => win.locator('[data-testid$="-row-name"]').allTextContents();

/** The folder's `li`, by its own row: a parent's `li` holds its subfolders' names too. */
const folderRow = (win: Locator, name: string) =>
  win
    .locator("[data-list-row]")
    .filter({ has: win.page().getByTestId("map-folder-row-name").getByText(name, { exact: true }) })
    .locator("xpath=ancestor::li[1]");

/** A row's own line (a folder's row also holds its contents). */
const head = (row: Locator) => row.locator("[data-list-row]").first();

async function dragStart(page: Page, from: Locator) {
  const a = await head(from).boundingBox();
  if (!a) throw new Error("No row to drag");
  await page.mouse.move(a.x + 40, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + 40, a.y + a.height / 2 + 6, { steps: 3 });
}

async function dragOver(page: Page, to: Locator, where: "before" | "into" | "after") {
  const b = await head(to).boundingBox();
  if (!b) throw new Error("No row to drop on");
  const y = where === "into" ? b.height / 2 : where === "before" ? 2 : b.height - 2;
  await page.mouse.move(b.x + 40, b.y + y, { steps: 6 });
}

async function dragTo(page: Page, from: Locator, to: Locator, where: "before" | "into" | "after") {
  await dragStart(page, from);
  await dragOver(page, to, where);
  await page.mouse.up();
}

async function dmScenes(browser: Parameters<typeof rolePage>[0]) {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  return { dm, scenes: await openWindow(dm, "map.scenes") };
}

test("FR-MAP-116 drag arranges the list and moves entries between folders; the order survives a reload", async ({
  browser,
}) => {
  const { dm, scenes } = await dmScenes(browser);
  const viewedAtStart = await dm.getByTestId("map-canvas").getAttribute("data-scene-id");
  const act1 = folderRow(scenes, "Act 1");
  await expect.poll(() => names(scenes)).toEqual(["Act 1", "Goblin Ambush", "Town", "Cellar"]);

  // Reorder within a folder, with the drop line showing the spot on the way.
  await dragStart(dm, sceneRow(dm, "Town"));
  await dragOver(dm, sceneRow(dm, "Goblin Ambush"), "before");
  const line = scenes.getByTestId("map-list-drop");
  await expect(line).toBeVisible();
  await expect(line).toHaveAttribute("data-parent", /.+/);
  await dm.mouse.up();
  await expect(line).toHaveCount(0);
  await expect.poll(() => names(scenes)).toEqual(["Act 1", "Town", "Goblin Ambush", "Cellar"]);

  // Into a folder: the folder lights up, no line.
  await dragStart(dm, sceneRow(dm, "Cellar"));
  await dragOver(dm, act1, "into");
  await expect(head(act1)).toHaveAttribute("data-drop-into", "true");
  await expect(line).toHaveCount(0);
  await dm.mouse.up();
  await expect.poll(() => names(scenes)).toEqual(["Act 1", "Town", "Goblin Ambush", "Cellar"]);
  await expect(act1.getByTestId("map-scene-row-name").getByText("Cellar")).toBeVisible();

  // Back out, above the folder: scenes and folders share one order.
  await dragTo(dm, sceneRow(dm, "Cellar"), act1, "before");
  await expect.poll(() => names(scenes)).toEqual(["Cellar", "Act 1", "Town", "Goblin Ambush"]);
  await expect(act1.getByTestId("map-scene-row-name").getByText("Cellar")).toHaveCount(0);

  // Esc drops the drag: nothing moves, no line left.
  await dragStart(dm, sceneRow(dm, "Cellar"));
  await dragOver(dm, sceneRow(dm, "Town"), "after");
  await expect(line).toBeVisible();
  await dm.keyboard.press("Escape");
  await expect(line).toHaveCount(0);
  await dm.mouse.up();
  expect(await names(scenes)).toEqual(["Cellar", "Act 1", "Town", "Goblin Ambush"]);

  // A drag is never a click: the viewed scene never changed.
  expect(await dm.getByTestId("map-canvas").getAttribute("data-scene-id")).toBe(viewedAtStart);
  // A plain click still views.
  await sceneRow(dm, "Cellar").locator("button").first().click();
  await expect(sceneRow(dm, "Cellar").locator("button").first()).toHaveAttribute(
    "aria-current",
    "true",
  );

  // The remembered window comes back by itself on reload.
  await dm.reload();
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const after = shellWindow(dm, "map.scenes");
  await expect(after).toBeVisible();
  await expect.poll(() => names(after)).toEqual(["Cellar", "Act 1", "Town", "Goblin Ambush"]);
  await dm.context().close();
});

test("FR-MAP-02 / FR-MAP-118 right-click builds nested folders; a drag can't put a folder inside itself", async ({
  browser,
}) => {
  const { dm, scenes } = await dmScenes(browser);
  const act1 = folderRow(scenes, "Act 1");
  const newFolder = async (name: string) => {
    await dm.getByTestId("map-folder-new-form-name").fill(name);
    await dm.getByTestId("map-folder-new-form-submit").click();
  };

  // Right-click a folder: its own menu; New subfolder nests.
  await head(act1).click({ button: "right" });
  const menu = dm.getByRole("menu");
  await expect(menu).toHaveAttribute("data-slot", "dropdown-menu-content");
  await expect(menu.getByTestId("map-folder-menu-rename")).toBeVisible();
  await menu.getByTestId("map-folder-menu-new-folder").click();
  await newFolder("Chapter 1");
  const chapter = folderRow(scenes, "Chapter 1");
  await expect(act1.getByTestId("map-folder-row")).toHaveCount(1);
  await expect(chapter).toBeVisible();

  // Right-click a scene: the row's actions, same as "…"; Move to… offers the subfolder.
  await head(sceneRow(dm, "Town")).click({ button: "right" });
  await expect(menu.getByTestId("map-scene-menu-rename")).toBeVisible();
  await expect(menu.getByTestId("map-scene-menu-delete")).toBeVisible();
  await menu.getByTestId("map-scene-menu-move").click();
  const chapterId = await chapter.getAttribute("data-record-id");
  await dm.locator(`[data-testid="map-scene-move-target"][data-record-id="${chapterId}"]`).click();
  await expect(chapter.getByTestId("map-scene-row-name").getByText("Town")).toBeVisible();

  // Right-click the list's empty space: New… at the root.
  const list = scenes.getByTestId("map-scene-list");
  const box = await list.boundingBox();
  if (!box) throw new Error("No list");
  await dm.mouse.click(box.x + box.width / 2, box.y + box.height - 3, { button: "right" });
  await menu.getByTestId("map-list-menu-new-folder").click();
  await newFolder("Loot rooms");
  await expect(folderRow(scenes, "Loot rooms")).toBeVisible();
  await expect(act1.getByText("Loot rooms")).toHaveCount(0);

  // A folder over its own subfolder: never a target, and it stays where it is.
  const before = await names(scenes);
  await dragStart(dm, act1);
  await dragOver(dm, chapter, "into");
  await expect(head(chapter)).not.toHaveAttribute("data-drop-into", "true");
  await dm.keyboard.press("Escape");
  await dm.mouse.up();
  expect(await names(scenes)).toEqual(before);

  // Deleting the subfolder moves its contents up one level, not to the root.
  await head(chapter).click({ button: "right" });
  await menu.getByTestId("map-folder-menu-delete").click();
  await expect(chapter).toHaveCount(0);
  await expect(act1.getByTestId("map-scene-row-name").getByText("Town")).toBeVisible();
  await dm.context().close();
});

test("FR-MAP-119 Show is a real button that asks first; players follow only on yes and see no list data", async ({
  browser,
}) => {
  const { link, recordId } = e2eEnv();
  const { dm, scenes } = await dmScenes(browser);
  const player = await rolePage(browser);
  const frames: string[] = [];
  player.on("websocket", (ws) => ws.on("framereceived", (f) => frames.push(String(f.payload))));
  await player.goto(link("Player 1"));
  const canvas = player.getByTestId("map-canvas");
  await expect(canvas).toHaveAttribute("data-scene-id", recordId("town", "scene"));

  // In plain sight with no hover, and shaped like a button.
  await dm.mouse.move(0, 0);
  const show = sceneRow(dm, "Goblin Ambush").getByTestId("map-scene-show");
  await expect(show).toBeVisible();
  await expect(show).toHaveText("Show");
  await expect(show).toHaveAttribute("data-variant", "secondary");

  // Cancel: nothing changes.
  await show.click();
  const dialog = dm.getByTestId("map-scene-show-dialog");
  await expect(dialog).toContainText("Show Goblin Ambush to players?");
  await expect(dm.getByTestId("map-scene-show-summary")).toContainText(
    "switch from Town to this scene",
  );
  await dm.getByTestId("map-scene-show-cancel").click();
  await expect(dialog).toHaveCount(0);
  await expect(sceneRow(dm, "Goblin Ambush").getByTestId("map-scene-live")).toHaveCount(0);
  await expect(canvas).toHaveAttribute("data-scene-id", recordId("town", "scene"));

  // Yes: live, and the player follows.
  await show.click();
  await confirmShow(dm);
  await expect(sceneRow(dm, "Goblin Ambush").getByTestId("map-scene-live")).toBeVisible();
  await expect(canvas).toHaveAttribute("data-scene-id", recordId("battlemap", "scene"));

  // Right-click reaches the same confirm.
  await head(sceneRow(dm, "Town")).click({ button: "right" });
  await dm.getByRole("menu").getByTestId("map-scene-menu-show").click();
  await expect(dialog).toContainText("Show Town to players?");
  await confirmShow(dm);
  await expect(canvas).toHaveAttribute("data-scene-id", recordId("town", "scene"));

  // Moving the live scene tells players nothing about the list.
  const seen = frames.length;
  await dragTo(dm, sceneRow(dm, "Town"), sceneRow(dm, "Goblin Ambush"), "after");
  await expect(scenes.getByTestId("map-scene-row")).toHaveCount(3);
  await dm.waitForTimeout(300);
  const leaked = frames.slice(seen).join("\n");
  expect(leaked).not.toContain('"position"');
  expect(leaked).not.toContain('"folderId"');
  expect(leaked).not.toContain("Act 1");

  await player.context().close();
  await dm.context().close();
});

test("FR-MAP-120 a scene delete asks first; Cancel keeps it", async ({ browser }) => {
  const { dm, scenes } = await dmScenes(browser);
  await sceneRow(dm, "Cellar").getByTestId("map-scene-menu").click();
  await dm.getByTestId("map-scene-menu-duplicate").click();
  const copy = sceneRow(dm, "Cellar (copy)");
  await expect(copy).toBeVisible();

  await head(copy).click({ button: "right" });
  await dm.getByRole("menu").getByTestId("map-scene-menu-delete").click();
  const dialog = dm.getByTestId("map-scene-delete-dialog");
  await expect(dialog).toContainText("Delete Cellar (copy)?");
  await expect(dialog).toContainText("can't be undone");
  // A delete starts on Cancel: Enter keeps the scene.
  await expect(dm.getByTestId("map-scene-delete-cancel")).toBeFocused();
  await dm.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(copy).toBeVisible();

  await copy.getByTestId("map-scene-menu").click();
  await dm.getByTestId("map-scene-menu-delete").click();
  await dm.getByTestId("map-scene-delete-confirm").click();
  await expect(copy).toHaveCount(0);
  await expect(sceneRow(dm, "Cellar")).toBeVisible();
  await expect(scenes.getByTestId("map-scene-row").first()).toBeVisible();
  await dm.context().close();
});
