// Animated tokens, DM upload (FR-ANIM-08–10): which pickers take videos, the still-frame grab,
// and the WebM note. The server sniffs the real format (FR-ANIM-02); this is the browser's half.
import type { ImageContext } from "@shared/assets-pipeline/tags";
import { VIDEO_MAX_BYTES, VIDEO_TOO_LARGE } from "@shared/assets-pipeline/video";

/** FR-ANIM-08: the pickers whose uploads may be videos (a portrait becomes token art, #120). */
export const VIDEO_CONTEXTS: ReadonlySet<ImageContext> = new Set(["token", "portrait"]);

export const VIDEO_ACCEPT = "video/webm,video/mp4";

export const VIDEO_ONLY_TOKENS = "Videos work as token art only";
export const VIDEO_UNREADABLE = "This browser can't play this video";
export const READING_VIDEO = "Reading video…";
/** FR-ANIM-10 (DM 2026-11-08). */
export const WEBM_NOTE = "Safari shows a black background behind see-through WebM.";

/** FR-ANIM-08: grab timeout. */
export const STILL_TIMEOUT_MS = 10_000;

export const takesVideo = (context: ImageContext | undefined) =>
  context !== undefined && VIDEO_CONTEXTS.has(context);

/** A video by the browser's type, or by extension when the type is empty (some drops). */
export function isVideoFile(file: Pick<File, "name" | "type">): boolean {
  if (file.type) return file.type.startsWith("video/");
  return /\.(webm|mp4|m4v|mov|mkv)$/i.test(file.name);
}

export const isWebmFile = (file: Pick<File, "name" | "type">) =>
  file.type === "video/webm" || (!file.type && /\.webm$/i.test(file.name));

/** FR-ANIM-02 / -08: refused before reading; null = fine. */
export const videoSizeError = (file: Pick<File, "size">) =>
  file.size > VIDEO_MAX_BYTES ? VIDEO_TOO_LARGE : null;

/**
 * FR-ANIM-08: the first frame of `file` as a PNG, drawn at the video's own size. Rejects (→
 * VIDEO_UNREADABLE) if the browser can't decode it within STILL_TIMEOUT_MS.
 */
export function grabStillFrame(file: Blob, timeoutMs = STILL_TIMEOUT_MS): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let done = false;
    const finish = (err: unknown, blob?: Blob) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      if (blob) resolve(blob);
      else reject(err instanceof Error ? err : new Error(VIDEO_UNREADABLE));
    };
    const timer = setTimeout(() => finish(new Error(VIDEO_UNREADABLE)), timeoutMs);
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.onerror = () => finish(new Error(VIDEO_UNREADABLE));
    video.onloadeddata = () => {
      video.onseeked = () => {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (!w || !h) return finish(new Error(VIDEO_UNREADABLE));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const g = canvas.getContext("2d");
        if (!g) return finish(new Error(VIDEO_UNREADABLE));
        g.drawImage(video, 0, 0, w, h);
        canvas.toBlob((b) => finish(new Error(VIDEO_UNREADABLE), b ?? undefined), "image/png");
      };
      video.currentTime = 0;
    };
    video.src = url;
  });
}
