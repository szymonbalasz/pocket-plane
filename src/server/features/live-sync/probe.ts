// Sync probe: test-mode record type + intents (FR-SYNC-27, SYNC §8–9, CON-05/06/16).
import {
  ProbeEditInput,
  ProbeRecord,
  ProbeSetInput,
  probeVisibleTo,
} from "@shared/live-sync/schemas";
import { and, asc, eq, sql } from "drizzle-orm";
import { defineCommand } from "../../commands/commands";
import { conflict, forbidden, notFound } from "../../commands/errors";
import { player, syncProbe } from "../../db/schema";
import { defineRecordType } from "../../ws/records";

const toProbe = (r: typeof syncProbe.$inferSelect): ProbeRecord => ({
  id: r.id,
  campaignId: r.campaignId,
  text: r.text,
  hidden: r.hidden,
  ownerPlayerId: r.ownerPlayerId,
});

export const probeRecordType = defineRecordType<ProbeRecord>({
  type: "probe",
  scope: "campaign",
  schema: ProbeRecord,
  idOf: (r) => r.id,
  campaignOf: (r) => r.campaignId,
  visibility: (r, v) => (probeVisibleTo(r, v.playerId) ? "full" : "hidden"),
  snapshot: ({ db }, v) =>
    db
      .select()
      .from(syncProbe)
      .where(eq(syncProbe.campaignId, v.campaignId))
      .orderBy(asc(sql`rowid`))
      .all()
      .map(toProbe),
});

/** DM: create or update a probe in the connection's campaign. */
export const probeSet = defineCommand({
  name: "probe.set",
  input: ProbeSetInput,
  roles: ["dm"],
  authorize(input, { tx, actor }) {
    if (!actor.campaignId) throw conflict("No campaign context");
    const owner = input.ownerPlayerId ?? null;
    if (owner !== null) {
      const p = tx
        .select({ id: player.id })
        .from(player)
        .where(and(eq(player.id, owner), eq(player.campaignId, actor.campaignId)))
        .get();
      // Another campaign's player is invisible to this connection: not_found, not forbidden.
      if (!p) throw notFound("Owner not found in this campaign");
    }
  },
  execute(input, { tx, ctx, actor, emit }) {
    const campaignId = actor.campaignId as string;
    const owner = input.ownerPlayerId ?? null;
    let before: ProbeRecord | null = null;
    let id = input.id;
    if (id !== undefined) {
      const row = tx
        .select()
        .from(syncProbe)
        .where(and(eq(syncProbe.id, id), eq(syncProbe.campaignId, campaignId)))
        .get();
      if (!row) throw notFound("Probe not found");
      before = toProbe(row);
      tx.update(syncProbe)
        .set({ text: input.text, hidden: input.hidden, ownerPlayerId: owner })
        .where(eq(syncProbe.id, id))
        .run();
    } else {
      id = ctx.ids.next();
      tx.insert(syncProbe)
        .values({ id, campaignId, text: input.text, hidden: input.hidden, ownerPlayerId: owner })
        .run();
    }
    const after: ProbeRecord = {
      id,
      campaignId,
      text: input.text,
      hidden: input.hidden,
      ownerPlayerId: owner,
    };
    emit({
      type: "ProbeSet",
      campaignId,
      payload: { probeId: id, text: input.text, hidden: input.hidden, ownerPlayerId: owner },
      changes: [{ type: "probe", id, before, after }],
    });
    return { id };
  },
});

/** Player: edit the text of a probe they own and can see. */
export const probeEdit = defineCommand({
  name: "probe.edit",
  input: ProbeEditInput,
  roles: ["player"],
  authorize({ id }, { tx, actor }) {
    const row = tx.select().from(syncProbe).where(eq(syncProbe.id, id)).get();
    if (!row || row.campaignId !== actor.campaignId) throw notFound("Probe not found");
    const p = toProbe(row);
    // Invisible records answer like missing ones, so the reply never confirms an ID exists.
    if (!probeVisibleTo(p, actor.playerId)) throw notFound("Probe not found");
    if (p.ownerPlayerId !== actor.playerId) throw forbidden("Not your probe");
  },
  execute({ id, text }, { tx, emit }) {
    const row = tx.select().from(syncProbe).where(eq(syncProbe.id, id)).get();
    if (!row) throw notFound("Probe not found");
    tx.update(syncProbe).set({ text }).where(eq(syncProbe.id, id)).run();
    const before = toProbe(row);
    emit({
      type: "ProbeEdited",
      campaignId: row.campaignId,
      payload: { probeId: id, text },
      changes: [{ type: "probe", id, before, after: { ...before, text } }],
    });
    return { id };
  },
});
