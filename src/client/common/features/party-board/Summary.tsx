// `party.summary` "Party status" (FR-PARTY-51–58, sprint 8, CB3), both clients: one dense line
// per PC (portrait, owner's colour dot + name, HP "38 / 52" with a thin band-tone bar, "+5" temp,
// shield AC, death / Down Badge, ≤ 4 condition icons + "+N", turn marker; DM: eye-off on a PC
// hidden from players), then companions grouped under their owner PC in muted type (owner and DM:
// numbers + AC; others: the band). No editing. A row the viewer may open (own PC; any for the DM)
// opens the sheet; every row has a Tooltip with its figures. The list is one tab stop (roving).

import { CREATURE_SHEET_TYPE } from "@shared/character-sheet/sheet";
import { EFFECT_TYPE, type EffectView } from "@shared/combat-extras/schemas";
import { COMBATANT_TYPE, ENCOUNTER_TYPE } from "@shared/combat-tracker/schemas";
import type { HealthBand } from "@shared/entities/schemas";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import { initials } from "@shared/scenes-map/geometry";
import { TOKEN_TYPE } from "@shared/scenes-map/schemas";
import { ChevronRightIcon, EyeOffIcon, ShieldIcon } from "lucide-react";
import { type KeyboardEvent, useMemo } from "react";
import { Tooltip } from "../../components/ui/overlays";
import { cn } from "../../lib/utils";
import { useRecords, useSync } from "../../sync/store";
import { AssetImg } from "../assets-pipeline/AssetImg";
import { useColorOf } from "../campaign-management/colors";
import { openSheetFor } from "../character-sheet/selection";
import { CHAR_SHEET_KIND } from "../character-sheet/window";
import { EffectIcon, effectValue } from "../combat-extras/icons";
import { DeathBadge } from "../combat-extras/parts";
import { BandBadge } from "../combat-tracker/parts";
import { useOpenWindow } from "../play-shell/ShellContext";
import {
  EMPTY_PARTY,
  partySummary,
  SUMMARY_ICONS_MAX,
  type SummaryCompanion,
  type SummaryGroup,
  type SummaryPc,
  summaryHpValue,
  summaryTip,
} from "./summary-logic";

const BAR: Record<HealthBand, string> = {
  healthy: "bg-hp-full",
  bloodied: "bg-hp-bloodied",
  down: "bg-hp-down",
};

function SmallPortrait({ name, id }: { name: string; id: string | null }) {
  if (id) return <AssetImg id={id} file="thumb" alt="" className="size-5 shrink-0 rounded-sm" />;
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-sm bg-muted text-[9px] font-semibold text-muted-foreground">
      {initials(name)}
    </span>
  );
}

