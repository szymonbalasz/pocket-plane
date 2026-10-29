// Homebrew tools (AGENT §9, slice 3): create, edit, share compendium homebrew over the DM's REST
// routes. Edit / share are GET + whole `PUT` (OQ-AGENT-04: last write wins) that send every
// unchanged field as stored (FR-AGENT-17). Players see an entry only if `shared` (FR-CMP-14).
import { PutEntryBody, PutEntryResponse } from "@shared/compendium/homebrew";
import { EntryResponse, HOMEBREW_LABEL, SearchResponse } from "@shared/compendium/rest";
import {
  type CompendiumEntry,
  type CompendiumKind,
  EntryImages,
  EntryName,
  entryNameKey,
} from "@shared/compendium/schemas";
import type { Issue } from "@shared/protocol/codes";
import { z } from "zod";
import type { Caller } from "../client";
import { AgentError } from "../errors";
import type { PlanContext } from "../plan";
import { defineTool, registerTools } from "./registry";

export const MONSTER_NOT_HOMEBREW =
  "Homebrew monsters are custom creatures: use creature_create or creature_derive";
export const READ_ONLY_ENTRY =
  "Imported entries are read-only: homebrew_create a copy with derivedFromId = its id";

const EntryId = z.string().min(1).max(64);

/**
 * FR-AGENT-25: the route's body; monsters are custom creatures (FR-CMP-02 / -24). The check runs
 * even when the monster facets fail too (`when`), so the pointer is never lost among them.
 */
export const HomebrewCreateInput = PutEntryBody.refine(
  // The value may be unparsed here (`when`): read `kind` defensively.
  (b) => (b as { entry?: { kind?: unknown } } | null)?.entry?.kind !== "monster",
  { path: ["entry", "kind"], message: MONSTER_NOT_HOMEBREW, when: () => true },
);

/** Shallow merge into the stored facets / body: a key given replaces it, `null` removes it. */
const MergeKeys = z.record(z.string(), z.unknown());

export const HomebrewPatch = z
  .strictObject({
    name: EntryName.optional(),
    facets: MergeKeys.optional(),
    body: MergeKeys.optional(),
    derivedFromId: PutEntryBody.shape.derivedFromId.unwrap().optional(),
    imageAssetIds: EntryImages.optional(),
  })
  .refine((p) => Object.values(p).some((v) => v !== undefined), { message: "Nothing to change" });
export type HomebrewPatch = z.infer<typeof HomebrewPatch>;

export const HomebrewEditInput = z.strictObject({ id: EntryId, patch: HomebrewPatch });
export const HomebrewShareInput = z.strictObject({ id: EntryId, shared: z.boolean() });

