// Encounter prep (FR-CBT-01, FR-CBT-02): create / replace / delete, REST only (ADR-0021 D).
import {
  EncounterBody,
  type EncounterRecord,
  OPEN_ENCOUNTERS_MAX,
  QUANTITY_MAX,
} from "@shared/combat-tracker/schemas";
import {
  EncounterCreated,
  EncounterDeleted,
  EncounterUpdated,
} from "@shared/events/combat-tracker";
import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { type CommandEnv, defineCommand, IdSchema } from "../../commands/commands";
import { conflict, invalid } from "../../commands/errors";
import {
  encounter,
  encounterEntry,
  encounterEntrySeqNext,
  encounterSeqNext,
  entity,
} from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { resolveDefinition } from "../entities/commands";
import {
  campaignOf,
  encounterChange,
  entriesOf,
  entryChange,
  getEncounter,
  readEncounter,
  toEntryRecord,
} from "./rows";

export const ENCOUNTER_REST = {
  create: "cbt.createEncounter",
  update: "cbt.updateEncounter",
  delete: "cbt.deleteEncounter",
} as const;

type Body = z.output<typeof EncounterBody>;

/** FR-CBT-02: a list holds only characters of the campaign (deduplicated, order kept). */
function checkParty(env: CommandEnv, cid: string, ids: string[] | null): string[] | null {
  if (ids === null) return null;
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const found = new Set(
    env.tx
      .select({ id: entity.id })
      .from(entity)
      .where(
        and(inArray(entity.id, unique), eq(entity.campaignId, cid), eq(entity.kind, "character")),
      )
      .all()
      .map((r) => r.id),
  );
  const bad = unique.findIndex((id) => !found.has(id));
  if (bad >= 0) {
    throw invalid("Party must be characters of this campaign", [
      { path: ["partyCharacterIds", bad], message: "Not a character of this campaign" },
    ]);
  }
  return unique;
}

/** FR-CBT-01: monsters via `resolveDefinition`; duplicates merged (order of first use). */
function checkEntries(env: CommandEnv, entries: Body["entries"]) {
  const merged = new Map<string, number>();
  entries.forEach((e, i) => {
    const def = resolveDefinition(env, e.definitionId);
    if (def.kind !== "monster") {
      throw invalid("Entries must be monsters", [
        { path: ["entries", i, "definitionId"], message: "Not a monster" },
      ]);
    }
    merged.set(def.id, (merged.get(def.id) ?? 0) + e.quantity);
  });
  for (const [definitionId, quantity] of merged) {
    if (quantity > QUANTITY_MAX) {
      throw invalid(`At most ${QUANTITY_MAX} of one creature`, [
        { path: ["entries"], message: `${definitionId}: at most ${QUANTITY_MAX}` },
      ]);
    }
  }
  return [...merged].map(([definitionId, quantity]) => ({ definitionId, quantity }));
}

function insertEntries(
  env: CommandEnv,
  enc: { id: string; campaignId: string },
  entries: { definitionId: string; quantity: number }[],
): RecordChange[] {
  return entries.map((e) => {
    const id = env.ctx.ids.next();
    const row = env.tx
      .insert(encounterEntry)
      .values({ id, encounterId: enc.id, seq: encounterEntrySeqNext, ...e })
      .returning()
      .get();
    return entryChange(null, toEntryRecord(row, enc.campaignId));
  });
}

function requirePlanned(e: EncounterRecord) {
  if (e.status !== "planned") throw conflict("Only a planned encounter can be changed");
}

export const createEncounter = defineCommand({
  name: ENCOUNTER_REST.create,
  input: EncounterBody,
  execute(input, env): EncounterRecord {
    const cid = campaignOf(env.actor);
    const open = env.tx
      .select({ id: encounter.id })
      .from(encounter)
      .where(and(eq(encounter.campaignId, cid), ne(encounter.status, "ended")))
      .all().length;
    if (open >= OPEN_ENCOUNTERS_MAX) {
      throw conflict(`At most ${OPEN_ENCOUNTERS_MAX} open encounters per campaign`);
    }
    const party = checkParty(env, cid, input.partyCharacterIds);
    const entries = checkEntries(env, input.entries);
    const id = env.ctx.ids.next();
    const now = env.ctx.clock.iso();
    env.tx
      .insert(encounter)
      .values({
        id,
        campaignId: cid,
        seq: encounterSeqNext,
        name: input.name,
        status: "planned",
        partyCharacterIds: party,
        round: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const after = readEncounter(env.tx, id);
    env.emit({
      type: EncounterCreated.type,
      campaignId: cid,
      payload: { encounterId: id },
      changes: [encounterChange(null, after), ...insertEntries(env, after, entries)],
    });
    return after;
  },
});

export const UpdateEncounterInput = EncounterBody.extend({ id: IdSchema });

/** Whole replace while planned (entries deleted and re-inserted). */
export const updateEncounter = defineCommand({
  name: ENCOUNTER_REST.update,
  input: UpdateEncounterInput,
  execute(input, env): EncounterRecord {
    const cid = campaignOf(env.actor);
    const before = getEncounter(env.tx, cid, input.id);
    requirePlanned(before);
    const party = checkParty(env, cid, input.partyCharacterIds);
    const entries = checkEntries(env, input.entries);
    const oldEntries = entriesOf(env.tx, before);
    env.tx.delete(encounterEntry).where(eq(encounterEntry.encounterId, before.id)).run();
    env.tx
      .update(encounter)
      .set({ name: input.name, partyCharacterIds: party, updatedAt: env.ctx.clock.iso() })
      .where(eq(encounter.id, before.id))
      .run();
    const after = readEncounter(env.tx, before.id);
    env.emit({
      type: EncounterUpdated.type,
      campaignId: cid,
      payload: { encounterId: before.id },
      changes: [
        encounterChange(before, after),
        ...oldEntries.map((e) => entryChange(e, null)),
        ...insertEntries(env, after, entries),
      ],
    });
    return after;
  },
});

export const deleteEncounter = defineCommand({
  name: ENCOUNTER_REST.delete,
  input: z.strictObject({ id: IdSchema }),
  execute({ id }, env): void {
    const cid = campaignOf(env.actor);
    const before = getEncounter(env.tx, cid, id);
    requirePlanned(before);
    const oldEntries = entriesOf(env.tx, before);
    env.tx.delete(encounterEntry).where(eq(encounterEntry.encounterId, id)).run();
    env.tx.delete(encounter).where(eq(encounter.id, id)).run();
    env.emit({
      type: EncounterDeleted.type,
      campaignId: cid,
      payload: { encounterId: id },
      changes: [...oldEntries.map((e) => entryChange(e, null)), encounterChange(before, null)],
    });
  },
});
