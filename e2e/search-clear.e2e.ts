// e2e-bundle: compendium
// FR-KIT-108: the search fields' clear ×: Creatures, Compendium, Rules, the encounter lookup and
// the palette. No × while empty; a click empties the field, undoes the filter and keeps the focus.
// The Add target field: combat-tracker.e2e.ts. 5etools' books: cmpx-5etools.e2e.ts. Images:
// image-search.e2e.ts.
import { expect, type Locator, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

/** No × while empty; × with text; a click empties the field and focuses it. */
async function clears(field: Locator, clear: Locator, text: string) {
  await expect(clear).toHaveCount(0);
  await field.fill(text);
  await expect(clear).toBeVisible();
  await clear.click();
  await expect(field).toHaveValue("");
  await expect(field).toBeFocused();
  await expect(clear).toHaveCount(0);
}

test("FR-KIT-108 search fields clear with the ×", async ({ browser }) => {
  const { secret, recordId } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

  // Creatures: the list comes back in full.
  const creatures = await openWindow(dm, "ent.creatures");
  const rows = creatures.getByTestId("ent-list-row");
  await expect(rows.first()).toBeVisible();
  const all = await rows.count();
  const search = creatures.getByTestId("ent-list-search");
  const clear = creatures.getByTestId("ent-list-search-clear");
  await search.fill("no such creature");
  await expect(rows).toHaveCount(0);
  await clear.click();
  await expect(rows).toHaveCount(all);
  await clears(search, clear, "gob");

  const compendium = await openWindow(dm, "cmp.compendium");
  await clears(
    compendium.getByTestId("cmp-search"),
    compendium.getByTestId("cmp-search-clear"),
    "fire",
  );

  const rules = await openWindow(dm, "cmp.rules");
  await clears(
    rules.getByTestId("cmp-rules-search"),
    rules.getByTestId("cmp-rules-search-clear"),
    "grapple",
  );

  // The encounter lookup: the suggestions go with the text and come back on typing.
  const enc = await openWindow(dm, "cbt.encounters");
  await enc
    .locator(
      `[data-testid="cbt-enc-row"][data-record-id="${recordId("encounter-1", "encounter")}"]`,
    )
    .click();
  const lookup = enc.getByTestId("cbt-lookup-input");
  const lookupClear = enc.getByTestId("cbt-lookup-input-clear");
  await lookup.fill("og");
  await expect(dm.getByTestId("cbt-lookup-option").first()).toBeVisible();
  await lookupClear.click();
  await expect(dm.getByTestId("cbt-lookup-option")).toHaveCount(0);
  await clears(lookup, lookupClear, "gob");
  await lookup.fill("og");
  await expect(dm.getByTestId("cbt-lookup-option").first()).toBeVisible();
  await lookup.press("Escape");

  // The palette stays open.
  await dm.getByTestId("map-canvas").focus();
  await dm.keyboard.press("Control+k");
  await expect(dm.getByTestId("ui-palette")).toBeVisible();
  await clears(dm.getByTestId("ui-palette-input"), dm.getByTestId("ui-palette-input-clear"), "gob");
  await expect(dm.getByTestId("ui-palette")).toBeVisible();
});
