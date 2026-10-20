// REST for assets-pipeline (ASSET §9, protocol §13–14). Mounted at /api.
import {
  AssetFile,
  AssetId,
  MAX_UPLOAD_BYTES,
  type UploadResponse,
} from "@shared/assets-pipeline/schemas";
import { ImageTags } from "@shared/assets-pipeline/tags";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { asset, campaign } from "../../db/schema";
import {
  type DmCampaignEnv,
  dmActor,
  dmCampaign,
  dmOnly,
  errorBody,
  errorResponse,
} from "../../http";
import type { Services } from "../../services";
import { INGEST, type IngestResult, resolveName } from "./commands";
import { IngestRejected, tooLarge } from "./image";
import { prepareIngest } from "./ingest";
import { assetStoreOf } from "./store";

/** FR-ASSET-13: one body for every GET denial (no existence oracle). */
export const NOT_FOUND_BODY = errorBody("not_found", "Not found");

/** FR-ASSET-14 */
export const CACHE_CONTROL = "private, max-age=31536000, immutable";

/** FR-ASSET-24: the multipart `listed` field: absent = listed, `"true"` / `"false"`, else null. */
function parseListed(v: string | File | undefined): boolean | null {
  if (v === undefined || v === "true") return true;
  return v === "false" ? false : null;
}

/**
 * FR-ASSET-41: the multipart `tags` field: absent = none; a JSON array of tags under FR-ASSET-39's
 * rules (normalised, deduplicated); anything else = null (400).
 */
function parseTags(v: string | File | undefined): { tags?: string[] } | null {
  if (v === undefined) return {};
  if (typeof v !== "string") return null;
  let json: unknown;
  try {
    json = JSON.parse(v);
  } catch {
    return null;
  }
  const r = ImageTags.safeParse(json);
  return r.success ? { tags: r.data } : null;
}

/** Multipart framing on top of the file itself. */
const MULTIPART_SLACK = 64 * 1024;

function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header
    .split(",")
    .map((t) => t.trim().replace(/^W\//, ""))
    .some((t) => t === etag || t === "*");
}

export function assetRoutes(s: Services) {
  const store = assetStoreOf(s);
  const rejected = (c: { json: (b: unknown, st: 413) => Response }) =>
    c.json(errorBody("invalid", tooLarge().message), 413);

  return (
    new Hono<DmCampaignEnv>()
      // FR-ASSET-01/-02: DM upload. Auth (401/429) → campaign at authentication (CON-21) →
      // body limit (413, stops reading) → name → content checks (415/422) → command.
      .post(
        "/assets",
        dmOnly(s),
        dmCampaign(s),
        bodyLimit({ maxSize: MAX_UPLOAD_BYTES + MULTIPART_SLACK, onError: (c) => rejected(c) }),
        async (c) => {
          const campaignId = c.get("campaignId");
          let form: Record<string, string | File>;
          try {
            form = (await c.req.parseBody()) as Record<string, string | File>;
          } catch {
            return c.json(errorBody("invalid", "Expected a multipart form with a file"), 400);
          }
          const file = form.file;
          const name = typeof form.name === "string" ? form.name : undefined;
          const listed = parseListed(form.listed);
          if (listed === null) {
            return c.json(
              errorBody("invalid", "Invalid listed", [
                { path: ["listed"], message: 'Expected "true" or "false"' },
              ]),
              400,
            );
          }
          const tags = parseTags(form.tags);
          if (tags === null) {
            return c.json(
              errorBody("invalid", "Invalid tags", [
                { path: ["tags"], message: "Expected a JSON array of tags" },
              ]),
              400,
            );
          }
          if (!(file instanceof File)) {
            return c.json(
              errorBody("invalid", "Missing file", [{ path: ["file"], message: "Required" }]),
              400,
            );
          }
          if (file.size > MAX_UPLOAD_BYTES) return rejected(c);
          const n = resolveName(file.name, name);
          if (!n.success) {
            const issues = n.error.issues.map((i) => ({ path: ["name"], message: i.message }));
            return c.json(errorBody("invalid", "Invalid name", issues), 400);
          }
          try {
            const input = await prepareIngest({
              bytes: new Uint8Array(await file.arrayBuffer()),
              filename: file.name,
              ...(name !== undefined ? { name } : {}),
            });
            const r = s.commands.run(
              INGEST,
              { ...input, listed, ...tags },
              {
                actor: dmActor(campaignId),
              },
            ) as IngestResult;
            const body: UploadResponse = {
              asset: r.asset,
              ...(r.droppedTags ? { droppedTags: r.droppedTags } : {}),
            };
            return c.json(body, r.outcome === "created" ? 201 : 200);
          } catch (err) {
            // 413 / 415 / 422 keep code `invalid`; the status carries the cause.
            if (err instanceof IngestRejected) {
              return c.json(errorBody("invalid", err.message), err.status);
            }
            return errorResponse(c, err, s);
          }
        },
      )
      // FR-ASSET-11/-13/-14: no credential; the ID is the capability. Served iff the asset
      // exists and belongs to the active campaign. `id` / `file` never reach a path.
      .get("/assets/:id/:file", (c) => {
        const id = AssetId.safeParse(c.req.param("id"));
        const file = AssetFile.safeParse(c.req.param("file"));
        if (!id.success || !file.success) return c.json(NOT_FOUND_BODY, 404);
        const row = s.db
          .select({ hash: asset.hash })
          .from(asset)
          .innerJoin(campaign, eq(asset.campaignId, campaign.id))
          .where(and(eq(asset.id, id.data), eq(campaign.active, true)))
          .get();
        if (!row) return c.json(NOT_FOUND_BODY, 404);
        // FR-ASSET-07: missing any file of the set → every file of the asset answers 404.
        if (!store.isComplete(row.hash)) return c.json(NOT_FOUND_BODY, 404);
        const p = store.filePath(row.hash, file.data);
        const etag = `"${id.data}-${file.data}"`;
        const headers = {
          "Cache-Control": CACHE_CONTROL,
          ETag: etag,
          "X-Content-Type-Options": "nosniff",
        };
        if (etagMatches(c.req.header("if-none-match"), etag)) {
          return c.body(null, 304, headers);
        }
        return new Response(Bun.file(p), {
          status: 200,
          headers: { ...headers, "Content-Type": "image/webp" },
        });
      })
  );
}
