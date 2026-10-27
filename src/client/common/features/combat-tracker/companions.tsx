// Companions in both Initiative windows (sprint 6, #252; FR-CBT-118, -119): which row a companion
// sits in (an `in-owner-turn` one is a line inside its owner's row while it has no rank, an
// `after-owner` one indented under its owner), the owner chip (owner PC's name + its player's
// colour dot) and the mode icon. Display only: the server ranks (FR-CBT-107).
import type { CombatantKind, TurnMode } from "@shared/combat-tracker/schemas";
import { CornerDownRightIcon, DicesIcon, LinkIcon } from "lucide-react";
import { Tooltip } from "../../components/ui/overlays";
import { Badge } from "../../components/ui/primitives";
import { cn } from "../../lib/utils";
import { useColorOf } from "../campaign-management/colors";

/** What the layout reads of a combatant (DM record or player view). */
export interface CompanionRow {
  id: string;
  kind: CombatantKind;
  name: string;
  entityId?: string;
  seq?: number;
  removed?: boolean;
  position?: number | null;
  playerPosition?: number | null;
  initiative?: number | null;
  ownerCharacterId?: string | null;
  ownerPlayerId?: string | null;
  turnMode?: TurnMode | null;
}

/** One Initiative row: the combatant, its companion lines, its owner's row (companions). */
export interface RowLayout<T> {
  c: T;
  /** `in-owner-turn` companions acting in this row's turn (FR-CBT-107: no row of their own). */
  lines: T[];
  /** The owner PC's row, for a companion whose owner is in the list. */
  owner: T | null;
  /** Ranked right after the owner (`after-owner`, or in-turn while the owner can't act). */
  indent: boolean;
}

/** The owner PC's row: the first PC row of the owner character (FR-CBT-107's `ownerRowOf`). */
export function ownerRowIn<T extends CompanionRow>(rows: readonly T[], c: CompanionRow): T | null {
  if (!c.ownerCharacterId) return null;
  return rows.find((r) => r.kind === "pc" && r.entityId === c.ownerCharacterId) ?? null;
}

/**
 * FR-CBT-107 / -118 / -119: rows in the given (rank) order, each `in-owner-turn` companion without
 * a rank (`rank` null: `position` for the DM, `playerPosition` for players) moved into its owner's
 * row as a line (by `seq`, else list order); a companion ranked by its owner is indented. A line
 * whose owner isn't listed stays a row (never lost).
 */
export function companionLayout<T extends CompanionRow>(
  rows: readonly T[],
  rank: "position" | "playerPosition",
): RowLayout<T>[] {
  const lines = new Map<string, T[]>();
  const owners = new Map<string, T | null>();
  const isLine = new Set<string>();
  for (const c of rows) {
    const owner = ownerRowIn(rows, c);
    owners.set(c.id, owner);
    if (owner && !c.removed && c.turnMode === "in-owner-turn" && c[rank] == null) {
      isLine.add(c.id);
      lines.set(owner.id, [...(lines.get(owner.id) ?? []), c]);
    }
  }
  return rows
    .filter((c) => !isLine.has(c.id))
    .map((c) => {
      const owner = owners.get(c.id) ?? null;
      return {
        c,
        lines: [...(lines.get(c.id) ?? [])].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)),
        owner,
        indent: owner !== null && c.turnMode !== "own",
      };
    });
}

/** FR-CBT-118's Tooltip / FR-CBT-108's labels: "After Mira" / "In Mira's turn" / "Own initiative". */
export function modeLabel(mode: TurnMode, ownerName: string): string {
  if (mode === "after-owner") return `After ${ownerName}`;
  if (mode === "in-owner-turn") return `In ${ownerName}'s turn`;
  return "Own initiative";
}

/** The menu's words for each mode (no owner name). */
export const MODE_MENU_LABEL: Record<TurnMode, string> = {
  "after-owner": "After the owner",
  "in-owner-turn": "In the owner's turn",
  own: "Own initiative",
};

const MODE_ICON = { "after-owner": CornerDownRightIcon, "in-owner-turn": LinkIcon, own: DicesIcon };

/** FR-CBT-118: the mode icon (icon only; the Tooltip names the mode). */
export function ModeIcon({
  id,
  mode,
  ownerName,
  testId,
}: {
  id: string;
  mode: TurnMode;
  ownerName: string;
  testId: string;
}) {
  const Icon = MODE_ICON[mode];
  const label = modeLabel(mode, ownerName);
  return (
    <Tooltip content={label}>
      <span
        data-testid={testId}
        data-record-id={id}
        data-value={mode}
        className="flex shrink-0 text-muted-foreground"
      >
        <Icon className="size-3.5" aria-label={label} />
      </span>
    </Tooltip>
  );
}

/**
 * FR-CBT-118 / -119: the owner chip, `badge` look: the owner PC's name with its player's colour
 * dot (`colorOf`, seams S8). Never folds: it rides in the name line's side slot.
 */
export function OwnerChip({
  c,
  ownerName,
  testId,
  compact = false,
}: {
  c: { id: string; ownerCharacterId?: string | null; ownerPlayerId?: string | null };
  ownerName: string;
  testId: string;
  /**
   * K12 (kit round 3, gap 6): a child row flush under its owner shows only the colour dot (the
   * name in its Tooltip and for screen readers), so the row stays medallion · name · bar.
   */
  compact?: boolean;
}) {
  const colorOf = useColorOf();
  if (!c.ownerCharacterId) return null;
  const color = c.ownerPlayerId ? colorOf({ role: "player", playerId: c.ownerPlayerId }) : null;
  if (compact) {
    return (
      <Tooltip content={`Owner: ${ownerName}`}>
        <span
          data-testid={testId}
          data-record-id={c.id}
          data-value={c.ownerCharacterId}
          data-compact
          className="mr-1 flex size-4 shrink-0 items-center justify-center last:mr-0"
        >
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full bg-muted-foreground"
            style={color ? { backgroundColor: color } : undefined}
          />
          <span className="sr-only">{ownerName}</span>
        </span>
      </Tooltip>
    );
  }
  return (
    <Badge
      variant="outline"
      data-testid={testId}
      data-record-id={c.id}
      data-value={c.ownerCharacterId}
      className={cn("mr-1 shrink-0 gap-1 px-1.5 text-[11px] last:mr-0")}
    >
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full bg-muted-foreground"
        style={color ? { backgroundColor: color } : undefined}
      />
      {ownerName}
    </Badge>
  );
}
