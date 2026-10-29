// Custom creature tools (AGENT §9, slice 2, FR-AGENT-20..24): create, derive, edit and NPC sheet
// rows over `POST` / `PUT /api/entities`, `/api/compendium/derive-monster`, `char.putRow` and
// `char.edit`. Multi-step tools stop at the first failure (FR-AGENT-18); each has a plan checker.
import {
  CHARACTER_ONLY_FIELDS,
  CHARX_INTENTS,
  CharEditSet,
  CharPutRowIntent,
  CharPutRowResult,
  ROW_LIMITS,
} from "@shared/character-sheet/sheet";
import { DERIVE_ROWS_MAX, DeriveEntity, DeriveMonsterResponse } from "@shared/compendium/homebrew";
import { EntryResponse } from "@shared/compendium/rest";
import type { BodyOf } from "@shared/compendium/schemas";
import {
  Attacks,
  CreateEntityBody,
  CreatureType,
  ENTITY_TYPE,
  EntityName,
  EntityRecord,
  EntityResponse,
  HpFormula,
  IMPORTED_ENTITY_TYPE,
  ImportedEntityRecord,
  type MonsterStatBlock,
  MonsterStatBlock as MonsterStatBlockSchema,
  TokenShape,
  type UpdateEntityBody,
} from "@shared/entities/schemas";
import type { SheetRowList } from "@shared/events/character-sheet";
import type { Issue } from "@shared/protocol/codes";
import { z } from "zod";
import type { WsSession } from "../client";
import { AgentError, type ToolError, toToolError } from "../errors";
import type { PlanContext } from "../plan";
import { PutRowInput } from "./character";
import { defineTool, registerTools } from "./registry";

const RecordId = z.string().min(1).max(64);

export const NOT_A_CREATURE = "Not a custom creature: use character_edit";

// ---- inputs (zod from @shared) ----

const [attackRow, spellRow, featureRow, itemRow] = CharPutRowIntent.options;
/** A `char.putRow` row for the creature being made (`creatureId` comes from the create). */
export const NewRow = z.discriminatedUnion("list", [
  attackRow.omit({ creatureId: true }),
  spellRow.omit({ creatureId: true }),
  featureRow.omit({ creatureId: true }),
  itemRow.omit({ creatureId: true }),
]);
export type NewRow = z.output<typeof NewRow>;

/** Every row a sheet can hold (Σ ROW_LIMITS). */
export const ROWS_MAX = Object.values(ROW_LIMITS).reduce((a, b) => a + b, 0);

const afterCreate = {
  rows: z.array(NewRow).max(ROWS_MAX).optional(),
  notes: CharEditSet.shape.notes,
};

/** FR-AGENT-20: the creature form's monster body, `kind` implied, plus rows and notes. */
export const CreateInput = DeriveEntity.omit({ kind: true }).extend(afterCreate);
export type CreateInput = z.output<typeof CreateInput>;

/** Fields `char.edit` has no key for: `PUT /api/entities/:id` (OQ-AGENT-03). */
const putKeys = {
  type: CreatureType.nullable().optional(),
  hpFormula: HpFormula.nullable().optional(),
  tokenShape: TokenShape.nullable().optional(),
};
export const PUT_KEYS = Object.keys(putKeys) as (keyof typeof putKeys)[];

/** FR-AGENT-21: a diff over the base's stat block (null clears an optional key). */
export const DeriveSet = CharEditSet.pick({
  cr: true,
  size: true,
  ac: true,
  hpMax: true,
  initBonus: true,
  speed: true,
  abilities: true,
  saveProficiencies: true,
  skills: true,
  overrides: true,
  spellcasting: true,
  senses: true,
  portraitAssetId: true,
}).extend({ ...putKeys, attacks: Attacks.optional() });
export type DeriveSet = z.output<typeof DeriveSet>;

