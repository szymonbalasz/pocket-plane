// The DM client's uploader (FR-ASSET-27), mounted once at the client root: REST upload with the
// DM secret; a 401 resets the secret (back to login), as every DM REST call.
import { uploadAsset } from "@ui/features/assets-pipeline/upload";
import { type AttachUploader, AttachUploaderProvider } from "@ui/features/assets-pipeline/uploader";
import type { ReactNode } from "react";
import { useDmSession } from "../campaign-management/session";

const dmUploader: AttachUploader = {
  async upload(file, opts, h) {
    const secret = useDmSession.getState().secret;
    if (!secret) return { kind: "unauthorized" };
    const r = await uploadAsset(file, secret, opts, h);
    if (r.kind === "unauthorized") useDmSession.getState().setSecret(null);
    return r;
  },
};

export function DmAttachUploaderProvider({ children }: { children: ReactNode }) {
  return <AttachUploaderProvider value={dmUploader}>{children}</AttachUploaderProvider>;
}
