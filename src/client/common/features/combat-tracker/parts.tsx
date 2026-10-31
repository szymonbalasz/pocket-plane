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
import {
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useLayoutEffect,
  useState,
} from "react";
import { HP_TRACK_PX } from "../../components/kit/hp-bar";
import { Medallion, type MedallionSize } from "../../components/kit/medallion";
import { Popover, PopoverAnchor, PopoverContent } from "../../components/ui/controls";
import { Tooltip } from "../../components/ui/overlays";
import { Badge } from "../../components/ui/primitives";
import { SearchInput } from "../../components/ui/search-input";
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
 * A narrow Initiative list (under 22rem, `@container/init`: the DM's 320 min, the player's 280)
 * draws the `lg` medallion at `md`, so the name block keeps its room.
 */
const NARROW_LG = "@max-[22rem]/init:size-7 @max-[22rem]/init:text-[13px]";

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

/**
 * K12 (round-2 gap 6): a companion's child row (an `after-owner` row, an in-turn line) under its
 * owner: the `sm` medallion at the end of an `lg` medallion's slot, so the child's name and bar
 * start in the owner's name column. No nested card: the row's classes (`CHILD_ROW`).
 */
export function ChildMedallion({
  c,
}: {
  c: { name: string; imageAssetId?: string | null; tokenId?: string | null };
}) {
  return (
    <span
      data-slot="init-child-medallion"
      // K12 re-test: on the name's line (the row's first), however many lines the row has.
      className="flex w-[34px] shrink-0 justify-end self-start @max-[22rem]/init:w-7"
    >
      <CombatantMedallion c={c} size="sm" />
    </span>
  );
}

/**
 * K12 (round-2 gap 6): the owner and its `after-owner` child read as one block: the child sits
 * flush under the owner (the list's `gap-1` closed, the shared edge square), no indent, no rule.
 */
export const CHILD_ROW = {
  /** On the owner row while its next row is its child. */
  owner: "rounded-b-none",
  /** On the child row. */
  child: "-mt-1 rounded-t-none",
} as const;

/**
 * K12: an in-turn companion line's HP bar track (`--hp-track` on its wrapper): short and fixed,
 * so the one-row line (FR-CBT-142) keeps its room and the lines' bars line up.
 */
export const LINE_TRACK = { "--hp-track": "40px" } as CSSProperties;

/**
 * Sprint 14 F3 (walkthrough F3 3b, ADR-0069: themes never change geometry): an Initiative HP
 * line's "cur / max" (`HpBar` `track="fixed"`) in a px column that holds "102 / 102" in every
 * theme's figures (50 px in Simple Dark, 46 in Gilt & Stone), not `7ch` of the theme's font, so
 * the list's one track (`useListHpTrack`) and every row's fit are the same in every theme.
 */
export const INIT_HP_NUMBERS = "[&>span:last-child]:min-w-[52px]";

/** Sprint 14 F3 (walkthrough F3 3b): "After Mira" on a child row's bar line, a px column too. */
export const INIT_AFTER = "min-w-[56px]";

/**
 * K12 re-test (walkthrough 4): a child row's name line: the name never wraps (a long name
 * wrapped to three lines, the medallion on the second): it truncates with its full text in a
 * Tooltip only when it and its marks don't fit the whole line; the side chips (owner dot, Ally)
 * stay whole beside it, or on the next line when there's no room (the name stays whole,
 * FR-CBTX-57). BL-141 (K6c gap 2): the Ally chip is its icon here (`SideChip` `compact`), so the
 * chips fit beside a name and the row keeps to two lines (name, bar). Same test ID and
 * `data-value` as `NameLine`'s. The medallion sits on this line (`ChildMedallion`).
 */
/**
 * Walkthrough F3 3a: over a mark or chip with its own Tooltip (`data-tip`: the Ally icon, "After
 * Mira", the owner dot), the pointer's moves stop there, so the row's Tooltip (the folded tail,
 * FR-KIT-25, on the whole name block) doesn't start and its own wins (it opened last before).
 */
export function ownTipWins(e: PointerEvent<HTMLElement>): void {
  const tip = (e.target as Element).closest("[data-tip]");
  if (tip && e.currentTarget.contains(tip)) e.stopPropagation();
}

