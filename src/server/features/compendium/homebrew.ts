// Homebrew (FR-CMP-24, -25): `cmp.putEntry` (create / whole replace in the active campaign) and
// `cmp.deleteEntry`. Imported entries are read-only (`forbidden`). Clone is the form prefilled
// from a visible entry: a plain create, no link (`derivedFromId` is informational).
import { PutEntryBody } from "@shared/compendium/homebrew";
import {
  type EntryDraft,
  entryNameKey,
  HOMEBREW_TEXT_MAX,
  HOUSE_RULES_CHAPTER,
  isReadOnlyEntry,
} from "@shared/compendium/schemas";
import { CompendiumEntryDeleted, CompendiumEntrySaved } from "@shared/events/compendium";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { CommandError, conflict, forbidden, invalid, notFound } from "../../commands/errors";
import { compendiumEntry } from "../../db/schema";
import { requireAsset } from "../assets-pipeline/commands";
import { activeCampaign } from "../campaign-management/commands";
import { dataHash } from "../fixtures-adapters/import-pipeline";
import { derivedColumns, EntryId, getEntry } from "./entries";

export const PUT_ENTRY = "cmp.putEntry";
export const DELETE_ENTRY = "cmp.deleteEntry";
export const READ_ONLY_ENTRY = "Imported entries are read-only. Clone to edit.";
export const NAME_TAKEN = "An entry of this kind with this name already exists";
export const IMAGE_NOT_FOUND = "Image not found";

/** Kind + name + facets + body as `EntryDraft` (monster excluded: customs, FR-CMP-02). */
export const PutEntryInput = PutEntryBody.extend({ id: EntryId.optional() });

export function campaignOf(env: Pick<CommandEnv, "tx" | "actor">): string {
  const cid = env.actor.campaignId ?? activeCampaign(env.tx)?.id ?? null;
  if (!cid) throw conflict("No active campaign");
  return cid;
}

/** Visible to the campaign's DM: imported, or the campaign's own homebrew (FR-CMP-14). */
function visibleToDm(cid: string, id: string, env: Pick<CommandEnv, "tx">): boolean {
  const r = getEntry(env.tx, id);
  return !!r && (r.campaignId === null || r.campaignId === cid);
}

/** FR-CMP-02 / -24: no homebrew monsters; body text ≤ 8,000 chars. */
function checkDraft(d: EntryDraft): void {
  if (d.kind === "monster") {
    throw invalid("Homebrew monsters are customs", [
      { path: ["entry", "kind"], message: "Derive a creature instead" },
    ]);
  }
  if (d.body.text.length > HOMEBREW_TEXT_MAX) {
    throw invalid("Text is too long", [
      { path: ["entry", "body", "text"], message: `At most ${HOMEBREW_TEXT_MAX} characters` },
    ]);
  }
}

/**
 * FR-CMP-46: each image through `assets.require` in the entry's campaign (listed assets and
 * attachments alike); unknown or another campaign's → `not_found`, before any write.
 */
function requireImages(env: CommandEnv, cid: string, ids: readonly string[]): void {
  const actor = { ...env.actor, campaignId: cid };
  for (const id of ids) {
    try {
      requireAsset({ tx: env.tx, actor }, id);
    } catch (err) {
      if (err instanceof CommandError && err.code === "not_found") throw notFound(IMAGE_NOT_FOUND);
      throw err;
    }
  }
}

/** FR-CMP-67: a homebrew `rule` is a house rule: chapter "House rules", order 0. */
function asHouseRule(d: EntryDraft): EntryDraft {
  return d.kind === "rule"
    ? { ...d, facets: { ...d.facets, chapter: HOUSE_RULES_CHAPTER, order: 0 } }
    : d;
}

export const putEntry = defineCommand({
  name: PUT_ENTRY,
  input: PutEntryInput,
  execute({ id, entry, shared, derivedFromId, imageAssetIds }, env): { entryId: string } {
    const { tx, ctx } = env;
    const cid = campaignOf(env);
    checkDraft(entry);
    const d = asHouseRule(entry);
    if (derivedFromId !== null && !visibleToDm(cid, derivedFromId, env)) {
      throw notFound("Base entry not found");
    }
    const before = id === undefined ? null : getEntry(tx, id);
    if (id !== undefined) {
      if (before && isReadOnlyEntry(before)) throw forbidden(READ_ONLY_ENTRY);
      if (!before || before.campaignId !== cid) throw notFound("Entry not found");
      if (before.kind !== d.kind) {
        throw invalid("Kind can't change", [{ path: ["entry", "kind"], message: "Immutable" }]);
      }
    }
    requireImages(env, cid, imageAssetIds);
    const cols = derivedColumns(d);
    const clash = tx
      .select({ id: compendiumEntry.id })
      .from(compendiumEntry)
      .where(
        and(
          eq(compendiumEntry.campaignId, cid),
          eq(compendiumEntry.kind, d.kind),
          eq(compendiumEntry.nameKey, entryNameKey(d.name)),
          id === undefined ? undefined : ne(compendiumEntry.id, id),
        ),
      )
      .get();
    if (clash) throw conflict(NAME_TAKEN);
    const now = ctx.clock.iso();
    const entryId = id ?? ctx.ids.next();
    const values = {
      ...cols,
      dataHash: dataHash(d),
      shared,
      derivedFromId,
      imageAssetIds,
      updatedAt: now,
    };
    if (before) {
      tx.update(compendiumEntry).set(values).where(eq(compendiumEntry.id, entryId)).run();
    } else {
      tx.insert(compendiumEntry)
        .values({
          id: entryId,
          campaignId: cid,
          source: null,
          sourceKey: null,
          definitionId: null,
          createdAt: now,
          importedAt: null,
          ...values,
        })
        .run();
    }
    env.emit({
      type: CompendiumEntrySaved.type,
      campaignId: cid,
      payload: { entryId, kind: d.kind, shared },
      changes: [],
    });
    return { entryId };
  },
});

/** FR-CMP-25: homebrew only; imported → `forbidden`; other campaign / unknown → `not_found`. */
export const deleteEntry = defineCommand({
  name: DELETE_ENTRY,
  input: z.strictObject({ id: EntryId }),
  execute({ id }, env): Record<string, never> {
    const cid = campaignOf(env);
    const before = getEntry(env.tx, id);
    if (before && isReadOnlyEntry(before)) throw forbidden(READ_ONLY_ENTRY);
    if (!before || before.campaignId !== cid) throw notFound("Entry not found");
    env.tx.delete(compendiumEntry).where(eq(compendiumEntry.id, id)).run();
    env.emit({
      type: CompendiumEntryDeleted.type,
      campaignId: cid,
      payload: { entryId: id },
      changes: [],
    });
    return {};
  },
});