export const DeriveInput = z
  .strictObject({
    baseId: RecordId.optional(),
    entryId: RecordId.optional(),
    name: EntityName,
    set: DeriveSet.optional(),
    ...afterCreate,
  })
  .refine((d) => (d.baseId === undefined) !== (d.entryId === undefined), {
    path: ["baseId"],
    message: "Give exactly one of baseId (a creature) or entryId (a compendium monster)",
  });
export type DeriveInput = z.output<typeof DeriveInput>;

/** FR-AGENT-22: `CharEditSet` keys go to `char.edit`, `type` / `hpFormula` / `tokenShape` to `PUT`. */
export const EditSet = CharEditSet.extend(putKeys).refine((s) => Object.keys(s).length > 0, {
  message: "Nothing to change",
});
export const EditInput = z.strictObject({ id: RecordId, set: EditSet });
export type EditInput = z.output<typeof EditInput>;

// ---- bodies ----

type PutSet = Partial<Pick<DeriveSet, keyof typeof putKeys>>;
type Definition = EntityRecord | ImportedEntityRecord;

/** Stat-block keys of `set` over `block`; null deletes the key. */
export function applyBlock(block: MonsterStatBlock, set: Record<string, unknown>) {
  const next: Record<string, unknown> = { ...block };
  for (const [k, v] of Object.entries(set)) {
    if (k === "portraitAssetId" || k === "tokenShape" || v === undefined) continue;
    if (v === null) delete next[k];
    else next[k] = v;
  }
  return next;
}

const pick = <T>(set: Record<string, unknown>, key: string, stored: T): T =>
  set[key] === undefined ? stored : (set[key] as T);

/**
 * FR-AGENT-17: the `PUT` body from the full stored record, every field not in `set` as stored.
 * A pet keeps `companionOf` and `turnMode` (whole replace: omitted would release it).
 */
export function putBody(def: Definition, set: PutSet): z.input<typeof UpdateEntityBody> {
  if (def.kind !== "monster") throw new AgentError("invalid", NOT_A_CREATURE);
  return {
    name: def.name,
    portraitAssetId: def.portraitAssetId,
    tokenShape: pick(set, "tokenShape", def.tokenShape),
    statBlock: applyBlock(def.statBlock, set),
    ...("companionOf" in def ? { companionOf: def.companionOf, turnMode: def.turnMode } : {}),
  };
}

/** FR-AGENT-21 `baseId`: the base's stat block, art and shape (as the derive form), then `set`. */
export function deriveBody(base: Definition, input: DeriveInput) {
  if (base.kind !== "monster") throw new AgentError("invalid", NOT_A_CREATURE);
  const set = input.set ?? {};
  return parseBody(
    CreateEntityBody,
    {
      kind: "monster",
      name: input.name,
      portraitAssetId: pick(set, "portraitAssetId", base.portraitAssetId),
      tokenShape: pick(set, "tokenShape", base.tokenShape),
      statBlock: applyBlock(base.statBlock, set),
      derivedFromId: base.id,
    },
    set,
  );
}

/** FR-AGENT-21 `entryId`: the entry's definition stat block, then `set`; text copied (FR-CMP-27). */
export function deriveEntryBody(entry: EntryResponse, input: DeriveInput) {
  if (entry.entry.kind !== "monster" || !entry.definition) {
    throw new AgentError("invalid", "Only monster entries derive a creature", [
      { path: ["entryId"], message: "Not a monster entry" },
    ]);
  }
  const set = input.set ?? {};
  const entity = parseBody(
    DeriveEntity,
    {
      kind: "monster",
      name: input.name,
      ...(set.portraitAssetId !== undefined ? { portraitAssetId: set.portraitAssetId } : {}),
      ...(set.tokenShape !== undefined ? { tokenShape: set.tokenShape } : {}),
      statBlock: applyBlock(entry.definition.statBlock, set),
    },
    set,
  );
  return { entryId: entry.entry.id, entity, copyText: true };
}

