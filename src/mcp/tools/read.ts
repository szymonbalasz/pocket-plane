// Read tools (AGENT §9, slice 1): campaigns, players, characters, custom creatures, compendium.
// DM view; records in their `@shared` wire shapes; never a link token (FR-AGENT-12/13).
import { CampaignSummary, PlayerRecord } from "@shared/campaign-management/schemas";
import { CREATURE_SHEET_TYPE, CreatureSheetRecord } from "@shared/character-sheet/sheet";
import { EntryResponse, SEARCH_Q_MAX, SearchQuery, SearchResponse } from "@shared/compendium/rest";
import {
  ENTITY_TYPE,
  EntityRecord,
  entityNameKey,
  IMPORTED_ENTITY_TYPE,
  ImportedEntityRecord,
} from "@shared/entities/schemas";
import { PresenceRecord } from "@shared/live-sync/schemas";
import { nameTier, queryWords } from "@shared/search/match";
import { z } from "zod";
import type { WsSession } from "../client";
import { AgentError } from "../errors";
import { defineTool, registerTools } from "./registry";

/** FR-AGENT-12: summaries per page. */
export const LIST_PAGE = 50;

const RecordId = z.string().min(1).max(64);
const IdInput = z.strictObject({ id: RecordId });
export const ListInput = z.strictObject({
  q: z.string().max(SEARCH_Q_MAX).optional(),
  /** Opaque: the previous page's `nextCursor`. */
  cursor: z
    .string()
    .regex(/^[0-9]{1,6}$/, "Use the nextCursor of the previous page")
    .optional(),
});
export type ListInput = z.infer<typeof ListInput>;

/**
 * FR-AGENT-12: the shared matcher's name tiers (as the Creatures window filter), then name, id;
 * no `q` lists by name. ≤ 50 per page.
 */
export function page<T extends { id: string; name: string }>(rows: readonly T[], input: ListInput) {
  const words = queryWords(input.q ?? "");
  const ranked = rows
    .map((r) => ({ r, tier: words.length === 0 ? 0 : nameTier(r.name, words) }))
    .filter((x) => x.tier !== null)
    .sort(
      (a, b) =>
        (a.tier as number) - (b.tier as number) ||
        entityNameKey(a.r.name).localeCompare(entityNameKey(b.r.name)) ||
        a.r.id.localeCompare(b.r.id),
    );
  const from = Number(input.cursor ?? "0");
  const items = ranked.slice(from, from + LIST_PAGE).map((x) => x.r);
  const next = from + LIST_PAGE;
  return { items, nextCursor: next < ranked.length ? String(next) : null };
}

const entities = (s: WsSession) => s.records(ENTITY_TYPE, EntityRecord);
const sheetOf = (s: WsSession, id: string) =>
  s.records(CREATURE_SHEET_TYPE, CreatureSheetRecord).find((r) => r.id === id) ?? null;

const campaignsList = defineTool({
  name: "campaigns_list",
  description: "List the DM's campaigns ({id, name, active}). Tools act in the active one.",
  input: z.strictObject({}),
  write: false,
  run: async ({ caller }) =>
    caller.rest("GET /api/campaigns", {}, z.object({ campaigns: z.array(CampaignSummary) })),
});

const playersList = defineTool({
  name: "players_list",
  description:
    "List the active campaign's players with their colour and whether they're online now.",
  input: z.strictObject({}),
  write: false,
  run: ({ caller }) =>
    caller.ws({}, async (s) => {
      const online = new Map(s.records("presence", PresenceRecord).map((p) => [p.playerId, p]));
      return {
        campaign: s.campaign,
        players: s.records("player", PlayerRecord).map((p) => ({
          id: p.id,
          name: p.name,
          color: p.color,
          online: online.get(p.id)?.online ?? false,
        })),
      };
    }),
});

const charactersList = defineTool({
  name: "characters_list",
  description:
    "List the active campaign's player characters (id, name, owner, level, class, species). " +
    "`q` filters by name; pass `nextCursor` back as `cursor` for the next 50.",
  input: ListInput,
  write: false,
  run: ({ caller }, input) =>
    caller.ws({}, async (s) => {
      const chars = entities(s).filter((e) => e.kind === "character");
      const { items, nextCursor } = page(chars, input);
      return {
        campaign: s.campaign,
        characters: items.map((c) => ({
          id: c.id,
          name: c.name,
          ownerPlayerId: c.ownerPlayerId,
          level: c.statBlock.level,
          className: c.statBlock.className,
          species: c.statBlock.species ?? null,
        })),
        nextCursor,
      };
    }),
});

