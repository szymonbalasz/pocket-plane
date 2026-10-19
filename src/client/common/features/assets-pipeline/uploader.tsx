// Uploader context (FR-ASSET-27): uploads go through whatever the client root provides. Only the
// DM client provides one (DM secret, 401 → secret reset); without it the attach control renders
// nothing and the picker's Upload stays disabled, so players never get an upload path.
import { createContext, useContext } from "react";
import type { UploadHandlers, UploadOptions, UploadOutcome } from "./upload";

export interface AttachUploader {
  upload(file: File, opts: UploadOptions, h: UploadHandlers): Promise<UploadOutcome>;
}

const UploaderContext = createContext<AttachUploader | null>(null);

export const AttachUploaderProvider = UploaderContext.Provider;

/** The client's uploader, or null (player client). */
export const useAttachUploader = () => useContext(UploaderContext);