/** The route's own zod body; issues on a stat-block key the input `set` holds point at `set`. */
function parseBody<S extends z.ZodType>(schema: S, body: unknown, set: object): z.output<S> {
  const r = schema.safeParse(body);
  if (r.success) return r.data;
  const issues: Issue[] = r.error.issues.map((i) => {
    const path = i.path.filter((p): p is string | number => typeof p !== "symbol");
    const [head, key, ...rest] = path;
    const inSet = head === "statBlock" && typeof key === "string" && key in set;
    return { path: inSet ? ["set", key, ...rest] : path, message: i.message };
  });
  throw new AgentError("invalid", "Invalid input", issues);
}

/**
 * FR-CMP-27's copied Features rows (`cmp.deriveMonster`): traits, actions and bonus actions
 * without a same-named attack, reactions, legendary actions; ≤ 30. Counted for ROW_LIMITS only.
 */
export function copiedFeatures(entry: EntryResponse, attacks: readonly { name: string }[]): number {
  if (entry.entry.kind !== "monster") return 0;
  const body = entry.entry.body as BodyOf<"monster">;
  const mapped = new Set(attacks.map((a) => a.name.trim().toLowerCase()));
  const unmapped = (s: { name: string }) => !mapped.has(s.name.trim().toLowerCase());
  const n =
    body.traits.length +
    body.actions.filter(unmapped).length +
    body.bonusActions.filter(unmapped).length +
    body.reactions.length +
    (body.legendary?.actions.length ?? 0);
  return Math.min(n, DERIVE_ROWS_MAX);
}

// ---- multi-step (FR-AGENT-18) ----

type StepLabel = Record<string, unknown> & { step: string };
interface Step {
  label: StepLabel;
  run(): Promise<Record<string, unknown> | undefined>;
}
export interface StepsResult {
  done: StepLabel[];
  failedAt?: StepLabel;
  error?: ToolError;
}

/**
 * In order; stops at the first failure. Nothing done yet → that error as the tool error (nothing
 * written); later → `{done, failedAt, error}` so the DM knows what is left over.
 */
async function runSteps(steps: readonly Step[]): Promise<StepsResult> {
  const done: StepLabel[] = [];
  for (const s of steps) {
    try {
      done.push({ ...s.label, ...(await s.run()) });
    } catch (err) {
      if (done.length === 0 || !(err instanceof AgentError)) throw err;
      return { done, failedAt: s.label, error: toToolError(err) };
    }
  }
  return { done };
}

/** `char.putRow` per row, then `char.edit {notes}`, on the creature `id()` names once created. */
function sheetSteps(s: WsSession, id: () => string, input: { rows?: NewRow[]; notes?: string }) {
  const steps: Step[] = (input.rows ?? []).map((row, index) => ({
    label: { step: "row", index, list: row.list, name: row.row.name },
    async run() {
      const r = await s.intent(CHARX_INTENTS.putRow, { creatureId: id(), ...row });
      return { rowId: CharPutRowResult.parse(r).rowId };
    },
  }));
  if (input.notes !== undefined) {
    const notes = input.notes;
    steps.push({
      label: { step: "notes" },
      async run() {
        await s.intent(CHARX_INTENTS.edit, { creatureId: id(), set: { notes } });
        return undefined;
      },
    });
  }
  return steps;
}

const entityIn = (s: WsSession, id: string) =>
  s.records(ENTITY_TYPE, EntityRecord).find((e) => e.id === id) ?? null;

const importedIn = async (s: WsSession, id: string) =>
  (await s.load(IMPORTED_ENTITY_TYPE, ImportedEntityRecord, [id]))[0] ?? null;

/** A custom creature of the snapshot, else an imported one, else `not_found`; never a character. */
async function definitionIn(s: WsSession, id: string): Promise<Definition> {
  const e = entityIn(s, id);
  if (e?.kind === "character") throw new AgentError("invalid", NOT_A_CREATURE);
  const def = e ?? (await importedIn(s, id));
  if (!def) {
    throw new AgentError(
      "not_found",
      `No creature ${id}: find ids with creatures_list or compendium_search`,
    );
  }
  return def;
}

