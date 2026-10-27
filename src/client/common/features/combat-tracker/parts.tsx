// Small combat UI parts for both clients: portrait / initials, health band badge, turn marker,
// side chip (FR-CBT-104); the creature lookup (FR-CBT-63) used by the DM's encounter builder and
// Add dialog. Kit parity (FR-KIT-23, -24): the turn marker is a gem diamond on the row's left
// edge; an Initiative row's medallion is its portrait, else its initial on its token's
// creature-type colour.
import type { CombatantKind, HealthBand, Side } from "@shared/combat-tracker/schemas";
import { CREATURE_TYPES, type CreatureType } from "@shared/entities/schemas";
import type { RecordStore } from "@shared/protocol/store";
import { initials } from "@shared/scenes-map/geometry";
import { TOKEN_TYPE } from "@shared/scenes-map/schemas";
import { HandshakeIcon, SwordsIcon } from "lucide-react";
import { useState } from "react";
import { Medallion, type MedallionSize } from "../../components/kit/medallion";
import { Popover, PopoverAnchor, PopoverContent } from "../../components/ui/controls";
import { Tooltip } from "../../components/ui/overlays";
import { Badge, Input } from "../../components/ui/primitives";
import { cn } from "../../lib/utils";
import { useSync } from "../../sync/store";
import { AssetImg } from "../assets-pipeline/AssetImg";
import { CREATURE_COLORS } from "../scenes-map/theme";
import { type LookupRow, lookupMatches, noMatchText } from "./lookup";
import { otherSide, SIDE_LABEL, sideChip } from "./side";

export function Portrait({ name, imageAssetId }: { name: string; imageAssetId: string | null }) {
  if (imageAssetId) {
    return (
      <AssetImg id={imageAssetId} file="thumb" alt="" className="size-7 shrink-0 rounded-sm" />
    );
  }
  return (
    <div className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-muted text-[10px] font-semibold text-muted-foreground">
      {initials(name)}
    </div>
  );
}

const BAND_LABEL: Record<HealthBand, string> = {
  healthy: "Healthy",
  bloodied: "Bloodied",
  down: "Down",
};

const BAND_CLASS: Record<HealthBand, string> = {
  healthy: "border-hp-full/40 text-hp-full",
  bloodied: "border-hp-bloodied/50 text-hp-bloodied",
  down: "border-hp-down/50 text-hp-down",
};

/** `hp.full` / `hp.bloodied` / `hp.down` tokens (visual-direction). */
export function BandBadge({ band, testId }: { band: HealthBand; testId: string }) {
  return (
    <Badge
      variant="outline"
      data-testid={testId}
      data-value={band}
      className={cn("px-1.5 text-[11px]", BAND_CLASS[band])}
    >
      {BAND_LABEL[band]}
    </Badge>
  );
}

/**
 * FR-KIT-23: the current turn's gem diamond on the row's left edge (the row is `relative`); aria
 * "Current turn". Simple Dark draws it in `primary`; a theme styles `data-slot="init-turn"`.
 */
export function TurnMarker({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <span
      role="img"
      aria-label="Current turn"
      data-slot="init-turn"
      className="pointer-events-none absolute top-1/2 left-0 size-2 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-primary"
    />
  );
}

const isCreatureType = (t: unknown): t is CreatureType =>
  (CREATURE_TYPES as readonly unknown[]).includes(t);

/**
 * FR-KIT-24: the colour behind an Initiative row's initial: its token's creature type
 * (`creature.*`, meaning colours, FR-THEME-09), else null (the neutral muted colour). Only tokens
 * the viewer holds, so a player learns nothing new.
 */
export function medallionColour(store: RecordStore, c: { tokenId?: string | null }): string | null {
  const token = c.tokenId ? store.records[TOKEN_TYPE]?.[c.tokenId] : undefined;
  const type = (token as { creatureType?: unknown } | undefined)?.creatureType;
  return isCreatureType(type) ? CREATURE_COLORS[type] : null;
}

/**
 * A narrow Initiative list (under 20rem, `@container/init`: the DM's 320 min, the player's 280)
 * draws the `lg` medallion at `md`, so the name block keeps its room.
 */
const NARROW_LG = "@max-[20rem]/init:size-7 @max-[20rem]/init:text-[13px]";

