// `stats.dice` "d20 rolls" (FR-STATS-90), both clients: how often each d20 face came up, as a bar
// chart with a line where a fair die's bars would end. Count or Percent; one session or the
// campaign; everyone or one row of the Luck ack. Opened from the Luck tab, on its scope. Refreshes
// as the Luck tab does (FR-STATS-41); a player's ack holds public rolls only (FR-STATS-37).
import type { You } from "@shared/protocol/frames";
import {
  type DmLuckResult,
  DmLuckResult as DmLuckSchema,
  type PlayerLuckResult,
  PlayerLuckResult as PlayerLuckSchema,
  type SessionsResult,
  SessionsResult as SessionsSchema,
} from "@shared/stats/schemas";
import { useStore } from "zustand";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/controls";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
} from "../../components/ui/overlays";
import { cn } from "../../lib/utils";
import { useSync } from "../../sync/store";
import {
  CHART_MODES,
  type ChartMode,
  type ChartModel,
  type ChartView,
  chartModel,
  chartViewOf,
  diceChartViews,
  EVERYONE,
  facesOf,
  setChartView,
} from "./dice-chart";
import { CAMPAIGN, LuckScopeSelect, luckInput, luckScopeValue } from "./Luck";
import { avgText, refreshes } from "./logic";
import { useStatsQuery } from "./query";
import type { QueryState } from "./refresh";
import { Empty, LoadError, SkeletonRows } from "./states";
import { viewKey } from "./view";

type LuckResult = DmLuckResult | PlayerLuckResult;

const MODE_LABEL: Record<ChartMode, string> = { count: "Count", percent: "Percent" };

export function DiceChartWindow() {
  const you: You | null = useSync((s) => s.store.you);
  const key = you ? viewKey(you) : null;
  const view = useStore(diceChartViews, (s) => chartViewOf(s.views, key));
  const live = useSync((s) => s.state === "live");
  const list = useStatsQuery<SessionsResult>({ scope: "sessions" }, SessionsSchema.parse, (f) =>
    refreshes(f, { tab: "session", pickedFight: null }),
  );
  const luck = useStatsQuery<LuckResult>(
    luckInput(view.scope),
    you?.role === "dm" ? DmLuckSchema.parse : PlayerLuckSchema.parse,
    (f) => refreshes(f, { tab: "luck", pickedFight: null }),
    (r) => r.luck.pending === true,
  );
  return (
    <DiceChartBody
      list={list.state}
      luck={luck.state}
      live={live}
      view={view}
      onScope={(v) => setChartView(key, { scope: v === CAMPAIGN ? CAMPAIGN : Number(v) })}
      onWho={(who) => setChartView(key, { who })}
      onMode={(mode) => setChartView(key, { mode })}
      retry={() => {
        list.retry();
        luck.retry();
      }}
    />
  );
}

