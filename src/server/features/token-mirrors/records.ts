// Record type `token-mirror` (MIR §9): windowed for the DM like the other scene rows (ADR-0041);
// players get the active scene's only, through the scene gate.
import { TOKEN_MIRROR_TYPE, TokenMirrorRecord } from "@shared/token-mirrors/schemas";
import { defineRecordType } from "../../ws/records";
import { campaignMirrors } from "./rows";
import { dmMirrorRecord, mirrorVisibility, redactMirror } from "./visibility";

export const mirrorRecordTypes = [
  defineRecordType<TokenMirrorRecord>({
    type: TOKEN_MIRROR_TYPE,
    scope: "scene",
    schema: TokenMirrorRecord,
    idOf: (r) => r.id,
    campaignOf: (r) => r.campaignId,
    sceneOf: (r) => r.sceneId,
    visibility: mirrorVisibility,
    redact: redactMirror,
    dmRedact: dmMirrorRecord,
    dmWindow: "active-scene",
    snapshot: ({ db }, v) => campaignMirrors(db, v.campaignId),
  }),
] as const;
