// Image tools (AGENT §9, slice 7): upload a file on the DM's machine or SVG text the agent wrote
// over the DM's `POST /api/assets` (FR-AGENT-42–45, -48), and list the image library
// (FR-AGENT-46). The id then goes where images go, through the existing tools (FR-AGENT-47).
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  AssetName,
  AssetRecord,
  pickerOrder,
  UploadResponse,
} from "@shared/assets-pipeline/schemas";
import { ALL_IMAGES, matchImages, type TagFilter } from "@shared/assets-pipeline/search";
import { IMAGE_CONTEXT_TAG, ImageContext, tagKey } from "@shared/assets-pipeline/tags";
import { z } from "zod";
import { UPLOAD_TIMEOUT_MS } from "../client";
import { AgentError } from "../errors";
import { LIST_PAGE, ListInput } from "./read";
import { defineTool, registerTools } from "./registry";

/** FR-AGENT-43: FR-ASSET-21's client pre-check. */
export const UPLOAD_FILE_MAX = 25 * 1024 * 1024;
/** FR-AGENT-44 */
export const SVG_TEXT_MAX = 1024 * 1024;
const IMAGE_EXT = /\.(png|jpe?g|webp|svg)$/i;
const ASSET_TYPE = "asset";

export const AssetUploadInput = z
  .strictObject({
    path: z.string().min(1).max(1024).optional(),
    svg: z.string().min(1).max(SVG_TEXT_MAX).optional(),
    name: AssetName.optional(),
    context: ImageContext.optional(),
    listed: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if ((v.path === undefined) === (v.svg === undefined)) {
      ctx.addIssue({ code: "custom", path: ["path"], message: "Give exactly one of path or svg" });
      return;
    }
    if (v.path !== undefined) {
      if (!path.isAbsolute(v.path)) {
        ctx.addIssue({ code: "custom", path: ["path"], message: "Use an absolute path" });
      } else if (!IMAGE_EXT.test(v.path)) {
        ctx.addIssue({
          code: "custom",
          path: ["path"],
          message: "Not an image file: .png, .jpg, .jpeg, .webp or .svg",
        });
      }
    }
    if (v.svg !== undefined) {
      if (!/<svg[\s>]/i.test(v.svg)) {
        ctx.addIssue({ code: "custom", path: ["svg"], message: "Not SVG text (no <svg> element)" });
      }
      if (v.name === undefined) {
        ctx.addIssue({ code: "custom", path: ["name"], message: "Name the SVG image" });
      }
    }
  });
export type AssetUploadInput = z.output<typeof AssetUploadInput>;

/** FR-AGENT-45: compendium images are attachments (OQ-ASSET-15); anything else is listed. */
export const listedByDefault = (context: ImageContext | undefined) =>
  context !== "compendium-item" && context !== "compendium";

/** FR-AGENT-43: the file's problem, or null; reads only its metadata. */
async function fileProblem(p: string): Promise<string | null> {
  let s: Awaited<ReturnType<typeof stat>>;
  try {
    s = await stat(p);
  } catch {
    return `No file at ${p}`;
  }
  if (!s.isFile()) return `Not a file: ${p}`;
  if (s.size === 0) return "The file is empty";
  if (s.size > UPLOAD_FILE_MAX) return "File over 25 MB";
  return null;
}

async function source(
  input: AssetUploadInput,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; filename: string }> {
  if (input.svg !== undefined) {
    return {
      bytes: new TextEncoder().encode(input.svg),
      filename: `${input.name ?? "image"}.svg`,
    };
  }
  const p = input.path as string;
  const problem = await fileProblem(p);
  if (problem) throw new AgentError("invalid", problem, [{ path: ["path"], message: problem }]);
  try {
    return { bytes: new Uint8Array(await readFile(p)), filename: path.basename(p) };
  } catch {
    const message = `Can't read ${p}`;
    throw new AgentError("invalid", message, [{ path: ["path"], message }]);
  }
}

const contextTag = (c: ImageContext | undefined) => (c ? IMAGE_CONTEXT_TAG[c] : null);

const describeUpload = (input: AssetUploadInput) => {
  const what = input.name ?? (input.path ? path.basename(input.path) : "SVG");
  const where = (input.listed ?? listedByDefault(input.context)) ? "in the library" : "attachment";
  const tag = contextTag(input.context);
  return `asset_upload: "${what}" (${where}${tag ? `, ${tag}` : ""})`;
};

const assetUpload = defineTool({
  name: "asset_upload",
  description:
    "Upload an image to the active campaign and get its asset id: `path` = an absolute path to " +
    "a .png / .jpg / .webp / .svg file on this machine (≤ 25 MB), or `svg` = SVG text you wrote " +
    '(give it width and height, and a `name`). `context`: "compendium-item" for an item\'s ' +
    'image (an attachment, not in the library), "portrait", "token", "map", "prop", "handout". ' +
    "Same image again → the same id. Put the id in homebrew imageAssetIds or a portraitAssetId.",
  input: AssetUploadInput,
  write: true,
  async run({ caller }, input) {
    const { bytes, filename } = await source(input);
    const listed = input.listed ?? listedByDefault(input.context);
    const tag = contextTag(input.context);
    const form = new FormData();
    form.append("file", new File([bytes], filename));
    if (input.name !== undefined) form.append("name", input.name);
    form.append("listed", String(listed));
    if (tag) form.append("tags", JSON.stringify([tag]));
    const { status, data } = await caller.restStatus(
      "POST /api/assets",
      { form, write: true, timeoutMs: UPLOAD_TIMEOUT_MS },
      UploadResponse,
    );
    const a = data.asset;
    return {
      assetId: a.id,
      name: a.name,
      outcome: status === 201 ? "created" : "existing",
      width: a.width,
      height: a.height,
      tags: a.tags,
      ...(data.droppedTags ? { droppedTags: data.droppedTags } : {}),
    };
  },
  async plan(ctx, input) {
    if (input.path !== undefined) {
      const problem = await fileProblem(input.path);
      if (problem) ctx.issue(["path"], problem);
    }
    return describeUpload(input);
  },
});

export const AssetsListInput = ListInput.extend({
  /** One tag, fold-equal ("items" finds Items). */
  tag: z.string().min(1).max(64).optional(),
});

const assetsList = defineTool({
  name: "assets_list",
  description:
    "List the active campaign's image library (id, name, tags, size), newest first. `q` " +
    "searches names and tags; `tag` keeps one tag (Tokens, Portraits, Maps, Handouts, Props, " +
    "Items or a DM tag). Item attachments aren't listed. Pass `nextCursor` back as `cursor`.",
  input: AssetsListInput,
  write: false,
  run: ({ caller }, input) =>
    caller.ws({}, async (s) => {
      const all = s.records(ASSET_TYPE, AssetRecord).sort(pickerOrder);
      const filter: TagFilter = input.tag ? { kind: "tag", key: tagKey(input.tag) } : ALL_IMAGES;
      const hits = matchImages(all, input.q ?? "", filter);
      const from = Number(input.cursor ?? "0");
      const next = from + LIST_PAGE;
      return {
        campaign: s.campaign,
        assets: hits.slice(from, next).map((a) => ({
          id: a.id,
          name: a.name,
          tags: a.tags,
          width: a.width,
          height: a.height,
          createdAt: a.createdAt,
        })),
        nextCursor: next < hits.length ? String(next) : null,
      };
    }),
});

registerTools(assetUpload, assetsList);
