// Character tools (AGENT §9, slice 4, FR-AGENT-27/28): sheet edits and rows on a player character
// over `char.edit` / `char.putRow`, with the DM's authority (locked sheets, drafts: FR-CHARX-12).
// The owner never changes here (FR-AGENT-14); players get what the form would send them.
import {
  CHARX_INTENTS,
  CharEditSet,
  CharPutRowIntent,
  CharPutRowResult,
} from "@shared/character-sheet/sheet";
import {
  ENTITY_TYPE,
  type EntityRecord,
  EntityRecord as EntitySchema,
} from "@shared/entities/schemas";
import { SheetRowList } from "@shared/events/character-sheet";
import { z } from "zod";
import type { WsSession } from "../client";
import { AgentError } from "../errors";
import type { PlanContext } from "../plan";
import { defineTool, registerTools } from "./registry";

export const NOT_A_CHARACTER = "Not a character: use creature_edit / creature_put_row";
export const OWNER_FIXED = "The owner can't change here: the DM reassigns it in the DM client";
export const NO_CR = "Characters have no CR";
export const CLASS_ROWS = "Level and class come from the class rows: set classes";

const RecordId = z.string().min(1).max(64);

/** FR-AGENT-27: `CharEditSet` minus `ownerPlayerId` (named in the refusal, not just "unknown"). */
export const CharacterSet = z
  .strictObject(CharEditSet.omit({ ownerPlayerId: true }).shape, {
    error: (iss) =>
      iss.code === "unrecognized_keys" && iss.keys.includes("ownerPlayerId")
        ? OWNER_FIXED
        : undefined,
  })
  .refine((s) => Object.keys(s).length > 0, { message: "Nothing to change" });
export const CharacterEditInput = z.strictObject({ id: RecordId, set: CharacterSet });
export type CharacterEditInput = z.output<typeof CharacterEditInput>;

const rowSchemas = CharPutRowIntent.options.map((o) => {
  const { $schema: _drop, ...row } = z.toJSONSchema(o.shape.row, {
    io: "input",
    unrepresentable: "any",
  }) as Record<string, unknown>;
  return row;
});

/**
 * FR-AGENT-28: `CharPutRowIntent`, listed as one flat object (a top-level `oneOf` isn't a valid
 * tool schema for the model): `row` shows the four row shapes; the pipe validates by `list`.
 */
export const PutRowInput = z
  .strictObject({
    creatureId: CharPutRowIntent.options[0].shape.creatureId,
    list: SheetRowList,
    row: z.unknown().meta({
      description: "The row for `list`; no `id` adds it, the row's `id` replaces that row",
      anyOf: rowSchemas,
    }),
  })
  .pipe(CharPutRowIntent);
export type PutRowInput = z.output<typeof PutRowInput>;

const entityIn = (s: WsSession, id: string): EntityRecord | undefined =>
  s.records(ENTITY_TYPE, EntitySchema).find((e) => e.id === id);

/** A custom monster in the snapshot → `invalid`; unknown / imported → the server's answer. */
function characterOrServer(s: WsSession, id: string): EntityRecord | undefined {
  const e = entityIn(s, id);
  if (e?.kind === "monster") throw new AgentError("invalid", NOT_A_CHARACTER);
  return e;
}

/** Plan side: the target is a campaign character; null (with an issue) otherwise. */
async function planCharacter(ctx: PlanContext, id: string, path: (string | number)[]) {
  const e = await ctx.target(id, path, "character");
  return e?.kind === "character" ? e : null;
}

const characterEdit = defineTool({
  name: "character_edit",
  description:
    "Edit a player character's sheet by id: `set` holds only what changes (name, species, " +
    "background, alignment, classes, level, className, ac, hpMax, initBonus, speed, abilities, " +
    "saveProficiencies, skills, overrides, proficiencyNotes, spellcasting, notes, size, " +
    "portraitAssetId, senses; null clears an optional one). DM authority: locked sheets and " +
    "drafts too. The owner can't change here.",
  input: CharacterEditInput,
  write: true,
  run: ({ caller }, { id, set }) =>
    caller.ws({ write: true }, async (s) => {
      const before = characterOrServer(s, id);
      await s.intent(CHARX_INTENTS.edit, { creatureId: id, set });
      return {
        campaign: s.campaign,
        character: { id, name: set.name ?? before?.name ?? null },
        changed: Object.keys(set),
      };
    }),
  async plan(ctx, { id, set }) {
    const e = await planCharacter(ctx, id, ["id"]);
    const keys = Object.keys(set);
    if (set.cr !== undefined) ctx.issue(["set", "cr"], NO_CR);
    if (e) {
      if (set.name !== undefined) {
        const others = ctx.world.entities.filter((x) => x.kind === "character" && x.id !== id);
        ctx.claimName(
          "entity:character",
          set.name,
          ["set", "name"],
          others.map((x) => x.name),
        );
      }
      const classes = set.classes === undefined ? e.statBlock.classes : set.classes;
      for (const k of ["level", "className"] as const) {
        if (set[k] !== undefined && classes != null) ctx.issue(["set", k], CLASS_ROWS);
      }
    }
    return `character_edit: ${e?.name ?? id}, set ${keys.join(", ")}`;
  },
});

const characterPutRow = defineTool({
  name: "character_put_row",
  description:
    "Add (no row `id`) or replace (with the row's `id`) one row on a player character's sheet: " +
    "list attacks, spells, features (text ≤ 600) or items. DM authority: locked sheets too. " +
    "The owner sees it live; other players never see sheet rows.",
  input: PutRowInput,
  write: true,
  run: ({ caller }, input) =>
    caller.ws({ write: true }, async (s) => {
      characterOrServer(s, input.creatureId);
      const r = CharPutRowResult.parse(await s.intent(CHARX_INTENTS.putRow, input));
      return { campaign: s.campaign, creatureId: input.creatureId, list: input.list, ...r };
    }),
  async plan(ctx, input) {
    const e = await planCharacter(ctx, input.creatureId, ["creatureId"]);
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
    return `character_put_row: ${what} ${input.list} row "${input.row.name}" on ${e?.name ?? input.creatureId}`;
  },
});

registerTools(characterEdit, characterPutRow);
