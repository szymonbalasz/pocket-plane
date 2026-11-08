// Animated tokens, DM upload (ANIM §13): which pickers take videos, the size refusal, the poster
// in the body, the 413 text, and the tile Tooltip.
import { describe, expect, test } from "bun:test";
import type { AssetRecord } from "@shared/assets-pipeline/schemas";
import { VIDEO_MAX_BYTES } from "@shared/assets-pipeline/video";
import { tileTip } from "./AssetPicker";
import { uploadAsset, uploadBody, uploadErrorMessage } from "./upload";
import {
  isVideoFile,
  isWebmFile,
  takesVideo,
  VIDEO_ONLY_TOKENS,
  videoSizeError,
} from "./video-upload";

const file = (name: string, type: string, size = 10) => ({ name, type, size });

describe("FR-ANIM-08 / -09 picker contexts", () => {
  test("FR-ANIM-08 token and portrait pickers take videos; every other context and none refuse", () => {
    expect(takesVideo("token")).toBe(true);
    expect(takesVideo("portrait")).toBe(true);
    for (const c of ["map", "prop", "handout", "compendium", "compendium-item"] as const) {
      expect(takesVideo(c)).toBe(false);
    }
    expect(takesVideo(undefined)).toBe(false);
  });

  test("FR-ANIM-08 a video by type, or by extension when the type is empty; WebM spotted for the note", () => {
    expect(isVideoFile(file("a.webm", "video/webm"))).toBe(true);
    expect(isVideoFile(file("a.mp4", "video/mp4"))).toBe(true);
    expect(isVideoFile(file("a.webm", ""))).toBe(true);
    expect(isVideoFile(file("a.png", "image/png"))).toBe(false);
    expect(isWebmFile(file("a.webm", "video/webm"))).toBe(true);
    expect(isWebmFile(file("a.mp4", "video/mp4"))).toBe(false);
  });

  test("FR-ANIM-08 over 20 MB refused before reading", () => {
    expect(videoSizeError({ size: VIDEO_MAX_BYTES })).toBeNull();
    expect(videoSizeError({ size: VIDEO_MAX_BYTES + 1 })).toBe("Video over 20 MB");
  });

  test("FR-ANIM-09 a video without its still frame is refused before anything is sent", async () => {
    const r = await uploadAsset(
      new File([new Uint8Array([1])], "w.webm", { type: "video/webm" }),
      "secret",
      { listed: true },
      { onProgress: () => {}, onProcessing: () => {} },
    );
    expect(r).toEqual({ kind: "error", message: VIDEO_ONLY_TOKENS });
  });

  test("FR-ANIM-01 the poster rides in the body; 413 text from the server", () => {
    const poster = new Blob([new Uint8Array([1, 2])], { type: "image/png" });
    const body = uploadBody(new File([new Uint8Array([1])], "w.webm"), { listed: true, poster });
    expect(body.get("poster")).toBeInstanceOf(File);
    expect(
      uploadBody(new File([new Uint8Array([1])], "a.png"), { listed: true }).get("poster"),
    ).toBeNull();
    expect(uploadErrorMessage(413, { code: "invalid", message: "Video over 20 MB" })).toBe(
      "Video over 20 MB",
    );
    expect(uploadErrorMessage(413, null)).toBe("File over 100 MB");
  });
});

describe("FR-ANIM-11 library marks", () => {
  const base: AssetRecord = {
    id: "a",
    campaignId: "c",
    seq: 1,
    name: "Wisp",
    mime: "video/webm",
    bytes: 2 * 1024 * 1024,
    width: 128,
    height: 128,
    displayWidth: 128,
    displayHeight: 128,
    createdAt: "",
    tags: ["Tokens"],
  };
  test("FR-ANIM-11 the Tooltip names an animated image's format first; stills unchanged", () => {
    expect(tileTip(base)).toMatch(/^Animated · WebM · 128 × 128 · /);
    expect(tileTip({ ...base, mime: "video/mp4" })).toMatch(/^Animated · MP4 · /);
    expect(tileTip({ ...base, mime: "image/png" })).toMatch(/^128 × 128 · /);
  });
});
