// SP1's search providers (FR-SHELL-187, -188): characters and creatures from the synced store
// (already filtered per viewer server-side), compendium and rule rows from compendium search
// (FR-CMP-10, the viewer's visibility FR-CMP-14). Rows open what a click opens elsewhere.
import { HOMEBREW_LABEL } from "@shared/compendium/rest";
import { ENTITY_TYPE, isPet } from "@shared/entities/schemas";
import { type RecordStore, recordsOf } from "@shared/protocol/store";
import { BookOpenIcon, PawPrintIcon, SkullIcon, UserIcon } from "lucide-react";
import type { Api } from "../../../api";
import { pageApi } from "../../../session";
import { selectCompanion } from "../../character-sheet/companion/picker";
import { openSheetFor } from "../../character-sheet/selection";
import { CHAR_SHEET_KIND } from "../../character-sheet/window";
import { COMPANION_CARD_KIND } from "../../combat-tracker/companion-card-request";
import { CMP_KIND, isEntryless } from "../../compendium/logic";
import { openDefinition, openEntry } from "../../compendium/nav";
import { eagerApi, searchCompendium } from "../../compendium/search";
import { charactersOf } from "./launch";
import { GROUP_MAX, type PaletteItem, type SearchHit, type SearchProvider } from "./types";

interface EntityLike {
  id: string;
  kind: string;
  name: string;
  ownerPlayerId?: string | null;
  companionOf?: string | null;
}

const entities = (store: RecordStore) => recordsOf<EntityLike>(store, ENTITY_TYPE);

/** FR-SHELL-187: DM every campaign character; a player only their own. → the sheet. */
function characterItems(store: RecordStore): PaletteItem[] {
  return charactersOf(store).map((c) => ({
    id: c.id,
    title: c.name,
    hint: "Character",
    icon: UserIcon,
    run(ctx) {
      openSheetFor(c.id, "character");
      ctx.shell.openWindow(CHAR_SHEET_KIND);
    },
  }));
}

/**
 * FR-SHELL-187: companions (pets) → the companion card: DM every pet, a player their own. Listed
 * with the characters; a player sees no other player's.
 */
function companionItems(store: RecordStore): PaletteItem[] {
  const you = store.you;
  const all = entities(store);
  const nameOf = (id: string | null | undefined) => all.find((e) => e.id === id)?.name ?? "—";
  return all
    .filter((e) => isPet(e) && (you?.role !== "player" || e.ownerPlayerId === you.playerId))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({
      id: p.id,
      title: p.name,
      hint: `${nameOf(p.companionOf)}'s pet`,
      icon: PawPrintIcon,
      run(ctx) {
        if (!ctx.registry.get(COMPANION_CARD_KIND)) return;
        selectCompanion(p.id);
        ctx.shell.openWindow(COMPANION_CARD_KIND);
      },
    }));
}

/** FR-SHELL-187 (DM): custom creature definitions (not pets) → the NPC sheet. */
function creatureItems(store: RecordStore): PaletteItem[] {
  return entities(store)
    .filter((e) => e.kind === "monster" && !isPet(e))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => ({
      id: e.id,
      title: e.name,
      hint: "Creature",
      icon: SkullIcon,
      run(ctx) {
        openSheetFor(e.id, "monster");
        ctx.shell.openWindow(CHAR_SHEET_KIND);
      },
    }));
}

// ---- compendium search (FR-SHELL-188) ----

/** The REST client with this page's credential (the session helper, BL-94). */
export const compendiumApi = (role: "dm" | "player"): Api => pageApi(role);

/** One server summary as the palette uses it. */
export interface Summary {
  id: string;
  kind: string;
  name: string;
  line: string;
  sourceLabel: string;
  definitionId?: string;
}

/**
 * FR-SHELL-188: the Compendium group, ≤ 8, server order kept. `rule` entries are left out: the
 * Rules group is SP2's provider (`compendium/rules/palette.ts`, `kind=rule`, opening the Rules
 * window on the card via `openRules`). A compendium row opens `cmp.compendium` on that entry (an
 * entryless monster on its definition, FR-CMP-17).
 */
export function compendiumHits(results: readonly Summary[]): SearchHit[] {
  const out: SearchHit[] = [];
  for (const r of results) {
    if (r.kind === "rule" || out.length >= GROUP_MAX) continue;
    const hint = r.sourceLabel === HOMEBREW_LABEL ? `${r.line} · Homebrew` : r.line;
    out.push({
      id: r.id,
      group: "Compendium",
      title: r.name,
      hint,
      kind: r.kind,
      icon: BookOpenIcon,
      run(ctx) {
        if (isEntryless(r) && r.definitionId) openDefinition(r.definitionId);
        else openEntry(r.id);
        ctx.shell.openWindow(CMP_KIND);
      },
    });
  }
  return out;
}

/** SP1's providers (appended to `commands.ts` as one list). */
export const SP1_PROVIDERS: readonly SearchProvider[] = [
  {
    id: "characters",
    group: "Characters",
    clients: ["dm", "player"],
    at: true,
    items: (ctx) => [...characterItems(ctx.store), ...companionItems(ctx.store)],
  },
  {
    id: "creatures",
    group: "Creatures",
    clients: ["dm"],
    at: true,
    items: (ctx) => creatureItems(ctx.store),
  },
  {
    id: "compendium",
    group: "Compendium",
    clients: ["dm", "player"],
    async search(q, ctx) {
      const page = await searchCompendium(eagerApi(compendiumApi(ctx.client)), { q });
      return compendiumHits(page.results);
    },
  },
];
