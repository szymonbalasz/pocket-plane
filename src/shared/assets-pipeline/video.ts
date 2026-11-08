// Animated tokens (ANIM, ADR-0080): a video is an `image` asset whose stored original is the
// video; the DM's browser sends a still frame that makes the usual derivatives.
import { z } from "zod";

/** FR-ANIM-02: accepted videos, sniffed from content. */
export const VIDEO_MIMES = ["video/webm", "video/mp4"] as const;
export const VideoMime = z.enum(VIDEO_MIMES);
export type VideoMime = z.infer<typeof VideoMime>;

/** FR-ANIM-02 (DM 2026-11-08): ≤ 20 MB per video. */
export const VIDEO_MAX_BYTES = 20 * 1024 * 1024;
export const VIDEO_TOO_LARGE = "Video over 20 MB";

/** FR-ANIM-04: an image asset is animated iff its `mime` is a video's. */
export const isAnimatedMime = (mime: string): boolean => mime.startsWith("video/");

/** FR-ANIM-05: `GET /api/assets/:id/motion`, the video itself (the ID is the capability). */
export const motionPath = (id: string) => `/api/assets/${encodeURIComponent(id)}/motion`;

/** FR-ANIM-11: the Tooltip's format label. */
export const videoLabel = (mime: string): string => (mime === "video/mp4" ? "MP4" : "WebM");