export function ChildNameLine({
  name,
  testId,
  className,
  marks,
  side,
}: {
  name: string;
  testId: string;
  className?: string;
  marks?: ReactNode;
  side?: ReactNode;
}) {
  return (
    <div
      data-name-line
      data-child
      className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5"
    >
      <span data-name-head className="flex min-w-0 max-w-full items-center gap-1">
        <Tooltip content={name}>
          <span
            data-testid={testId}
            data-value={name}
            className={cn("min-w-0 truncate", className)}
          >
            {name}
          </span>
        </Tooltip>
        <span
          data-name-marks
          className="flex shrink-0 items-center gap-1 empty:hidden"
          onPointerMove={ownTipWins}
        >
          {marks}
        </span>
      </span>
      <span
        data-name-side
        className="flex shrink-0 items-center empty:hidden"
        onPointerMove={ownTipWins}
      >
        {side}
      </span>
    </div>
  );
}

/** K12: whether `layout[i]`'s next row is its own child (an `after-owner` row ranked by it). */
export function childBelow(
  layout: readonly { c: { id: string }; owner: { id: string } | null; indent: boolean }[],
  i: number,
): boolean {
  const next = layout[i + 1];
  return Boolean(next?.indent && next.owner?.id === layout[i]?.c.id);
}

export const InitiativeIcon = SwordsIcon;

/** K9 (walkthrough F1): the shortest HP track an Initiative list draws, px (a readable bar). */
export const HP_TRACK_MIN = 36;

/**
 * K9: the room a row's HP line leaves its track: the line's width less the bar's own rest (its
 * gap and "cur / max"), the line's other parts (temp "+N", card, Down / death) and their gaps. The
 * AC / moved tail doesn't count: it folds into the row Tooltip when it doesn't fit (FR-KIT-25).
 */
export function trackRoom(w: {
  line: number;
  barRest: number;
  others: readonly number[];
  gap: number;
}): number {
  return w.line - w.barRest - w.others.reduce((a, x) => a + x + w.gap, 0);
}

/**
 * K9: ONE track width per Initiative list: the narrowest row's room, at most the kit's 120 px,
 * never under `HP_TRACK_MIN`. No row measured → 120.
 */
export function listTrack(rooms: readonly number[]): number {
  const r = rooms.filter((x) => Number.isFinite(x));
  if (r.length === 0) return HP_TRACK_PX;
  return Math.floor(Math.max(HP_TRACK_MIN, Math.min(HP_TRACK_PX, ...r)));
}

/** K9 re-test 2: a stacked list unstacks only once every one-line room has this much to spare. */
export const STACK_HYSTERESIS = 8;

/**
 * K9 re-test (R1): whether a list stacks its HP lines: some row's one-line room is under
 * `HP_TRACK_MIN` (a right column that can't shrink: init + concentration + "+N" + a trigger chip,
 * which never folds, FR-CBTX-54), so a shared bar there would be unreadable or cut. Re-test 2:
 * the rooms are always the one-line layout's (measured the same way at every width; a row's room
 * grows steadily with the list's width), and a stacked list stays stacked until every room clears
 * the floor by `STACK_HYSTERESIS`, so the switch is one width threshold with a little hysteresis.
 */
export function needsStack(rooms: readonly number[], stacked = false): boolean {
  const floor = HP_TRACK_MIN + (stacked ? STACK_HYSTERESIS : 0);
  return rooms.some((r) => Number.isFinite(r) && r < floor);
}

/** An element's content-box width (its `clientWidth` less its side padding), px. */
export function contentWidth(el: HTMLElement): number {
  const cs = getComputedStyle(el);
  return (
    el.clientWidth -
    (Number.parseFloat(cs.paddingLeft) || 0) -
    (Number.parseFloat(cs.paddingRight) || 0)
  );
}

/**
 * K9 re-test (R1): the stacked layout's classes, on markup every theme shares. The list carries
 * `group/hp` (+ `data-hp-stacked` while stacked, set by `useListHpTrack`); a row's main line wraps,
 * its name block dissolves (`contents`) so the name line keeps the medallion's line with the init
 * and chips, and the HP line (and a sub-line under the name) take full-width lines under it,
 * indented past the medallion (34 + 6 px; 28 + 6 in a narrow list, FR-KIT-24's `md`).
 */
export const HP_STACK = {
  list: "group/hp",
  main: "group-data-[hp-stacked]/hp:flex-wrap",
  block: "group-data-[hp-stacked]/hp:contents",
  name: "min-w-0 group-data-[hp-stacked]/hp:flex-1",
  line: "group-data-[hp-stacked]/hp:order-last group-data-[hp-stacked]/hp:basis-full group-data-[hp-stacked]/hp:pl-10 group-data-[hp-stacked]/hp:@max-[22rem]/init:pl-[34px]",
} as const;

/** The HP line's gap (`gap-x-1.5`). */
const LINE_GAP = 6;