/** FR-KIT-24: a combatant's medallion (portrait, else the initial on its token's type colour). */
export function CombatantMedallion({
  c,
  size = "lg",
}: {
  c: { name: string; imageAssetId?: string | null; tokenId?: string | null };
  size?: MedallionSize;
}) {
  const colour = useSync((s) => medallionColour(s.store, c));
  return (
    <Medallion
      name={c.name}
      imageAssetId={c.imageAssetId}
      colour={colour}
      size={size}
      className={size === "lg" ? NARROW_LG : undefined}
    />
  );
}

export const InitiativeIcon = SwordsIcon;

/**
 * FR-CBT-104 (#252): "Ally" (lucide `handshake`) on a monster set to ally, "Enemy" on a PC set to
 * enemy, `badge` look; dashed (DM) while players see another side. Never folds (FR-CBTX-54): the
 * row puts it before the effect chips, outside "+N".
 */
export function SideChip({
  c,
  testId,
}: {
  c: { id: string; kind: CombatantKind; side?: Side | null; publicSide?: Side | null };
  testId: string;
}) {
  const chip = sideChip(c);
  if (!chip) return null;
  const Icon = chip.side === "ally" ? HandshakeIcon : SwordsIcon;
  const badge = (
    <Badge
      variant="outline"
      data-testid={testId}
      data-record-id={c.id}
      data-value={chip.side}
      data-secret={chip.secret}
      className={cn("shrink-0 gap-1 px-1.5 text-[11px]", chip.secret && "border-dashed")}
    >
      <Icon className="size-3" aria-hidden />
      {SIDE_LABEL[chip.side]}
    </Badge>
  );
  if (!chip.secret) return badge;
  return (
    <Tooltip content={`Secret: players see ${SIDE_LABEL[otherSide(chip.side)]}`}>{badge}</Tooltip>
  );
}

/**
 * FR-CBT-63: a text input with up to 8 suggestions while something is typed (no list when
 * empty). ↑ / ↓ + Enter or click picks; focus stays in the input, which clears for the next
 * pick; Esc clears. Options `cbt-lookup-option` (+ `data-record-id`), none `cbt-lookup-empty`.
 */
export function CreatureLookup({
  rows,
  onPick,
  disabled = false,
  testId = "cbt-lookup-input",
  placeholder = "Add creature…",
  onQueryChange,
}: {
  rows: readonly LookupRow[];
  onPick(id: string): void;
  /** The typed text (e.g. to search the server for imported monsters, FR-CMP-17). */
  onQueryChange?(q: string): void;
  disabled?: boolean;
  testId?: string;
  placeholder?: string;
}) {
  const [q, setQuery] = useState("");
  const setQ = (v: string) => {
    setQuery(v);
    onQueryChange?.(v);
  };
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const shown = lookupMatches(rows, q);
  const open = !disabled && !dismissed && q.trim() !== "";
  const at = Math.min(active, Math.max(0, shown.length - 1));
  const pick = (id: string) => {
    onPick(id);
    setQ("");
    setActive(0);
  };
  return (
    <Popover open={open} onOpenChange={(o) => !o && setDismissed(true)}>
      <PopoverAnchor asChild>
        <Input
          data-testid={testId}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          autoComplete="off"
          placeholder={placeholder}
          disabled={disabled}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
            setDismissed(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const step = e.key === "ArrowDown" ? 1 : -1;
              setActive(Math.min(Math.max(0, at + step), Math.max(0, shown.length - 1)));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const r = shown[at];
              if (r) pick(r.id);
            } else if (e.key === "Escape") {
              if (q !== "") e.stopPropagation();
              setQ("");
              setActive(0);
            }
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="max-h-72 w-[var(--radix-popover-trigger-width)] min-w-64 overflow-auto p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          // A click back in the input keeps the list.
          if ((e.target as HTMLElement | null)?.closest?.(`[data-testid="${testId}"]`)) {
            e.preventDefault();
          }
        }}
      >
        {shown.length === 0 ? (
          <p data-testid="cbt-lookup-empty" className="p-2 text-sm text-muted-foreground">
            {noMatchText(q)}
          </p>
        ) : (
          <ul>
            {shown.map((r, i) => (
              <li key={r.id}>
                <button
                  type="button"
                  tabIndex={-1}
                  data-testid="cbt-lookup-option"
                  data-record-id={r.id}
                  data-active={i === at}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent",
                    i === at && "bg-accent",
                  )}
                  // Keep focus in the input (FR-CBT-63).
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(r.id)}
                >
                  <span className="flex-1 truncate">{r.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {r.cr !== null ? `CR ${r.cr} · ${r.xp ?? 0} XP` : ""}
                  </span>
                  <Badge variant="outline">{r.badge}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
