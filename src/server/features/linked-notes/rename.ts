// FR-NOTES-11 (slice N6, ADR-0078 "Rename rewrite"): a rename rewrites `[[Old]]` → `[[New]]` and
// `[[Old|label]]` → `[[New|label]]` in every note of the campaign linking to the old folded title,
// binned notes included, inside the rename's own transaction. Each rewritten note gets one
// server-authored change (editor ID "server") through the same path as a push: a `note_change`
// row, `note.version` + 1, folding, its link rows, and a `NoteEdited` event, so open editors
// receive it in `notes.updates` like anyone's typing (not in their undo history) and the search
// cache sees every body change.
import { ChangeSet } from "@codemirror/state";
import { NOTES_FOLD_EVERY, type NoteUpdate } from "@shared/linked-notes/collab";
import { NoteEdited } from "@shared/linked-notes/events";
import { parseLinks } from "@shared/linked-notes/links";
import { fold } from "@shared/search/match";
import { and, eq } from "drizzle-orm";
import type { CommandEnv } from "../../commands/commands";
import { note, noteChange, noteLink } from "../../db/schema";
import { loadText, pruneChanges } from "./collab";
import { syncLinks } from "./links";

/** The editor ID of server-authored changes (no client may bind it, N2). */
export const SERVER_EDITOR = "server";

/** A link's new text: the new title, its label kept. */
export const renamedLink = (title: string, label: string | null) =>
  label === null ? `[[${title}]]` : `[[${title}|${label}]]`;

/**
 * Rewrites every link to `oldFold` in campaign `cid` to `newTitle`. Returns the rewritten notes'
 * IDs. Runs inside the caller's transaction (the rename): all of it commits, or none.
 */
export function rewriteLinks(
  env: CommandEnv,
  cid: string,
  oldFold: string,
  newTitle: string,
): string[] {
  const linking = env.tx
    .selectDistinct({ id: note.id })
    .from(noteLink)
    .innerJoin(note, eq(note.id, noteLink.noteId))
    .where(and(eq(noteLink.targetFold, oldFold), eq(note.campaignId, cid)))
    .all();
  const done: string[] = [];
  const at = env.ctx.clock.iso();
  for (const { id } of linking) {
    const row = env.tx.select().from(note).where(eq(note.id, id)).get();
    if (!row) continue;
    const text = loadText(env.tx, row);
    const links = parseLinks(text.toString()).filter((l) => l.fold === oldFold);
    if (links.length === 0) continue;
    const cs = ChangeSet.of(
      links.map((l) => ({ from: l.from, to: l.to, insert: renamedLink(newTitle, l.label) })),
      text.length,
    );
    const body = cs.apply(text).toString();
    const updates: NoteUpdate[] = [
      { clientId: SERVER_EDITOR, changes: cs.toJSON() as NoteUpdate["changes"] },
    ];
    const version = row.version;
    const next = version + 1;
    env.tx
      .insert(noteChange)
      .values({ noteId: id, version, clientId: SERVER_EDITOR, changes: updates, at })
      .run();
    const folds = next - row.bodyVersion >= NOTES_FOLD_EVERY;
    env.tx
      .update(note)
      .set({
        version: next,
        ...(folds ? { body, bodyFold: fold(body), bodyVersion: next } : {}),
      })
      .where(eq(note.id, id))
      .run();
    if (folds) pruneChanges(env.tx, id, next);
    syncLinks(env.tx, id, body);
    env.emit({
      type: NoteEdited.type,
      campaignId: cid,
      payload: { noteId: id, from: version, clientId: SERVER_EDITOR, updates, linksChanged: true },
      changes: [],
    });
    done.push(id);
  }
  return done;
}