/** K9: one row's track room, measured on its `data-stats-line` (null: no fixed bar). */
/**
 * Walkthrough F3 3b: a part's drawn width rounded **up** (`offsetWidth` rounds 50.4 to 50, and a
 * line that then fills to the pixel wrapped its last part onto a third line).
 */
const width = (el: HTMLElement) => Math.ceil(el.getBoundingClientRect().width);

function measureRoom(line: HTMLElement): number | null {
  const bar = line.querySelector<HTMLElement>(
    ':scope > [data-slot="kit-hpbar"][data-track="fixed"]',
  );
  const track = bar?.querySelector<HTMLElement>('[data-slot="kit-hpbar-track"]');
  if (!bar || !track || line.clientWidth === 0) return null;
  const others = [...line.children]
    .filter(
      (k): k is HTMLElement =>
        k instanceof HTMLElement && k !== bar && !k.hasAttribute("data-tail"),
    )
    .map(width)
    .filter((w) => w > 0);
  // The content box: a stacked line's indent past the medallion is padding (re-test 2).
  return trackRoom({
    line: contentWidth(line),
    barRest: width(bar) - track.getBoundingClientRect().width,
    others,
    gap: LINE_GAP,
  });
}

/**
 * K9 (walkthrough F1): sets `--hp-track` on the Initiative list to `listTrack` of its rows' rooms,
 * so every row's bar is the same length at every width. Re-test R1: rooms are first measured on
 * the one-line rows; if some row's is under the floor (`needsStack`) the list stacks its HP lines
 * (`data-hp-stacked`, `HP_STACK`) and measures again. Both reads happen in one task (synchronous
 * layout), so nothing paints in between. Re-measured when the list or a row's HP line resizes and
 * when rows or their parts change. Measures widths only, never the track, so it settles.
 */
export function useListHpTrack(listRef: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    let frame = 0;
    const lines = () => [...list.querySelectorAll<HTMLElement>("[data-stats-line]")];
    const rooms = () =>
      lines()
        .map(measureRoom)
        .filter((r): r is number => r !== null);
    const measure = () => {
      frame = 0;
      const was = list.hasAttribute("data-hp-stacked");
      list.removeAttribute("data-hp-stacked");
      let r = rooms();
      if (needsStack(r, was)) {
        list.setAttribute("data-hp-stacked", "");
        r = rooms();
      }
      list.style.setProperty("--hp-track", `${listTrack(r)}px`);
    };
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => schedule());
    const observeLines = () => {
      ro?.disconnect();
      ro?.observe(list);
      for (const l of lines()) ro?.observe(l);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const mo =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => {
            observeLines();
            schedule();
          });
    mo?.observe(list, { childList: true, subtree: true, characterData: true });
    observeLines();
    measure();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      ro?.disconnect();
      mo?.disconnect();
    };
  }, [listRef]);
}

/**
 * FR-CBT-104 (#252): "Ally" (lucide `handshake`) on a monster set to ally, "Enemy" on a PC set to
 * enemy, `badge` look; dashed (DM) while players see another side. Never folds (FR-CBTX-54): the
 * row puts it before the effect chips, outside "+N".
 */
export function SideChip({
  c,
  testId,
  compact = false,
}: {
  c: { id: string; kind: CombatantKind; side?: Side | null; publicSide?: Side | null };
  testId: string;
  /** BL-141 (K6c gap 2): the icon alone (a child row's name line), the word in its Tooltip. */
  compact?: boolean;
}) {
  const chip = sideChip(c);
  if (!chip) return null;
  const Icon = chip.side === "ally" ? HandshakeIcon : SwordsIcon;
  const label = SIDE_LABEL[chip.side];
  const badge = (
    <Badge
      variant="outline"
      data-testid={testId}
      data-record-id={c.id}
      data-value={chip.side}
      data-secret={chip.secret}
      data-compact={compact || undefined}
      aria-label={compact ? label : undefined}
      className={cn(
        "shrink-0 gap-1 text-[11px]",
        compact ? "px-1" : "px-1.5",
        chip.secret && "border-dashed",
      )}
    >
      <Icon className="size-3" aria-hidden />
      {!compact && label}
    </Badge>
  );
  if (!chip.secret && !compact) return badge;
  const secret = chip.secret ? `Secret: players see ${SIDE_LABEL[otherSide(chip.side)]}` : null;
  const tip = compact ? (secret ? `${label} · ${secret}` : label) : secret;
  return <Tooltip content={tip}>{badge}</Tooltip>;
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
        <SearchInput
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
          onClear={() => {
            setQ("");
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
