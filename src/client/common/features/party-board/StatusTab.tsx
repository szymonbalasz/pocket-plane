// Party Manager's **Party status** tab (FR-PARTY-51–56 sprint 8 CB3, FR-PARTY-61, -62 sprint 9
// PM2), both clients: one dense line per PC (portrait, owner's colour dot + name, HP "38 / 52"
// with a thin band-tone bar, "+5" temp, shield AC, death / Down Badge, ≤ 4 condition icons + "+N",
// turn marker; DM: eye-off on a PC hidden from players), each followed, indented, by its
// companions in the companion row form (`Companions.tsx`; owner and DM: numbers + Card, others:
// the band; DM: eye-off on a hidden pet, the row menu on pets), then "Other companions" whose
// owner PC has no row here. DM header: New pet…. No editing of figures. A row the viewer may open
// (own PC; any for the DM) opens the sheet; every PC row has a Tooltip with its figures. The list
// is one tab stop (roving).

import { CREATURE_SHEET_TYPE } from "@shared/character-sheet/sheet";
import { EFFECT_TYPE, type EffectView } from "@shared/combat-extras/schemas";
import { COMBATANT_TYPE, ENCOUNTER_TYPE } from "@shared/combat-tracker/schemas";
import type { HealthBand } from "@shared/entities/schemas";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import { SCENE_TYPE, TOKEN_TYPE } from "@shared/scenes-map/schemas";
import { ChevronRightIcon, EyeOffIcon, ShieldIcon } from "lucide-react";
import { type KeyboardEvent, useMemo } from "react";
import { Tooltip } from "../../components/ui/overlays";
import { ScrollArea } from "../../components/ui/scroll-area";
import { cn } from "../../lib/utils";
import { useRecords, useSync } from "../../sync/store";
import { useColorOf } from "../campaign-management/colors";
import { openSheetFor } from "../character-sheet/selection";
import { CHAR_SHEET_KIND } from "../character-sheet/window";
import { EffectIcon, effectValue } from "../combat-extras/icons";
import { DeathBadge } from "../combat-extras/parts";
import { useDefinitions } from "../compendium/definitions";
import { useOpenWindow } from "../play-shell/ShellContext";
import { CompanionLine, type CompanionsDmParts, SmallPortrait } from "./Companions";
import {
  EMPTY_PARTY,
  OTHER_COMPANIONS,
  OWNER_UNKNOWN,
  partySummary,
  SUMMARY_ICONS_MAX,
  type SummaryCompanion,
  type SummaryPc,
  summaryHpValue,
  summaryTip,
} from "./summary-logic";

const BAR: Record<HealthBand, string> = {
  healthy: "bg-hp-full",
  bloodied: "bg-hp-bloodied",
  down: "bg-hp-down",
};

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
          "flex flex-wrap items-center gap-x-1.5 rounded-sm px-1 py-px outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
          {r.hidden && <Hidden testId="party-summary-hidden" />}
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

function Hidden({ testId }: { testId: string }) {
  return (
    <EyeOffIcon
      data-testid={testId}
      className="size-3 shrink-0 text-muted-foreground"
      aria-label="Hidden from players"
    />
  );
}