/** "cur / max" over a thin bar in band tone; numbers never cut. */
function Hp({ hp, band }: { hp: { current: number; max: number }; band: HealthBand }) {
  const pct = hp.max > 0 ? Math.min(100, Math.round((100 * hp.current) / hp.max)) : 0;
  return (
    <span
      data-testid="party-summary-hp"
      data-value={summaryHpValue({ hp, band })}
      className="flex shrink-0 flex-col items-end gap-px"
    >
      <span className="whitespace-nowrap tabular-nums">
        {hp.current} / {hp.max}
      </span>
      <span className="h-0.5 w-full overflow-hidden rounded-full bg-accent" aria-hidden>
        <span className={cn("block h-full", BAR[band])} style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

function Ac({ ac }: { ac: number }) {
  return (
    <span
      data-testid="party-summary-ac"
      data-value={ac}
      className="flex shrink-0 items-center gap-0.5 whitespace-nowrap tabular-nums"
    >
      <ShieldIcon className="size-3 text-muted-foreground" aria-label="AC" />
      {ac}
    </span>
  );
}

/** FR-CBTX-29's icons, ≤ 4 + "+N"; the names are in the row's Tooltip. */
function Icons({ effects }: { effects: readonly EffectView[] }) {
  if (effects.length === 0) return null;
  const shown = effects.slice(0, SUMMARY_ICONS_MAX);
  const more = effects.length - shown.length;
  return (
    <span data-testid="party-summary-effects" className="flex shrink-0 items-center gap-0.5">
      {shown.map((e) => {
        const Icon = EffectIcon(e);
        return (
          <Icon
            key={e.id}
            data-testid="party-summary-effect"
            data-value={effectValue(e)}
            className="size-3 text-muted-foreground"
            aria-hidden
          />
        );
      })}
      {more > 0 && <span className="text-[10px] text-muted-foreground">+{more}</span>}
    </span>
  );
}

function Turn({ on }: { on: boolean }) {
  if (!on) return null;
  return (
    <ChevronRightIcon
      data-testid="party-summary-turn"
      className="size-3 shrink-0 text-primary"
      aria-label="Current turn"
    />
  );
}

function PcRow({ r, live, open }: { r: SummaryPc; live: boolean; open: (id: string) => void }) {
  const color = useColorOf()({ role: "player", playerId: r.ownerPlayerId });
  return (
    <Tooltip content={summaryTip(r)}>
      <li
        data-testid="party-summary-row"
        data-record-id={r.id}
        data-own={r.own}
        data-turn={r.turn}
        data-can-open={r.canOpen}
        className={cn(
          "flex flex-wrap items-center gap-x-1.5 rounded-sm px-1 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring",
          r.canOpen && "cursor-pointer hover:bg-accent/50",
        )}
        onClick={r.canOpen ? () => open(r.id) : undefined}
        onKeyDown={(e) => {
          if (e.key === "Enter" && r.canOpen) open(r.id);
        }}
      >
        <SmallPortrait name={r.name} id={r.portraitAssetId} />
        <span className="flex min-w-0 flex-1 basis-16 items-center gap-1">
          <span
            className="size-2 shrink-0 rounded-full"
            style={color ? { backgroundColor: color } : undefined}
            aria-hidden
          />
          {/* FR-PARTY-58: names wrap, never cut. */}
          <span
            data-testid="party-summary-name"
            className="min-w-0 font-medium [overflow-wrap:anywhere]"
          >
            {r.name}
          </span>
          <Turn on={r.turn} />
          {r.hidden && (
            <EyeOffIcon
              data-testid="party-summary-hidden"
              className="size-3 shrink-0 text-muted-foreground"
              aria-label="Hidden from players"
            />
          )}
        </span>
        <span
          className={cn("flex shrink-0 items-center gap-1.5", !live && "text-muted-foreground")}
        >
          <Hp hp={r.hp} band={r.band} />
          {r.temp > 0 && (
            <span
              data-testid="party-summary-temp"
              data-value={r.temp}
              className="whitespace-nowrap tabular-nums text-hp-full"
            >
              +{r.temp}
            </span>
          )}
          <Ac ac={r.ac} />
        </span>
        {r.deathState && <DeathBadge state={r.deathState} testId="party-summary-death" />}
        <Icons effects={r.effects} />
      </li>
    </Tooltip>
  );
}

function CompanionRow({ r, live }: { r: SummaryCompanion; live: boolean }) {
  return (
    <li
      data-testid="party-summary-companion"
      data-record-id={r.id}
      data-turn={r.turn}
      className="flex flex-wrap items-center gap-x-1.5 py-0.5 pl-4 text-muted-foreground"
    >
      <SmallPortrait name={r.name} id={r.portraitAssetId} />
      <span className="flex min-w-0 flex-1 basis-16 items-center gap-1">
        <span className="min-w-0 [overflow-wrap:anywhere]">{r.name}</span>
        <Turn on={r.turn} />
      </span>
      <span className={cn("flex shrink-0 items-center gap-1.5", !live && "opacity-70")}>
        {r.hp ? (
          <Hp hp={r.hp} band={r.band} />
        ) : (
          <BandBadge band={r.band} testId="party-summary-hp" />
        )}
        {r.ac !== null && <Ac ac={r.ac} />}
      </span>
      <Icons effects={r.effects} />
    </li>
  );
}

function Group({ g, live }: { g: SummaryGroup; live: boolean }) {
  const color = useColorOf()({ role: "player", playerId: g.playerId });
  return (
    <section data-testid="party-summary-group" data-record-id={g.characterId}>
      <h3 className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
        <span
          className="size-1.5 shrink-0 rounded-full"
          style={color ? { backgroundColor: color } : undefined}
          aria-hidden
        />
        <span className="[overflow-wrap:anywhere]">{g.characterName}</span>
      </h3>
      <ul>
        {g.rows.map((r) => (
          <CompanionRow key={r.id} r={r} live={live} />
        ))}
      </ul>
    </section>
  );
}

/** ↑ / ↓ move between rows like ← / → (the chip-row roving, `roving.ts`). */
function onListKey(e: KeyboardEvent<HTMLUListElement>) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const rows = [
    ...e.currentTarget.querySelectorAll<HTMLElement>("[data-testid=party-summary-row]"),
  ];
  const i = rows.indexOf(e.target as HTMLElement);
  const to = rows[e.key === "ArrowDown" ? i + 1 : i - 1];
  if (i < 0 || !to) return;
  e.preventDefault();
  to.focus();
}

export function PartySummaryWindow() {
  const entities = useRecords<unknown>(ENTITY_TYPE);
  const combatants = useRecords<unknown>(COMBATANT_TYPE);
  const encounters = useRecords<unknown>(ENCOUNTER_TYPE);
  const effects = useRecords<EffectView>(EFFECT_TYPE);
  const sheets = useRecords<unknown>(CREATURE_SHEET_TYPE);
  const tokens = useRecords<unknown>(TOKEN_TYPE);
  const you = useSync((s) => s.store.you);
  const live = useSync((s) => s.state === "live");
  const viewer = useMemo(
    () => ({ role: you?.role ?? "player", playerId: you?.playerId ?? null }) as const,
    [you],
  );
  const summary = useMemo(
    () => partySummary({ entities, combatants, encounters, effects, sheets, tokens }, viewer),
    [entities, combatants, encounters, effects, sheets, tokens, viewer],
  );
  const openWindow = useOpenWindow();
  const open = (id: string) => {
    openSheetFor(id, "character");
    openWindow(CHAR_SHEET_KIND);
  };
  if (summary.pcs.length === 0) {
    return (
      <p
        data-testid="party-summary-empty"
        className="py-4 text-center text-sm text-muted-foreground"
      >
        {EMPTY_PARTY}
      </p>
    );
  }
  return (
    <div data-testid="party-summary" data-live={live} className="flex flex-col gap-1.5 text-xs">
      <ul data-chip-row="" aria-label="Party" onKeyDown={onListKey}>
        {summary.pcs.map((r) => (
          <PcRow key={r.id} r={r} live={live} open={open} />
        ))}
      </ul>
      {summary.companions.map((g) => (
        <Group key={g.characterId} g={g} live={live} />
      ))}
    </div>
  );
}
