// `cmp.putEntry` (FR-CMP-24, server side only): homebrew create / whole replace in the active
// campaign. C1 ships the command for the `cmp-homebrew*` fixtures; C4 adds the REST route,
// delete and clone. Imported entries are read-only (`forbidden`).
import {
  EntryDraft,
  entryNameKey,
  HOMEBREW_TEXT_MAX,
  isReadOnlyEntry,
} from "@shared/compendium/schemas";
import { CompendiumEntrySaved } from "@shared/events/compendium";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { conflict, forbidden, invalid, notFound } from "../../commands/errors";
import { compendiumEntry } from "../../db/schema";
import { activeCampaign } from "../campaign-management/commands";
import { dataHash } from "../fixtures-adapters/import-pipeline";
import { derivedColumns, EntryId, getEntry } from "./entries";

export const PUT_ENTRY = "cmp.putEntry";
export const READ_ONLY_ENTRY = "Imported entries are read-only. Clone to edit.";
export const NAME_TAKEN = "An entry of this kind with this name already exists";

/** Kind + name + facets + body as `EntryDraft` (monster excluded: customs, FR-CMP-02). */
export const PutEntryInput = z.strictObject({
  id: EntryId.optional(),
  entry: EntryDraft,
  shared: z.boolean().default(false),
  derivedFromId: EntryId.nullable().default(null),
});

function campaignOf(env: CommandEnv): string {
  const cid = env.actor.campaignId ?? activeCampaign(env.tx)?.id ?? null;
  if (!cid) throw conflict("No active campaign");
  return cid;
}

/** Visible to the campaign's DM: imported, or the campaign's own homebrew (FR-CMP-14). */
function visibleToDm(cid: string, id: string, env: CommandEnv): boolean {
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

export const putEntry = defineCommand({
  name: PUT_ENTRY,
  input: PutEntryInput,
  execute({ id, entry: d, shared, derivedFromId }, env): { entryId: string } {
    const { tx, ctx } = env;
    const cid = campaignOf(env);
    checkDraft(d);
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
