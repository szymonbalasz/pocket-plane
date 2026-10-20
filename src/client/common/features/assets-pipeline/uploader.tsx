// Uploader context (FR-ASSET-27): uploads go through whatever the client root provides. Only the
// DM client provides one (DM secret, 401 → secret reset); without it the attach control renders
// nothing and the picker's Upload stays disabled, so players never get an upload path.
import type { ImageContext } from "@shared/assets-pipeline/tags";
import { createContext, useContext } from "react";
import { toast } from "sonner";
import {
  contextTags,
  droppedTagMessage,
  type UploadHandlers,
  type UploadOptions,
  type UploadOutcome,
} from "./upload";

export interface AttachUploader {
  upload(file: File, opts: UploadOptions, h: UploadHandlers): Promise<UploadOutcome>;
}

const UploaderContext = createContext<AttachUploader | null>(null);

export const AttachUploaderProvider = UploaderContext.Provider;

/** The client's uploader, or null (player client). */
export const useAttachUploader = () => useContext(UploaderContext);

/** FR-ASSET-41: one Toast per tag the server dropped from an upload (the upload is kept). */
export function toastDroppedTags(r: UploadOutcome): void {
  if (r.kind !== "ok") return;
  for (const d of r.droppedTags ?? []) toast(droppedTagMessage(d));
}

/**
 * FR-ASSET-41, -48: `uploader.upload` sending the context tag of the host as of each send (a host
 * may change its context while open, FR-CMP-55), toasting tags the server dropped.
 */
export function withContextTags(
  uploader: AttachUploader,
  context: () => ImageContext | undefined,
): AttachUploader["upload"] {
  return async (file, opts, h) => {
    const tags = contextTags(context());
    const r = await uploader.upload(file, tags ? { ...opts, tags } : opts, h);
    toastDroppedTags(r);
    return r;
  };
}
