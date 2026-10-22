// Macros, client side (FR-DICEX-68–72): the popover's and sheet tab's groups, who may edit a
// row, whether it rolls now (and why not), the `dice.roll` it sends, and the editor's checks.
// Pure; the components in `MacroButton.tsx` / `MacrosPanel.tsx` render them.
import {
  MacroExpression,
  MacroName,
  type RollMacroRecord,
  type SaveMacroInput,
} from "@shared/dice-extras/macros";
import type { DiceRollIntent, RollCategory } from "@shared/dice-roll-log/schemas";
import type { RollRequest } from "../dice-roll-log/roll-control";

export interface MacroViewer {
  role: "dm" | "player";
  playerId: string | null;
}

/** The entity fields macros read (players hold every character, FR-ENT-15). */
export interface MacroCreature {
  id: string;
  name: string;
  kind: string;
  ownerPlayerId?: string | null;
}

export interface MacroGroup {
  key: string;
  title: string;
  /** The roll-as creature of the group's "+ New macro"; null = "Me" / "DM". */
  creatureId: string | null;
  macros: RollMacroRecord[];
}

const byOrder = (a: RollMacroRecord, b: RollMacroRecord) =>
  (a.playerId ?? "").localeCompare(b.playerId ?? "") || a.order - b.order;

/**
 * FR-DICEX-69, -72: "‹actor›" first (the tray's or sheet's creature), then the other creatures
 * by name, then "General" (rows on no creature, or on a gone one). The DM's general rows of a
 * player read "General · ‹player›".
 */
export function macroGroups(
  macros: readonly RollMacroRecord[],
  viewer: MacroViewer,
  creatures: readonly MacroCreature[],
  players: readonly { id: string; name: string }[] = [],
  actorId: string | null = null,
): MacroGroup[] {
  const byId = new Map(creatures.map((c) => [c.id, c]));
  const groups = new Map<string, MacroGroup>();
  const add = (key: string, title: string, creatureId: string | null, m: RollMacroRecord) => {
    const g = groups.get(key) ?? { key, title, creatureId, macros: [] };
    g.macros.push(m);
    groups.set(key, g);
  };
  for (const m of macros) {
    const c = m.creatureId ? byId.get(m.creatureId) : undefined;
    if (c) add(`c:${c.id}`, c.name, c.id, m);
    else if (viewer.role === "dm" && m.playerId !== null) {
      const who = players.find((p) => p.id === m.playerId)?.name ?? "Player";
      add(`g:${m.playerId}`, `General · ${who}`, null, m);
    } else add("g", "General", null, m);
  }
  for (const g of groups.values()) g.macros.sort(byOrder);
  // The actor, other creatures, "General", then the players' general rows (DM).
  const rank = (g: MacroGroup) =>
    g.creatureId !== null ? (g.creatureId === actorId ? 0 : 1) : g.key === "g" ? 2 : 3;
  const list = [...groups.values()].sort(
    (a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title),
  );
  // The actor's group shows even when empty, so "+ New macro" can preset it.
  const actor = actorId ? byId.get(actorId) : undefined;
  if (actor && !groups.has(`c:${actor.id}`)) {
    list.unshift({ key: `c:${actor.id}`, title: actor.name, creatureId: actor.id, macros: [] });
  }
  return list;
}

/** FR-DICEX-66: the DM edits any row; a player only rows they made (the DM's are read-only). */
export const canEditMacro = (m: Pick<RollMacroRecord, "createdBy">, v: MacroViewer): boolean =>
  v.role === "dm" || (v.playerId !== null && m.createdBy === v.playerId);

export const NOT_LIVE = "Reconnecting…";
export const GONE = "Its creature is gone";
export const NOT_YOURS = "Not your character";

/** FR-DICEX-72: rollable now, else the reason (not live; a gone creature; not the viewer's). */
export function macroBlock(
  m: Pick<RollMacroRecord, "creatureId">,
  v: MacroViewer,
  creatures: readonly MacroCreature[],
  live: boolean,
): string | null {
  if (!live) return NOT_LIVE;
  if (m.creatureId === null) return null;
  const c = creatures.find((x) => x.id === m.creatureId);
  if (!c) return GONE;
  if (v.role === "player" && (c.kind !== "character" || c.ownerPlayerId !== v.playerId)) {
    return NOT_YOURS;
  }
  return null;
}

/** FR-DICEX-68, FR-DICE-81: a macro roll is a plain `dice.roll` (label = name). */
export function macroRollIntent(
  m: Pick<RollMacroRecord, "name" | "expression" | "category" | "creatureId">,
  r: RollRequest,
): DiceRollIntent {
  const intent: DiceRollIntent = {
    expression: m.expression,
    mode: r.mode,
    category: m.category,
    label: m.name,
  };
  if (m.creatureId) intent.actor = { entityId: m.creatureId };
  if (r.manual?.[0]) intent.manual = r.manual[0];
  if (r.public !== undefined) intent.public = r.public;
  return intent;
}

export interface MacroDraft {
  id?: string;
  name: string;
  expression: string;
  category: RollCategory;
  creatureId: string | null;
  dmOnly: boolean;
}

/** FR-DICEX-71: the editor's first problem (Save disabled), or null. */
export function draftError(d: Pick<MacroDraft, "name" | "expression">): string | null {
  const name = MacroName.safeParse(d.name);
  if (!name.success) return name.error.issues[0]?.message ?? "Name is required";
  const expr = MacroExpression.safeParse(d.expression);
  if (!expr.success) return expr.error.issues[0]?.message ?? "Not dice notation";
  return null;
}

/** FR-DICEX-71: "DM only" is the DM's, on an owned PC. */
export const dmOnlyOffered = (v: MacroViewer, c: MacroCreature | undefined): boolean =>
  v.role === "dm" && c?.kind === "character" && !!c.ownerPlayerId;

/** The `dicex.saveMacro` input of a draft (`dmOnly` only where offered). */
export function saveInput(d: MacroDraft, offered: boolean): SaveMacroInput {
  return {
    ...(d.id ? { id: d.id } : {}),
    name: d.name,
    expression: d.expression,
    category: d.category,
    creatureId: d.creatureId,
    ...(offered ? { dmOnly: d.dmOnly } : {}),
  };
}

/** A draft from a row (✎) or a preset (+ New macro / Save as macro). */
export function draftOf(
  m: Partial<
    Pick<RollMacroRecord, "id" | "name" | "expression" | "category" | "creatureId" | "playerId">
  >,
): MacroDraft {
  return {
    ...(m.id ? { id: m.id } : {}),
    name: m.name ?? "",
    expression: m.expression ?? "",
    category: m.category ?? "other",
    creatureId: m.creatureId ?? null,
    dmOnly: m.id !== undefined && m.playerId === null,
  };
}