function created(s: WsSession, first: Step, input: { rows?: NewRow[]; notes?: string }) {
  let id = "";
  let name = "";
  const create: Step = {
    label: first.label,
    async run() {
      const r = (await first.run()) as { id: string; name: string };
      id = r.id;
      name = r.name;
      return r;
    },
  };
  return runSteps([create, ...sheetSteps(s, () => id, input)]).then((r) => ({
    campaign: s.campaign,
    creature: { id, name },
    ...r,
  }));
}

// ---- plan checks (FR-AGENT-19) ----

/** Rows added per list by one call. */
function rowCounts(rows: readonly NewRow[] = []) {
  const n = new Map<SheetRowList, number>();
  for (const r of rows) n.set(r.list, (n.get(r.list) ?? 0) + 1);
  return n;
}

function planNew(ctx: PlanContext, counts: Map<SheetRowList, number>) {
  for (const [list, n] of counts) ctx.planRows(`planned:${ctx.call}`, list, n, ["rows"]);
}

/** An AgentError's issues (or its message) as plan issues; anything else is rethrown. */
function reportInvalid(ctx: PlanContext, err: unknown) {
  if (!(err instanceof AgentError) || err.code !== "invalid") throw err;
  if (!err.issues?.length) ctx.issue([], err.message);
  for (const i of err.issues ?? []) ctx.issue(i.path, i.message);
}

const extrasOf = (input: { rows?: NewRow[]; notes?: string }) => {
  const parts = [
    input.rows?.length ? `+${input.rows.length} row${input.rows.length === 1 ? "" : "s"}` : "",
    input.notes !== undefined ? "notes" : "",
  ].filter(Boolean);
  return parts.length ? ` (${parts.join(", ")})` : "";
};

/** The plan's view of a creature target: a character is an issue (FR-AGENT-24). */
async function planTarget(ctx: PlanContext, id: string, path: Issue["path"]) {
  const e = ctx.world.entities.find((x) => x.id === id);
  if (e?.kind === "character") {
    ctx.issue(path, NOT_A_CREATURE);
    return null;
  }
  return ctx.target(id, path, "monster");
}

// ---- tools ----

const creatureCreate = defineTool({
  name: "creature_create",
  description:
    "Create a custom creature (monster) with its stat block, then add NPC sheet `rows` " +
    "(features ≤ 600 chars, attacks, spells, items) and `notes`. Steps aren't atomic: a later " +
    "failure returns {done, failedAt, error}. Use creature_derive when a base exists.",
  input: CreateInput,
  write: true,
  run: ({ caller }, { rows, notes, ...body }) =>
    caller.ws({ write: true }, (s) =>
      created(
        s,
        {
          label: { step: "create", name: body.name },
          async run() {
            const r = await caller.rest(
              "POST /api/entities",
              { body: { kind: "monster", ...body }, write: true },
              EntityResponse,
            );
            return { id: r.entity.id, name: r.entity.name };
          },
        },
        { rows, notes },
      ),
    ),
  plan(ctx, input) {
    ctx.claimEntityName("monster", input.name, ["name"]);
    planNew(ctx, rowCounts(input.rows));
    return `creature_create: new custom creature "${input.name}"${extrasOf(input)}`;
  },
});

