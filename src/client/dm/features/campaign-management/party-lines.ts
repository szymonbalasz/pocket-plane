// Party at a glance (FR-CAMP-21/22, N3): per player, one line per owned `character` from the
// DM's store. Pure view model (plus the line's click): level, AC, HP max stored; passives derived
// by entities' helpers (overrides honoured, ADR-0036); temp HP read from `entity.tempHp` (CBTX).
import {
  type Abilities,
  isOverridden,
  type Overrides,
  PASSIVE_SKILLS,
  type PassiveSkill,
  passiveScore,
  type Skills,
} from "@shared/entities/schemas";
import { openSheetFor } from "@ui/features/character-sheet/selection";
import { CHAR_SHEET_KIND } from "@ui/features/character-sheet/window";

/** The `entity` fields read (the DM store holds full records; parsed loosely, old data ok). */
export interface PartyCharacter {
  id: string;
  kind: string;
  name: string;
  ownerPlayerId?: string | null;
  hpCurrent?: number;
  tempHp?: number;
  statBlock?: {
    level?: number;
    ac?: number;
    hpMax?: number;
    abilities?: Abilities;
    skills?: Skills;
    overrides?: Overrides;
  };
}

export interface PassiveCell {
  skill: PassiveSkill;
  /** "PP" / "Inv" / "Ins". */
  short: string;
  /** "Passive Perception" … */
  name: string;
  /** null = no ability scores ("—"). */
  value: number | null;
  overridden: boolean;
}

export interface PartyLine {
  id: string;
  name: string;
  draft: boolean;
  level: number | null;
  ac: number | null;
  hpCurrent: number;
  hpMax: number | null;
  temp: number;
  down: boolean;
  passives: PassiveCell[];
}

const PASSIVE_LABELS: Record<PassiveSkill, [string, string]> = {
  perception: ["PP", "Passive Perception"],
  investigation: ["Inv", "Passive Investigation"],
  insight: ["Ins", "Passive Insight"],
};

/** FR-CHAR-02 order: name (case-insensitive), then id. */
const byName = (a: { id: string; name: string }, b: { id: string; name: string }) => {
  const ka = a.name.toLowerCase();
  const kb = b.name.toLowerCase();
  if (ka !== kb) return ka < kb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

export function partyLine(c: PartyCharacter, draft: boolean): PartyLine {
  const sb = c.statBlock ?? {};
  const stats = { ...sb, level: sb.level ?? 1 };
  const hpCurrent = c.hpCurrent ?? 0;
  return {
    id: c.id,
    name: c.name,
    draft,
    level: sb.level ?? null,
    ac: sb.ac ?? null,
    hpCurrent,
    hpMax: sb.hpMax ?? null,
    temp: Math.max(0, c.tempHp ?? 0),
    down: hpCurrent <= 0,
    passives: PASSIVE_SKILLS.map((skill) => {
      const [short, name] = PASSIVE_LABELS[skill];
      const value = sb.abilities ? passiveScore(stats, skill) : null;
      return {
        skill,
        short,
        name,
        value,
        overridden: value !== null && isOverridden(stats, `passive.${skill}`),
      };
    }),
  };
}

/**
 * FR-CAMP-21: lines per owner player id, each sorted by name. `drafts` = ids of characters whose
 * `creature-sheet` is a draft. Non-character entities and unowned ones are skipped.
 */
export function partyLines(
  entities: readonly PartyCharacter[],
  drafts: ReadonlySet<string>,
): Map<string, PartyLine[]> {
  const out = new Map<string, PartyLine[]>();
  const chars = entities.filter((e) => e.kind === "character" && e.ownerPlayerId).sort(byName);
  for (const c of chars) {
    const owner = c.ownerPlayerId as string;
    out.set(owner, [...(out.get(owner) ?? []), partyLine(c, drafts.has(c.id))]);
  }
  return out;
}

/** "HP 12 / 12", plus " +2 temp" when temp HP > 0 (FR-CAMP-21). */
export function hpText(l: Pick<PartyLine, "hpCurrent" | "hpMax">): string {
  return `${l.hpCurrent} / ${l.hpMax ?? "—"}`;
}

export const tempText = (temp: number) => (temp > 0 ? `+${temp} temp` : null);

/** Tooltip on PP / Inv / Ins: the full name, and "override" when overridden. */
export const passiveTitle = (p: PassiveCell) => (p.overridden ? `${p.name} (override)` : p.name);

/** FR-CAMP-22: a line click opens the DM's `char.sheet` on it (front); no intent. */
export function openPartyLine(id: string, openWindow: (kind: string) => void) {
  openSheetFor(id, "character");
  openWindow(CHAR_SHEET_KIND);
}
