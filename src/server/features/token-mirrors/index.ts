// Token mirrors (MIR). The hook line lives in scenes-map's `token-hooks.ts`, the sight line in fog's
// `rederive.ts`.
import type { Feature } from "../../services";
import { createMirror, deleteMirror, moveMirror, setMirrorMode } from "./commands";
import { mirrorRecordTypes } from "./records";

export const tokenMirrors: Feature = {
  name: "token-mirrors",
  register(r) {
    for (const t of mirrorRecordTypes) r.recordType(t);
    r.command(createMirror, { intent: true });
    r.command(moveMirror, { intent: true });
    r.command(setMirrorMode, { intent: true });
    r.command(deleteMirror, { intent: true });
  },
};