export function DiceChartBody({
  list,
  luck,
  live,
  view,
  onScope,
  onWho,
  onMode,
  retry,
  now,
}: {
  list: Pick<QueryState<unknown, SessionsResult>, "status" | "result">;
  luck: Pick<QueryState<unknown, LuckResult>, "status" | "result">;
  live: boolean;
  view: ChartView;
  onScope(value: string): void;
  onWho(key: string): void;
  onMode(mode: ChartMode): void;
  retry(): void;
  /** "Today" in the picker (tests pin it). */
  now?: Date;
}) {
  const r = luck.result?.luck ?? null;
  const rows = r?.rows ?? [];
  const failed = live && (list.status === "error" || luck.status === "error");
  // A pick with no row in this scope reads as Everyone, which the picker then says.
  const who = rows.some((x) => x.key === view.who) ? view.who : EVERYONE;
  const model = chartModel(facesOf(rows, who), view.mode);
  return (
    <div
      data-testid="stats-dice"
      data-state={live ? (r?.pending ? "pending" : luck.status) : "offline"}
      className="@container flex h-full min-h-0 flex-col gap-2"
    >
      <div className="flex items-center gap-2">
        <LuckScopeSelect
          prefix="stats-dice"
          className="min-w-0 flex-1"
          value={luckScopeValue(r)}
          sessions={list.result?.sessions ?? []}
          live={live}
          onPick={onScope}
          now={now}
        />
        <Select value={who} onValueChange={onWho} disabled={!live}>
          <SelectTrigger
            data-testid="stats-dice-who"
            className="h-8 min-w-0 flex-1"
            aria-label="Whose rolls"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              value={EVERYONE}
              data-testid="stats-dice-who-option"
              data-record-id={EVERYONE}
            >
              Everyone
            </SelectItem>
            {rows.map((x) => (
              <SelectItem
                key={x.key}
                value={x.key}
                data-testid="stats-dice-who-option"
                data-record-id={x.key}
              >
                {x.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center justify-between gap-2">
        <ToggleGroup
          type="single"
          value={view.mode}
          aria-label="Show bars as"
          data-testid="stats-dice-mode"
          onValueChange={(v) => {
            if (v) onMode(v as ChartMode);
          }}
        >
          {CHART_MODES.map((m) => (
            <ToggleGroupItem key={m} value={m} data-testid="stats-dice-mode-item" data-value={m}>
              {MODE_LABEL[m]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {model.total > 0 ? (
          <span
            data-testid="stats-dice-total"
            className="text-xs text-muted-foreground tabular-nums"
          >
            {model.total.toLocaleString("en-US")} {model.total === 1 ? "d20" : "d20s"} · Avg{" "}
            {avgText(model.avg)}
          </span>
        ) : null}
      </div>
      {failed ? <LoadError retry={retry} /> : null}
      {!r || r.pending ? (
        failed ? null : (
          <SkeletonRows />
        )
      ) : model.total === 0 ? (
        <Empty text="No d20 rolls yet" />
      ) : (
        <>
          <Plot model={model} className={cn(!live && "opacity-60")} />
          <p
            data-testid="stats-dice-note"
            className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground"
          >
            <span aria-hidden className="h-px w-3 bg-foreground" />
            <span data-testid="stats-dice-fair">Fair die: {model.fairText} each.</span>
            <span>Every d20 counts, a dropped advantage die too.</span>
          </p>
        </>
      )}
    </div>
  );
}

/** Y axis, hairline grid, bars from one baseline and the fair-die line over them. */
function Plot({ model, className }: { model: ChartModel; className?: string }) {
  return (
    <div
      data-testid="stats-dice-chart"
      className={cn(
        "grid min-h-0 flex-1 grid-cols-[auto_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto] gap-x-1",
        className,
      )}
    >
      <div aria-hidden className="relative mt-4 w-8">
        {model.ticks.map((t) => (
          <span
            key={t.label}
            className="absolute right-0 translate-y-1/2 text-[10px] leading-none text-muted-foreground tabular-nums"
            style={{ bottom: `${t.at * 100}%` }}
          >
            {t.label}
          </span>
        ))}
      </div>
      <div className="relative mt-4 min-h-14">
        {model.ticks.map((t) => (
          <div
            key={t.label}
            aria-hidden
            className="absolute inset-x-0 h-px bg-border"
            style={{ bottom: `${t.at * 100}%` }}
          />
        ))}
        <div data-chip-row className="absolute inset-0 flex justify-center gap-0.5">
          {model.bars.map((b) => (
            <Tooltip key={b.face} content={b.detail}>
              <div
                data-testid="stats-dice-bar"
                data-record-id={String(b.face)}
                data-value={b.count}
                role="img"
                aria-label={b.detail}
                className="group relative h-full max-w-6 min-w-0 flex-1"
              >
                {b.count > 0 ? (
                  <div
                    className="absolute inset-x-0 bottom-0 min-h-0.5 rounded-t bg-primary/60 group-hover:bg-primary"
                    style={{ height: `${b.at * 100}%` }}
                  />
                ) : null}
                {b.labelled ? (
                  <span
                    data-testid="stats-dice-label"
                    className="absolute left-1/2 -translate-x-1/2 text-[10px] leading-none whitespace-nowrap tabular-nums"
                    style={{ bottom: `calc(${b.at * 100}% + 2px)` }}
                  >
                    {b.text}
                  </span>
                ) : null}
              </div>
            </Tooltip>
          ))}
        </div>
        <div
          aria-hidden
          data-testid="stats-dice-fair-line"
          className="pointer-events-none absolute inset-x-0 h-px bg-foreground"
          style={{ bottom: `${model.fairAt * 100}%` }}
        />
      </div>
      <div />
      <div aria-hidden className="flex justify-center gap-0.5 pt-1">
        {model.bars.map((b) => (
          <span
            key={b.face}
            className="max-w-6 min-w-0 flex-1 text-center text-[10px] leading-none text-muted-foreground tabular-nums"
          >
            {/* Narrow windows keep every fifth face so the labels never touch. */}
            <span className={cn(b.face !== 1 && b.face % 5 !== 0 && "hidden @min-[376px]:inline")}>
              {b.face}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