const creatureDerive = defineTool({
  name: "creature_derive",
  description:
    "Derive a new custom creature from a base: `baseId` (a custom or imported creature id) or " +
    "`entryId` (a compendium monster entry; its traits and actions are copied as features). " +
    "`set` changes stat-block keys of the base (null clears one); then `rows` and `notes` as " +
    "in creature_create. Steps aren't atomic: a later failure returns {done, failedAt, error}.",
  input: DeriveInput,
  write: true,
  run: ({ caller }, input) =>
    caller.ws({ write: true }, async (s) => {
      const first: Step =
        input.baseId !== undefined
          ? {
              label: { step: "create", name: input.name, baseId: input.baseId },
              async run() {
                const body = deriveBody(await definitionIn(s, input.baseId as string), input);
                const r = await caller.rest(
                  "POST /api/entities",
                  { body, write: true },
                  EntityResponse,
                );
                return { id: r.entity.id, name: r.entity.name };
              },
            }
          : {
              label: { step: "create", name: input.name, entryId: input.entryId },
              async run() {
                const entry = await caller.rest(
                  "GET /api/compendium/entries/:id",
                  { id: input.entryId },
                  EntryResponse,
                );
                const r = await caller.rest(
                  "POST /api/compendium/derive-monster",
                  { body: deriveEntryBody(entry, input), write: true },
                  DeriveMonsterResponse,
                );
                return { id: r.entity.id, name: r.entity.name };
              },
            };
      return created(s, first, input);
    }),
  async plan(ctx, input) {
    ctx.claimEntityName("monster", input.name, ["name"]);
    const counts = rowCounts(input.rows);
    let from = "";
    try {
      if (input.baseId !== undefined) {
        const e = ctx.world.entities.find((x) => x.id === input.baseId);
        const base = e ?? (await ctx.world.imported(input.baseId));
        if (!base) {
          ctx.issue(["baseId"], `No creature ${input.baseId}`);
        } else if (base.kind !== "monster") {
          ctx.issue(["baseId"], `Not a creature: ${base.name} is a character`);
        } else {
          from = ` from ${base.name}`;
          const body = deriveBody(base, input);
          const attacks = counts.get("attacks") ?? 0;
          if (attacks > 0) counts.set("attacks", attacks + body.statBlock.attacks.length);
        }
      } else if (input.entryId !== undefined) {
        const entry = await ctx.caller
          .rest("GET /api/compendium/entries/:id", { id: input.entryId }, EntryResponse)
          .catch((err: unknown) => {
            if (err instanceof AgentError && err.code === "not_found") return null;
            throw err;
          });
        if (!entry) {
          ctx.issue(["entryId"], `No compendium entry ${input.entryId}`);
        } else {
          from = ` from ${entry.entry.name}`;
          const { entity } = deriveEntryBody(entry, input);
          const copied = copiedFeatures(entry, entity.statBlock.attacks);
          if (copied > 0) counts.set("features", (counts.get("features") ?? 0) + copied);
          const attacks = counts.get("attacks") ?? 0;
          if (attacks > 0) counts.set("attacks", attacks + entity.statBlock.attacks.length);
        }
      }
    } catch (err) {
      reportInvalid(ctx, err);
    }
    planNew(ctx, counts);
    const keys = Object.keys(input.set ?? {});
    const set = keys.length ? `, set ${keys.join(", ")}` : "";
    return `creature_derive: new custom creature "${input.name}"${from}${set}${extrasOf(input)}`;
  },
});

/** `set` split by where each key goes (FR-AGENT-22). */
function splitSet(set: EditInput["set"]) {
  const edit: Record<string, unknown> = {};
  const put: PutSet = {};
  for (const [k, v] of Object.entries(set)) {
    if ((PUT_KEYS as string[]).includes(k)) Object.assign(put, { [k]: v });
    else edit[k] = v;
  }
  return { edit, put };
}