const merge = (stored: unknown, patch: Record<string, unknown> | undefined) => {
  const out: Record<string, unknown> = { ...(stored as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (v === null) delete out[k];
    else out[k] = v;
  }
  return out;
};

/**
 * FR-AGENT-17: the whole `PUT` body from the stored entry, with only `patch` / `shared` changed.
 * Issue paths are the edit tool's (`entry.*` → `patch.*`).
 */
export function putBodyOf(
  e: CompendiumEntry,
  change: { patch?: HomebrewPatch; shared?: boolean },
): { body: PutEntryBody } | { issues: Issue[] } {
  const p = change.patch ?? {};
  const r = PutEntryBody.safeParse({
    entry: {
      kind: e.kind,
      name: p.name ?? e.name,
      facets: merge(e.facets, p.facets),
      body: merge(e.body, p.body),
    },
    shared: change.shared ?? e.shared,
    derivedFromId: p.derivedFromId === undefined ? e.derivedFromId : p.derivedFromId,
    imageAssetIds: p.imageAssetIds ?? e.imageAssetIds,
  });
  if (r.success) return { body: r.data };
  return {
    issues: r.error.issues.map((i) => {
      const path = i.path.filter((x): x is string | number => typeof x !== "symbol");
      return {
        path: ["patch", ...(path[0] === "entry" ? path.slice(1) : path)],
        message: i.message,
      };
    }),
  };
}

/** The stored homebrew entry (DM view); imported → `forbidden`, unknown → `not_found`. */
async function storedEntry(caller: Caller, id: string): Promise<CompendiumEntry> {
  let r: EntryResponse;
  try {
    r = await caller.rest("GET /api/compendium/entries/:id", { id }, EntryResponse);
  } catch (err) {
    if (err instanceof AgentError && err.code === "not_found") {
      throw new AgentError(
        "not_found",
        `No compendium entry ${id}: find ids with compendium_search`,
      );
    }
    throw err;
  }
  if (r.entry.source !== null) throw new AgentError("forbidden", READ_ONLY_ENTRY);
  return r.entry;
}

/** Plan side of `storedEntry`: an issue at `id` instead of a throw. */
async function planEntry(ctx: PlanContext, id: string): Promise<CompendiumEntry | null> {
  try {
    return await storedEntry(ctx.caller, id);
  } catch (err) {
    if (!(err instanceof AgentError) || !["not_found", "forbidden"].includes(err.code)) throw err;
    ctx.issue(["id"], err.message);
    return null;
  }
}

/** Write `body` over entry `id`; the answer names what was saved. */
async function put(caller: Caller, id: string, body: PutEntryBody) {
  const r = await caller.rest(
    "PUT /api/compendium/entries/:id",
    { id, body, write: true },
    PutEntryResponse,
  );
  return { entryId: r.entryId, kind: body.entry.kind, name: body.entry.name, shared: body.shared };
}

/**
 * FR-AGENT-19 / FR-CMP-24: the campaign's homebrew names of `kind` equal to `name`
 * (case-insensitive), from the DM search; a duplicate group is opened with `sameAs`.
 */
async function homebrewNamed(
  caller: Caller,
  kind: CompendiumKind,
  name: string,
  except?: string,
): Promise<string[]> {
  const key = entryNameKey(name);
  const search = (query: Record<string, string>) =>
    caller.rest("GET /api/compendium/search", { query }, SearchResponse);
  const { results } = await search({ q: name.trim(), kind });
  const names: string[] = [];
  for (const r of results.filter((x) => entryNameKey(x.name) === key)) {
    const members = r.group ? (await search({ sameAs: r.id, q: name.trim() })).results : [r];
    for (const m of members) {
      if (m.sourceLabel === HOMEBREW_LABEL && m.id !== except && entryNameKey(m.name) === key) {
        names.push(m.name);
      }
    }
  }
  return names;
}

const claimHomebrewName = async (
  ctx: PlanContext,
  kind: CompendiumKind,
  name: string,
  path: Issue["path"],
  except?: string,
) =>
  ctx.claimName(
    `homebrew:${kind}`,
    name,
    path,
    await homebrewNamed(ctx.caller, kind, name, except),
  );

const sharedWord = (shared: boolean) => (shared ? "shared with players" : "DM only");

const homebrewCreate = defineTool({
  name: "homebrew_create",
  description:
    "Create a homebrew compendium entry (spell, item, condition, feature or house rule) in the " +
    "active campaign: {entry: {kind, name, facets, body}, shared?, derivedFromId?, " +
    "imageAssetIds?}. Unshared (DM only) unless the DM says share. Monsters are custom " +
    "creatures: use creature_create / creature_derive.",
  input: HomebrewCreateInput,
  write: true,
  async run({ caller }, body) {
    const r = await caller.rest(
      "POST /api/compendium/entries",
      { body, write: true },
      PutEntryResponse,
    );
    return {
      entryId: r.entryId,
      kind: body.entry.kind,
      name: body.entry.name,
      shared: body.shared,
    };
  },
  async plan(ctx, body) {
    await claimHomebrewName(ctx, body.entry.kind, body.entry.name, ["entry", "name"]);
    if (body.derivedFromId !== null) {
      try {
        await ctx.caller.rest(
          "GET /api/compendium/entries/:id",
          { id: body.derivedFromId },
          EntryResponse,
        );
      } catch (err) {
        if (!(err instanceof AgentError) || err.code !== "not_found") throw err;
        ctx.issue(["derivedFromId"], `No compendium entry ${body.derivedFromId}`);
      }
    }
    return `homebrew_create: ${body.entry.kind} "${body.entry.name}", ${sharedWord(body.shared)}`;
  },
});

const homebrewEdit = defineTool({
  name: "homebrew_edit",
  description:
    "Edit a homebrew compendium entry by id: `patch` holds only what changes (name; facets / " +
    "body keys merged into the stored ones, a key set to null removes it; derivedFromId; " +
    "imageAssetIds). Everything else is kept as stored. Kind can't change.",
  input: HomebrewEditInput,
  write: true,
  async run({ caller }, { id, patch }) {
    const stored = await storedEntry(caller, id);
    const r = putBodyOf(stored, { patch });
    if ("issues" in r) throw new AgentError("invalid", "Invalid patch", r.issues);
    return put(caller, id, r.body);
  },
  async plan(ctx, { id, patch }) {
    const stored = await planEntry(ctx, id);
    if (!stored) return `homebrew_edit: ${id}`;
    const r = putBodyOf(stored, { patch });
    if ("issues" in r) for (const i of r.issues) ctx.issue(i.path, i.message);
    if (patch.name !== undefined && entryNameKey(patch.name) !== entryNameKey(stored.name)) {
      await claimHomebrewName(ctx, stored.kind, patch.name, ["patch", "name"], id);
    }
    const keys = Object.keys(patch).filter((k) => patch[k as keyof HomebrewPatch] !== undefined);
    return `homebrew_edit: ${stored.kind} "${stored.name}" (${keys.join(", ")})`;
  },
});

const homebrewShare = defineTool({
  name: "homebrew_share",
  description:
    "Share a homebrew compendium entry with the players (shared: true) or make it DM only " +
    "(false). Players find it at their next compendium search; nothing else changes.",
  input: HomebrewShareInput,
  write: true,
  async run({ caller }, { id, shared }) {
    const r = putBodyOf(await storedEntry(caller, id), { shared });
    if ("issues" in r) throw new AgentError("invalid", "Stored entry doesn't validate", r.issues);
    return put(caller, id, r.body);
  },
  async plan(ctx, { id, shared }) {
    const stored = await planEntry(ctx, id);
    if (!stored) return `homebrew_share: ${id}`;
    return `homebrew_share: ${stored.kind} "${stored.name}" → ${sharedWord(shared)}`;
  },
});

registerTools(homebrewCreate, homebrewEdit, homebrewShare);
