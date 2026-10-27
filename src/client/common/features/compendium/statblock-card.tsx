// Kit parity FR-KIT-77 (K4): the stat block card's parts, the kit's "Goblin" card: the italic type
// line, one ruled core row "AC · HP · Speed", the six-column ability grid (label, score, signed
// modifier) and the entry rows (name + muted line). One markup for every theme (FR-KIT-01):
// Simple Dark draws it with the plain tokens, Gilt & Stone styles the `statblock*` slots
// (ADR-0069). The compendium's `StatBlock` uses them; K7's `ent.statblock` window reuses them with
// its own test IDs, roll buttons in the grid and attack rows (FR-KIT-103).
import { ABILITIES, type Ability, abilityMod } from "@shared/entities/schemas";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { signed } from "./logic";

export const ABILITY_SHORT: Readonly<Record<Ability, string>> = {
  str: "STR",
  dex: "DEX",
  con: "CON",
  int: "INT",
  wis: "WIS",
  cha: "CHA",
};

/** The card: a column of the parts below (`data-slot="statblock"`). */
export function StatBlockCard({
  children,
  className,
  ...props
}: { children: ReactNode; className?: string } & Record<`data-${string}`, string | undefined>) {
  return (
    <div data-slot="statblock" className={cn("space-y-2 text-sm", className)} {...props}>
      {children}
    </div>
  );
}

/** A label in the card ("AC", "Speed", "STR", "Saving Throws"): label type under a theme. */
export function StatLabel({ children }: { children: ReactNode }) {
  return (
    <span data-slot="statblock-label" className="font-semibold">
      {children}
    </span>
  );
}

/** The italic type line ("Small humanoid (goblinoid), neutral evil"). */
export function StatBlockTypeLine({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p data-testid={testId} className="text-sm italic text-muted-foreground">
      {children}
    </p>
  );
}

/** One ruled row: "AC 15 (note) · HP 7 (2d6) · Speed 30 ft". `hp` may be an HP bar (K7). */
export function StatBlockCore({
  ac,
  acNote,
  hp,
  speed,
  testId,
}: {
  ac: ReactNode;
  acNote?: string;
  hp: ReactNode;
  speed: ReactNode;
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      data-slot="statblock-core"
      className="flex flex-wrap items-baseline gap-x-3.5 gap-y-0.5 border-t py-1.5"
    >
      <span>
        <StatLabel>AC</StatLabel> <span className="tabular-nums">{ac}</span>
        {acNote && <span className="text-muted-foreground"> ({acNote})</span>}
      </span>
      <span className="flex min-w-0 items-baseline gap-1">
        <StatLabel>HP</StatLabel> {hp}
      </span>
      <span>
        <StatLabel>Speed</StatLabel> <span className="tabular-nums">{speed}</span>
      </span>
    </div>
  );
}

/**
 * The six-column ability grid: label, score, signed modifier. `mod` replaces a modifier (K7: its
 * Check button), `below` adds a line under it (K7: "Save +n").
 */
export function StatBlockAbilities({
  abilities,
  testId,
  cellTestId,
  mod,
  below,
}: {
  abilities: Readonly<Record<Ability, number>>;
  testId: string;
  cellTestId: string;
  mod?: (a: Ability, text: string) => ReactNode;
  below?: (a: Ability) => ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      data-slot="statblock-abilities"
      className="grid grid-cols-6 gap-1 border-y py-1.5 text-center"
    >
      {ABILITIES.map((a) => {
        const text = signed(abilityMod(abilities[a]));
        return (
          <div key={a} data-testid={cellTestId} data-value={a} className="flex flex-col">
            <span className="text-xs">
              <StatLabel>{ABILITY_SHORT[a]}</StatLabel>
            </span>
            <b data-slot="statblock-score" className="font-bold tabular-nums">
              {abilities[a]}
            </b>
            {mod ? (
              mod(a, text)
            ) : (
              <small className="text-xs text-muted-foreground tabular-nums">{text}</small>
            )}
            {below?.(a)}
          </div>
        );
      })}
    </div>
  );
}

/**
 * An entry row: the name, then its muted line (a trait's or action's text); `actions` under it
 * (K7: Attack / Damage / Attack + damage). `slot` = `statblock-entry`, or `statblock-attack` for
 * a rollable attack row.
 */
export function StatBlockEntry({
  name,
  children,
  actions,
  slot = "statblock-entry",
  ...props
}: {
  name: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  slot?: "statblock-entry" | "statblock-attack";
} & Record<`data-${string}`, string | undefined>) {
  return (
    <div data-slot={slot} className="py-0.5" {...props}>
      <div data-slot="statblock-entry-name" className="font-semibold">
        {name}
      </div>
      {children && <div className="text-muted-foreground">{children}</div>}
      {actions && <div className="mt-1.5 flex flex-wrap gap-1.5">{actions}</div>}
    </div>
  );
}
