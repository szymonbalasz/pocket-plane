// e2e-bundle: rules-effects
// Full text, no squeezed columns (fix/sheet-full-text walkthrough, defect B): Mira's trigger names
// break only between words at the sheet's 320-px default and 280-px minimum, the badges and the
// edit / delete controls taking another line when there is no room, and the Effects tab never
// scrolls sideways. Then the same check on every sheet tab, with long names in every row kind.
// Classes per row: bun test (`character-sheet/full-text.test.ts`).
import { expect, type Locator, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { pickSheet } from "./support/sheet";
import { openWindow } from "./support/shell";
import { brokenWords, dmIntent, moveTo, pastTheEdge, resizeTo } from "./support/text-fit";

const tab = (sheet: Locator, value: string) =>
  sheet.locator(`[data-testid="charx-tab"][data-value="${value}"]`);

const fits = async (win: Locator, where: string) => {
  expect({ where, broken: await brokenWords(win), ...(await pastTheEdge(win)) }).toEqual({
    where,
    broken: [],
    past: [],
    scrolls: [],
  });
};

test("full text: a trigger's name breaks only between words at 320 and 280 px; badges and controls take another line; no sideways scroll", async ({
  browser,
}) => {
  const { secret, recordId } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1600, height: 900 });
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const win = await openWindow(dm, "char.sheet");
  await pickSheet(win, recordId("char-mira", "entity"));
  await tab(win, "section:mod.effects").click();
  const row = win.getByTestId("mod-trigger").filter({ hasText: "Searing Strike" });
  await expect(row).toBeVisible();
  const name = row.locator("span", { hasText: "Searing Strike" }).first();

  for (const w of [320, 280]) {
    await resizeTo(dm, win, w);
    await fits(win, `Searing Strike at ${w}`);
    // Short enough for one line once it isn't squeezed: "Seari / ng / Strike" read three.
    const lines = await name.evaluate(
      (e) => e.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(e).lineHeight),
    );
    expect(Math.round(lines)).toBe(1);
    const del = await row.getByTestId("mod-trigger-delete").boundingBox();
    const content = await win.getByTestId("charx-content").boundingBox();
    expect((del?.x ?? 0) + (del?.width ?? 0)).toBeLessThanOrEqual(
      (content?.x ?? 0) + (content?.width ?? 0),
    );
  }

  // A 40-character name (the walkthrough read about 7 lines at 320): whole, between words.
  const long = "Searing Strike of the Very Long Vow Oath";
  await row.getByTestId("mod-trigger-edit").click();
  const editor = dm.getByTestId("mod-trig-editor-dialog");
  await editor.getByTestId("mod-trig-editor-name").fill(long);
  await editor.getByTestId("mod-trig-editor-save").click();
  await expect(editor).toHaveCount(0);
  const named = win.getByTestId("mod-trigger").filter({ hasText: long });
  await expect(named).toBeVisible();
  await fits(win, "the long name at 280");
  await win.screenshot({ path: test.info().outputPath("triggers-280.png") });
  await resizeTo(dm, win, 320);
  await fits(win, "the long name at 320");
  await win.screenshot({ path: test.info().outputPath("triggers-320.png") });
});

test("full text: long names in every sheet row kind stay unbroken on every tab, 280 to 900 px", async ({
  browser,
}) => {
  const { secret, recordId } = e2eEnv();
  const mira = recordId("char-mira", "entity");
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1600, height: 900 });
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const put = (list: string, row: unknown) =>
    dmIntent(dm, secret, "char.putRow", { creatureId: mira, list, row });
  await put("features", {
    name: "Accursed Specter of the Very Long Patron Feature",
    source: "Warlock (Hexblade Patron Feature Text)",
    text: "Bonus action: curse one creature you can see.",
    usesMax: 2,
  });
  await put("attacks", {
    name: "Greatsword of the Long Name Indeed",
    toHit: 5,
    damage: "1d8+2",
    bonus: 1,
  });
  await put("spells", { name: "Overwhelming Thunderous Maelstrom of the Deep", level: 3 });
  await put("items", {
    name: "Bag of Holding of the Very Long Name",
    qty: 2,
    equipped: true,
    notes: "",
  });

  const win = await openWindow(dm, "char.sheet");
  await pickSheet(win, mira);
  await moveTo(dm, win, 250, 60);
  const tabs = await win
    .getByTestId("charx-tab")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-value") as string));
  for (const w of [280, 320, 460, 560, 680, 900]) {
    await resizeTo(dm, win, w);
    for (const key of tabs) {
      await tab(win, key).click();
      await fits(win, `${key} at ${w}`);
    }
  }
});
