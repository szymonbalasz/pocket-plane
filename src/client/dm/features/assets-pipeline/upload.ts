// DM upload over REST with progress (FR-ASSET-17). XHR because fetch has no upload progress.
import { type AssetRecord, UploadResponse } from "@shared/assets-pipeline/schemas";
import { RestError } from "@shared/protocol/codes";

export type UploadOutcome =
  | { kind: "ok"; outcome: "created" | "existing"; asset: AssetRecord }
  | { kind: "unauthorized" }
  | { kind: "error"; message: string };

/** Inline error text naming the cause (ASSET §7). */
export function uploadErrorMessage(status: number, body: unknown): string {
  const parsed = RestError.safeParse(body);
  if (status === 413) return "File over 25 MB";
  if (status === 415) return "Unsupported file type";
  if (status === 422) return parsed.success ? parsed.data.message : "Image over 50 megapixels";
  return "Upload failed, try again";
}

export function outcomeOf(status: number, body: unknown): UploadOutcome {
  if (status === 401) return { kind: "unauthorized" };
  if (status === 200 || status === 201) {
    const r = UploadResponse.safeParse(body);
    if (r.success) {
      return { kind: "ok", outcome: status === 201 ? "created" : "existing", asset: r.data.asset };
    }
  }
  return { kind: "error", message: uploadErrorMessage(status, body) };
}

export interface UploadHandlers {
  /** 0–100 while the body is sent. */
  onProgress(pct: number): void;
  /** Body sent; the server is processing. */
  onProcessing(): void;
}

export function uploadAsset(file: File, secret: string, h: UploadHandlers): Promise<UploadOutcome> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/assets");
    xhr.setRequestHeader("Authorization", `Bearer ${secret}`);
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) h.onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.upload.onload = () => h.onProcessing();
    xhr.onload = () => resolve(outcomeOf(xhr.status, xhr.response));
    xhr.onerror = () => resolve({ kind: "error", message: "Upload failed, try again" });
    xhr.onabort = xhr.onerror;
    const body = new FormData();
    body.append("file", file);
    xhr.send(body);
  });
}
