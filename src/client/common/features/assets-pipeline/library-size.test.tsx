// BL-49 unit (client): the picker header's image count and the large-library warning from
// ASSET_LIBRARY_WARN_AT on, over fake `asset` records (no real images); players never see it.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { sampleLibrary } from "@shared/assets-pipeline/sample-library";
import type { AssetRecord } from "@shared/assets-pipeline/schemas";
import {
  ASSET_LIBRARY_WARN_AT,
  AssetPicker,
  libraryCountText,
  librarySizeWarning,
} from "./AssetPicker";
import { ImageAttach } from "./attach/ImageAttach";
import { renderInSync, stubImageForFile, tagOf } from "./picker-test-kit";

stubImageForFile();
const base = sampleLibrary()[0] as AssetRecord;

/** `n` fake listed images, unique ids, one shared shape. */
const library = (n: number): AssetRecord[] =>
  Array.from({ length: n }, (_, i) => ({
    ...base,
    id: `b${String(i).padStart(21, "0")}`,
    seq: i + 1,
    name: `img-${i}`,
  }));

const WARNING = "asset-library-size-warning";

describe("library size warning (BL-49)", () => {
  test("BL-49 threshold: 1,999 images show the count and no warning; 2,000 show the warning", () => {
    expect(ASSET_LIBRARY_WARN_AT).toBe(2000);
    const below = renderInSync(<AssetPicker onSelect={() => {}} />, library(1999));
    expect(below).toMatch(/data-testid="asset-library-count"[^>]*>1,999 images</);
    expect(tagOf(below, WARNING)).toBe("");

    const at = renderInSync(<AssetPicker onSelect={() => {}} />, library(2000));
    expect(at).toMatch(/data-testid="asset-library-count"[^>]*>2,000 images</);
    expect(tagOf(at, WARNING)).toContain('role="alert"');
    expect(at).toContain(
      "Large library: 2,000 images. Above about 2,500 the live game slows down; delete images you no longer use.",
    );
  });

  test("BL-49 texts: count singular / plural; warning null below the threshold", () => {
    expect([libraryCountText(0), libraryCountText(1), libraryCountText(31)]).toEqual([
      "0 images",
      "1 image",
      "31 images",
    ]);
    expect(librarySizeWarning(ASSET_LIBRARY_WARN_AT - 1)).toBeNull();
    expect(librarySizeWarning(2580)).toStartWith("Large library: 2,580 images.");
  });

  test("BL-49 players see nothing: the player client never imports the picker", () => {
    // A player store has no `asset` records and no uploader: the attach control renders nothing.
    const player = renderInSync(
      <ImageAttach max={10} count={0} owner="party-editor" onAdd={() => {}} />,
      [],
      {
        uploader: null,
        records: {},
      },
    );
    expect(player).not.toContain(WARNING);
    const root = path.join(import.meta.dir, "../../../player");
    const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter((f) =>
      /\.tsx?$/.test(f),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = readFileSync(path.join(root, f), "utf8");
      expect(src).not.toContain("AssetPicker");
      expect(src).not.toContain(WARNING);
    }
  });
});
