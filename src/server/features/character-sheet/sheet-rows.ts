// `creature_sheet` row ↔ `creature-sheet` record (CHARX §8.2). Every CHARX writer goes through
// `writeSheet`: validate the whole row (bounds, row limits, 48 KB cap), write, return the change.
import {
  CREATURE_SHEET_TYPE,
  CreatureSheetRecord,
  defaultSheetData,
  type SheetData,
} from "@shared/character-sheet/sheet";
import { type EntityRecord, SHEET_FULL_MESSAGE } from "@shared/entities/schemas";
import type { Issue } from "@shared/protocol/codes";
import { eq } from "drizzle-orm";
import type { z } from "zod";
import type { CommandEnv } from "../../commands/commands";
import { invalid, zodIssues } from "../../commands/errors";
import type { Tx } from "../../db/client";
import { creatureSheet } from "../../db/schema";
import type { RecordChange } from "../../events/types";

export type SheetRow = typeof creatureSheet.$inferSelect;
export type SheetEnv = Pick<CommandEnv, "tx" | "ctx">;

/** A stored row fails its schema: the snapshot omits it, a command answers `internal`. */
export class InvalidStoredSheet extends Error {
  override name = "InvalidStoredSheet";
  constructor(readonly entityId: string) {
    super(`Stored creature sheet ${entityId} fails its schema`);
  }
}

export function toSheetRecord(r: SheetRow): CreatureSheetRecord {
  const p = CreatureSheetRecord.safeParse({ id: r.entityId, ...r });
  if (!p.success) throw new InvalidStoredSheet(r.entityId);
  return p.data;
}

export function getSheet(tx: Tx, entityId: string): CreatureSheetRecord | null {
  const row = tx.select().from(creatureSheet).where(eq(creatureSheet.entityId, entityId)).get();
  return row ? toSheetRecord(row) : null;
}

/** FR-CHARX-02: a new row for `creature` with defaults (`ready`, unlocked, empty) + `data`. */
export function newSheet(
  env: SheetEnv,
  creature: EntityRecord,
  data: Partial<SheetData> = {},
): CreatureSheetRecord {
  const now = env.ctx.clock.iso();
  return {
    id: creature.id,
    entityId: creature.id,
    campaignId: creature.campaignId,
    ownerPlayerId: creature.kind === "character" ? creature.ownerPlayerId : null,
    ...defaultSheetData(),
    ...data,
    createdAt: now,
    updatedAt: now,
  };
}

/** The stored row, or a new default one (not yet written): "first CHARX write" (FR-CHARX-02). */
export function sheetOrNew(
  env: SheetEnv,
  creature: EntityRecord,
): { before: CreatureSheetRecord | null; sheet: CreatureSheetRecord } {
  const before = getSheet(env.tx, creature.id);
  return { before, sheet: before ?? newSheet(env, creature) };
}

/** JSON with sorted keys: equality independent of key order. */
export function stableJson(v: unknown): string {
  return JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : x,
  );
}

export const sameValue = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);

const content = ({ updatedAt: _u, createdAt: _c, ...rest }: CreatureSheetRecord) => rest;

/** FR-CHARX-03: a zod failure as `invalid`; the 48 KB cap reads "Sheet is full". */
export function sheetInvalid(err: z.ZodError, prefix: (string | number)[] = []): never {
  const issues: Issue[] = zodIssues(err).map((i) => ({
    path: [...prefix, ...i.path],
    message: i.message,
  }));
  if (issues.some((i) => i.message === SHEET_FULL_MESSAGE)) {
    throw invalid(SHEET_FULL_MESSAGE, issues);
  }
  throw invalid("Invalid sheet", issues);
}

/**
 * Writes `next` (insert when `before` is null) after validating the whole row; returns the
 * `creature-sheet` change, or null when nothing but timestamps would change.
 */
export function writeSheet(
  env: SheetEnv,
  before: CreatureSheetRecord | null,
  next: CreatureSheetRecord,
): RecordChange | null {
  if (before && sameValue(content(before), content(next))) return null;
  const p = CreatureSheetRecord.safeParse({ ...next, updatedAt: env.ctx.clock.iso() });
  if (!p.success) sheetInvalid(p.error);
  const after = p.data;
  // `id` is the wire key only (= entityId); the row has none.
  const { id: _wire, ...row } = after;
  if (before) {
    const { entityId: _id, createdAt: _c, ...fields } = row;
    env.tx.update(creatureSheet).set(fields).where(eq(creatureSheet.entityId, row.entityId)).run();
  } else {
    env.tx.insert(creatureSheet).values(row).run();
  }
  return { type: CREATURE_SHEET_TYPE, id: after.entityId, before, after };
}

/**
 * One change per record (first `before`, last `after`): a command that writes the sheet and
 * then runs the definition hooks lists `creature-sheet` once.
 */
export function mergeChanges(changes: readonly (RecordChange | null)[]): RecordChange[] {
  const out: RecordChange[] = [];
  const byKey = new Map<string, RecordChange>();
  for (const c of changes) {
    if (!c) continue;
    const key = `${c.type}\u0000${c.id}`;
    const prev = byKey.get(key);
    if (prev) {
      prev.after = c.after;
      continue;
    }
    const copy = { ...c };
    byKey.set(key, copy);
    out.push(copy);
  }
  return out;
}
