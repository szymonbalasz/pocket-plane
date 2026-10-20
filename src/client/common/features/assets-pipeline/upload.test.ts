import { describe, expect, test } from "bun:test";
import type { AssetRecord } from "@shared/assets-pipeline/schemas";
import { outcomeOf, uploadErrorMessage } from "./upload";

const asset: AssetRecord = {
  id: "A".repeat(22),
  campaignId: "c",
  seq: 1,
  name: "town",
  mime: "image/png",
  bytes: 10,
  width: 2,
  height: 2,
  displayWidth: 2,
  displayHeight: 2,
  createdAt: "2026-01-01T00:00:00.000Z",
  tags: [],
};

describe("picker upload outcomes (FR-ASSET-17)", () => {
  test("FR-ASSET-17 201 created / 200 existing", () => {
    expect(outcomeOf(201, { asset })).toEqual({ kind: "ok", outcome: "created", asset });
    expect(outcomeOf(200, { asset })).toEqual({ kind: "ok", outcome: "existing", asset });
  });

  test("FR-ASSET-17 413 / 415 / 422 / other → inline error naming the cause", () => {
    expect(uploadErrorMessage(413, null)).toBe("File over 25 MB");
    expect(uploadErrorMessage(415, { code: "invalid", message: "x" })).toBe(
      "Unsupported file type",
    );
    expect(uploadErrorMessage(422, { code: "invalid", message: "Image over 50 megapixels" })).toBe(
      "Image over 50 megapixels",
    );
    expect(uploadErrorMessage(422, null)).toBe("Image over 50 megapixels");
    expect(uploadErrorMessage(500, null)).toBe("Upload failed, try again");
    expect(uploadErrorMessage(409, null)).toBe("Upload failed, try again");
    expect(outcomeOf(401, null)).toEqual({ kind: "unauthorized" });
    expect(outcomeOf(200, { nope: 1 })).toEqual({
      kind: "error",
      message: "Upload failed, try again",
    });
  });
});