const characterGet = defineTool({
  name: "character_get",
  description:
    "A player character's full record (stat block) and character sheet (rows, notes), DM view.",
  input: IdInput,
  write: false,
  run: ({ caller }, { id }) =>
    caller.ws({}, async (s) => {
      const e = entities(s).find((x) => x.id === id);
      if (e?.kind === "monster") {
        throw new AgentError("invalid", "Not a character: use creature_get");
      }
      if (!e)
        throw new AgentError("not_found", `No character ${id}: find ids with characters_list`);
      return { campaign: s.campaign, character: e, sheet: sheetOf(s, id) };
    }),
});

const creaturesList = defineTool({
  name: "creatures_list",
  description:
    "List the active campaign's custom creatures, pets included (id, name, CR, type, AC, HP, " +
    "pet owner, derived-from). SRD / imported monsters: use compendium_search (kind monster). " +
    "`q` filters by name; pass `nextCursor` back as `cursor` for the next 50.",
  input: ListInput,
  write: false,
  run: ({ caller }, input) =>
    caller.ws({}, async (s) => {
      const customs = entities(s).filter((e) => e.kind === "monster");
      const { items, nextCursor } = page(customs, input);
      return {
        campaign: s.campaign,
        creatures: items.map((c) => ({
          id: c.id,
          name: c.name,
          cr: c.statBlock.cr,
          type: c.statBlock.type ?? null,
          size: c.statBlock.size,
          ac: c.statBlock.ac,
          hpMax: c.statBlock.hpMax,
          petOf: c.companionOf,
          derivedFromId: c.derivedFromId,
        })),
        nextCursor,
      };
    }),
});

const creatureGet = defineTool({
  name: "creature_get",
  description:
    "A creature's full definition by id: a custom creature (with its NPC sheet) or an imported " +
    "monster definition (`imported: true`, read-only; e.g. a compendium result's definitionId).",
  input: IdInput,
  write: false,
  run: ({ caller }, { id }) =>
    caller.ws({}, async (s) => {
      const e = entities(s).find((x) => x.id === id);
      if (e?.kind === "character") {
        throw new AgentError("invalid", "Not a custom creature: use character_get");
      }
      if (e) return { campaign: s.campaign, creature: e, sheet: sheetOf(s, id), imported: false };
      const [imported] = await s.load(IMPORTED_ENTITY_TYPE, ImportedEntityRecord, [id]);
      if (!imported) {
        throw new AgentError(
          "not_found",
          `No creature ${id}: find ids with creatures_list or compendium_search`,
        );
      }
      return { campaign: s.campaign, creature: imported, sheet: null, imported: true };
    }),
});

const compendiumSearch = defineTool({
  name: "compendium_search",
  description:
    "Search the compendium (SRD and homebrew): monsters, spells, items, conditions, features, " +
    "rules. Filters need `kind` (monster: crMin, crMax, type; spell: level, school, className; " +
    "item: category, rarity; feature: className, subclass; rule: chapter, section). ≤ 50 " +
    "results; pass `nextCursor` back as `cursor`.",
  input: SearchQuery,
  write: false,
  run: ({ caller }, query) =>
    caller.rest(
      "GET /api/compendium/search",
      {
        query: Object.fromEntries(
          Object.entries(query)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => [k, String(v)]),
        ),
      },
      SearchResponse,
    ),
});

const compendiumGet = defineTool({
  name: "compendium_get",
  description:
    "A compendium entry by id: its text, facets and source; a monster also carries its playable " +
    "definition (stat block).",
  input: IdInput,
  write: false,
  run: ({ caller }, { id }) =>
    caller.rest("GET /api/compendium/entries/:id", { id }, EntryResponse),
});

registerTools(
  campaignsList,
  playersList,
  charactersList,
  characterGet,
  creaturesList,
  creatureGet,
  compendiumSearch,
  compendiumGet,
);