/** FR-PARTY-61: the companion row form plus the tab's marks (turn, DM eye-off, conditions). */
function Companion({
  r,
  ownerName,
  bases,
  dm,
  live,
}: {
  r: SummaryCompanion;
  ownerName: string;
  bases: ReadonlyMap<string, string>;
  dm?: CompanionsDmParts;
  live: boolean;
}) {
  return (
    <CompanionLine
      row={r}
      ownerName={ownerName}
      base={r.baseId ? (bases.get(r.baseId) ?? null) : null}
      // FR-PARTY-62: summons get no menu (Initiative owns them).
      dm={r.pet ? dm : undefined}
      live={live}
      marks={
        <>
          <Turn on={r.turn} />
          {r.hidden && <Hidden testId="party-companion-hidden" />}
          <Icons effects={r.effects} />
        </>
      }
    />
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

/** FR-PARTY-61, -62: the tab body; `dm` = the DM client's New pet… and pet row menu. */
export function StatusTab({ dm }: { dm?: CompanionsDmParts }) {
  const entities = useRecords<unknown>(ENTITY_TYPE);
  const combatants = useRecords<unknown>(COMBATANT_TYPE);
  const encounters = useRecords<unknown>(ENCOUNTER_TYPE);
  const effects = useRecords<EffectView>(EFFECT_TYPE);
  const sheets = useRecords<unknown>(CREATURE_SHEET_TYPE);
  const tokens = useRecords<unknown>(TOKEN_TYPE);
  const scenes = useRecords<unknown>(SCENE_TYPE);
  const you = useSync((s) => s.store.you);
  const live = useSync((s) => s.state === "live");
  const viewer = useMemo(
    () => ({ role: you?.role ?? "player", playerId: you?.playerId ?? null }) as const,
    [you],
  );
  const summary = useMemo(
    () =>
      partySummary({ entities, combatants, encounters, effects, sheets, tokens, scenes }, viewer),
    [entities, combatants, encounters, effects, sheets, tokens, scenes, viewer],
  );
  // DM: the pets' bases' names ("Owlbear", muted); imported ones load on demand.
  const baseIds = useMemo(() => {
    const all = [...summary.pcs.flatMap((p) => p.companions), ...summary.others];
    return [...new Set(all.flatMap((r) => (r.baseId ? [r.baseId] : [])))];
  }, [summary]);
  const defs = useDefinitions(viewer.role === "dm" ? baseIds : []).byId;
  const bases = useMemo(() => new Map([...defs.values()].map((d) => [d.id, d.name])), [defs]);
  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of entities) {
      const r = e as { id?: unknown; kind?: unknown; name?: unknown };
      if (r.kind === "character" && typeof r.id === "string" && typeof r.name === "string") {
        m.set(r.id, r.name);
      }
    }
    return m;
  }, [entities]);
  const openWindow = useOpenWindow();
  const open = (id: string) => {
    openSheetFor(id, "character");
    openWindow(CHAR_SHEET_KIND);
  };
  return (
    <div data-testid="party-status" className="flex h-full min-h-0 flex-col gap-1">
      {dm && (
        <div className="flex justify-end">
          <dm.header disabled={!live} />
        </div>
      )}
      <ScrollArea className="min-h-0 flex-1">
        <div
          data-testid="party-summary"
          data-live={live}
          className="flex flex-col gap-1.5 pr-2 text-xs"
        >
          {summary.pcs.length === 0 && (
            <p
              data-testid="party-summary-empty"
              className="py-4 text-center text-sm text-muted-foreground"
            >
              {EMPTY_PARTY}
            </p>
          )}
          {summary.pcs.length > 0 && (
            <ul data-chip-row="" aria-label="Party" onKeyDown={onListKey}>
              {summary.pcs.map((r) => (
                <li key={r.id}>
                  {/* FR-PARTY-61: the group wraps the PC row and its companions (indented). */}
                  <ul data-testid="party-companion-group" data-record-id={r.id}>
                    <PcRow r={r} live={live} open={open} />
                    {r.companions.map((c) => (
                      <Companion
                        key={c.id}
                        r={c}
                        ownerName={r.name}
                        bases={bases}
                        dm={dm}
                        live={live}
                      />
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          {summary.others.length > 0 && (
            <section data-testid="party-companion-other">
              <h3 className="text-[11px] font-semibold text-muted-foreground">
                {OTHER_COMPANIONS}
              </h3>
              <ul>
                {summary.others.map((c) => (
                  <Companion
                    key={c.id}
                    r={c}
                    ownerName={names.get(c.ownerCharacterId) ?? OWNER_UNKNOWN}
                    bases={bases}
                    dm={dm}
                    live={live}
                  />
                ))}
              </ul>
            </section>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