const creatureEdit = defineTool({
  name: "creature_edit",
  description:
    "Edit a custom creature: `set` takes the sheet's keys (name, cr, size, ac, hpMax, " +
    "initBonus, speed, abilities, saveProficiencies, skills, overrides, spellcasting, senses, " +
    "portraitAssetId, notes, …; null clears an optional one) plus type, hpFormula, tokenShape. " +
    "Unchanged fields are kept (a pet keeps its owner). Two steps (sheet edit, then definition " +
    "PUT) aren't atomic: a later failure returns {done, failedAt, error}.",
  input: EditInput,
  write: true,
  run: ({ caller }, { id, set }) =>
    caller.ws({ write: true }, async (s) => {
      if (entityIn(s, id)?.kind === "character") throw new AgentError("invalid", NOT_A_CREATURE);
      const { edit, put } = splitSet(set);
      const steps: Step[] = [];
      if (Object.keys(edit).length > 0) {
        steps.push({
          label: { step: "char.edit", keys: Object.keys(edit) },
          async run() {
            await s.intent(CHARX_INTENTS.edit, { creatureId: id, set: edit });
            return undefined;
          },
        });
      }
      if (Object.keys(put).length > 0) {
        steps.push({
          label: { step: "PUT /api/entities/:id", keys: Object.keys(put) },
          async run() {
            // After char.edit: its changes are in the session's records (FR-AGENT-17).
            const body = putBody(await definitionIn(s, id), put);
            await caller.rest("PUT /api/entities/:id", { id, body, write: true }, EntityResponse);
            return undefined;
          },
        });
      }
      const r = await runSteps(steps);
      return { campaign: s.campaign, creature: { id, name: entityIn(s, id)?.name ?? null }, ...r };
    }),
  async plan(ctx, { id, set }) {
    const e = await planTarget(ctx, id, ["id"]);
    const keys = Object.keys(set);
    for (const k of keys) {
      if ((CHARACTER_ONLY_FIELDS as readonly string[]).includes(k)) {
        ctx.issue(["set", k], "Characters only: not a creature key");
      }
    }
    if (e && e.kind === "monster") {
      if (set.name !== undefined) {
        const others = ctx.world.entities.filter((x) => x.kind === "monster" && x.id !== id);
        ctx.claimName(
          "entity:monster",
          set.name,
          ["set", "name"],
          others.map((x) => x.name),
        );
      }
      const { put } = splitSet(set);
      if (Object.keys(put).length > 0) {
        try {
          parseBody(MonsterStatBlockSchema, applyBlock(e.statBlock, put), {});
        } catch (err) {
          if (!(err instanceof AgentError) || !err.issues) throw err;
          for (const i of err.issues) ctx.issue(["set", ...i.path], i.message);
        }
      }
    }
    return `creature_edit: ${e?.name ?? id}, set ${keys.join(", ")}`;
  },
});

const creaturePutRow = defineTool({
  name: "creature_put_row",
  description:
    "Add (no row `id`) or replace (with the row's `id`) one row on a custom creature's NPC " +
    "sheet: list attacks, spells, features (text ≤ 600) or items.",
  input: PutRowInput,
  write: true,
  run: ({ caller }, input) =>
    caller.ws({ write: true }, async (s) => {
      if (entityIn(s, input.creatureId)?.kind === "character") {
        throw new AgentError("invalid", NOT_A_CREATURE);
      }
      const r = CharPutRowResult.parse(await s.intent(CHARX_INTENTS.putRow, input));
      return { campaign: s.campaign, creatureId: input.creatureId, list: input.list, ...r };
    }),
  async plan(ctx, input) {
    const e = await planTarget(ctx, input.creatureId, ["creatureId"]);
    const rowId = input.row.id;
    if (e && rowId !== undefined) {
      const sheet = ctx.world.sheets.find((x) => x.id === e.id);
      const rows: readonly { id?: string }[] =
        input.list === "attacks" ? e.statBlock.attacks : (sheet?.[input.list] ?? []);
      if (!rows.some((r) => r.id === rowId)) {
        ctx.issue(["row", "id"], `No ${input.list} row ${rowId} on ${e.name}`);
      }
    } else if (e) {
      ctx.planRows(e.id, input.list, 1, ["row"]);
    }
    const what = rowId === undefined ? "add" : "replace";
    return `creature_put_row: ${what} ${input.list} row "${input.row.name}" on ${e?.name ?? input.creatureId}`;
  },
});

registerTools(creatureCreate, creatureDerive, creatureEdit, creaturePutRow);
