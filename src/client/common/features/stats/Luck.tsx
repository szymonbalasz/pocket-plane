// Luck tab (FR-STATS-37–41, -46, -50) `stats-luck`, both clients: the scope picker (one session,
// default the newest, or Campaign) over a Table of the ack's rows in server order: Name, Rolls,
// d20s, Avg, Nat 20, Nat 1. The DM's ack alone holds the `dm-dice` row (FR-STATS-47). A `pending`
// campaign answer shows skeleton rows and is asked again in 1 s (`useStatsQuery`). Refreshes on
// a live roll entry (FR-STATS-17). Beside the picker, the d20 chart's button (FR-STATS-90).
import {
  DM_DICE_KEY,
  type DmLuckResult,
  DmLuckResult as DmLuckSchema,
  type PlayerLuckResult,
  PlayerLuckResult as PlayerLuckSchema,
  type SessionsResult,
  SessionsResult as SessionsSchema,
  type StatsQueryInput,
} from "@shared/stats/schemas";
import { ChartColumnIcon } from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
} from "../../components/ui/overlays";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/primitives";
import { cn } from "../../lib/utils";
import { useSync } from "../../sync/store";
import { useOpenWindow } from "../play-shell/ShellContext";
import { setChartView } from "./dice-chart";
import { avgText, refreshes, STATS_DICE_INSTANCE, STATS_DICE_KIND, sessionLabel } from "./logic";
import { useStatsQuery } from "./query";
import type { QueryState } from "./refresh";
import { Empty, LoadError, SkeletonRows } from "./states";
import { type StatsView, viewKey } from "./view";

type LuckResult = DmLuckResult | PlayerLuckResult;
export const CAMPAIGN = "campaign";

export const luckInput = (scope: StatsView["luckScope"]): StatsQueryInput =>
  scope === CAMPAIGN
    ? { scope: "luck", campaign: true }
    : scope === null
      ? { scope: "luck" }
      : { scope: "luck", n: scope };

export function LuckPanel({
  role,
  view,
  setView,
}: {
  role: "dm" | "player";
  view: StatsView;
  setView(patch: Partial<StatsView>): void;
}) {
  const live = useSync((s) => s.state === "live");
  const you = useSync((s) => s.store.you);
  const openWindow = useOpenWindow();
  const list = useStatsQuery<SessionsResult>({ scope: "sessions" }, SessionsSchema.parse, (f) =>
    refreshes(f, { tab: "session", pickedFight: null }),
  );
  const parse = role === "dm" ? DmLuckSchema.parse : PlayerLuckSchema.parse;
  const luck = useStatsQuery<LuckResult>(
    luckInput(view.luckScope),
    parse,
    (f) => refreshes(f, { tab: "luck", pickedFight: null }),
    (r) => r.luck.pending === true,
  );
  return (
    <LuckView
      list={list.state}
      luck={luck.state}
      live={live}
      onPick={(v) => setView({ luckScope: v === CAMPAIGN ? CAMPAIGN : Number(v) })}
      onChart={() => {
        setChartView(you ? viewKey(you) : null, { scope: view.luckScope });
        openWindow(STATS_DICE_KIND, STATS_DICE_INSTANCE, { by: "user" });
      }}
      retry={() => {
        list.retry();
        luck.retry();
      }}
    />
  );
}

/** The value the scope picker shows for an answer. */
export const luckScopeValue = (r: { scope: string; fromN?: number } | null) =>
  r ? (r.scope === "campaign" ? CAMPAIGN : r.fromN ? String(r.fromN) : "") : "";

/** One session or Campaign (FR-STATS-40): the Luck tab's picker, and the d20 chart's. */
export function LuckScopeSelect({
  prefix,
  className,
  value,
  sessions,
  live,
  onPick,
  now,
}: {
  prefix: "stats-luck" | "stats-dice";
  className: string;
  value: string;
  sessions: SessionsResult["sessions"];
  live: boolean;
  onPick(value: string): void;
  now?: Date;
}) {
  return (
    <Select value={value} onValueChange={onPick} disabled={!live}>
      <SelectTrigger
        data-testid={`${prefix}-scope`}
        className={cn("h-8", className)}
        aria-label="Scope"
      >
        <SelectValue placeholder="Newest session" />
      </SelectTrigger>
      <SelectContent>
        {sessions.map((x) => (
          <SelectItem
            key={x.fromN}
            value={String(x.fromN)}
            data-testid={`${prefix}-scope-option`}
            data-record-id={String(x.fromN)}
          >
            {sessionLabel(x, now)}
          </SelectItem>
        ))}
        <SelectItem
          value={CAMPAIGN}
          data-testid={`${prefix}-scope-option`}
          data-record-id={CAMPAIGN}
        >
          Campaign
        </SelectItem>
      </SelectContent>
    </Select>
  );
}

export function LuckView({
  list,
  luck,
  live,
  onPick,
  onChart,
  retry,
  now,
}: {
  list: Pick<QueryState<unknown, SessionsResult>, "status" | "result">;
  luck: Pick<QueryState<unknown, LuckResult>, "status" | "result">;
  live: boolean;
  onPick(value: string): void;
  /** FR-STATS-90: opens the d20 chart on this scope. */
  onChart?(): void;
  retry(): void;
  /** "Today" in the picker (tests pin it). */
  now?: Date;
}) {
  const r = luck.result?.luck ?? null;
  const sessions = list.result?.sessions ?? [];
  const failed = live && (list.status === "error" || luck.status === "error");
  return (
    <div
      data-testid="stats-luck"
      data-state={live ? (r?.pending ? "pending" : luck.status) : "offline"}
      className="flex min-h-0 flex-1 flex-col gap-2"
    >
      <div className="flex items-center gap-2">
        <LuckScopeSelect
          prefix="stats-luck"
          className="w-full min-w-0 flex-1"
          value={luckScopeValue(r)}
          sessions={sessions}
          live={live}
          onPick={onPick}
          now={now}
        />
        {onChart ? (
          <Tooltip content="How often each d20 face came up">
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              data-testid="stats-luck-chart"
              onClick={onChart}
            >
              <ChartColumnIcon className="size-3.5" /> Chart
            </Button>
          </Tooltip>
        ) : null}
      </div>
      {failed ? <LoadError retry={retry} /> : null}
      {!r || r.pending ? (
        failed ? null : (
          <SkeletonRows />
        )
      ) : r.rows.length === 0 ? (
        <Empty text="No rolls yet" />
      ) : (
        <Table data-testid="stats-luck-table" className={cn("text-xs", !live && "opacity-60")}>
          <TableHeader>
            <TableRow>
              <TableHead className="h-7 px-1.5">Name</TableHead>
              <TableHead className="h-7 px-1.5 text-right">Rolls</TableHead>
              <TableHead className="h-7 px-1.5 text-right">d20s</TableHead>
              <TableHead className="h-7 px-1.5 text-right">Avg</TableHead>
              <TableHead className="h-7 px-1.5 text-right">Nat 20</TableHead>
              <TableHead className="h-7 px-1.5 text-right">Nat 1</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {r.rows.map((row) => (
              <TableRow
                key={row.key}
                data-testid="stats-luck-row"
                data-record-id={row.key}
                className={cn(row.key === DM_DICE_KEY && "text-muted-foreground")}
              >
                <TableCell data-testid="stats-luck-name" className="wrap-anywhere px-1.5 py-1">
                  {row.name}
                </TableCell>
                <TableCell data-testid="stats-luck-rolls" className={NUM}>
                  {row.rolls}
                </TableCell>
                <TableCell data-testid="stats-luck-d20s" className={NUM}>
                  {row.d20s}
                </TableCell>
                <TableCell data-testid="stats-luck-avg" className={NUM}>
                  {avgText(row.avg)}
                </TableCell>
                <TableCell data-testid="stats-luck-nat20" className={NUM}>
                  {row.nat20}
                </TableCell>
                <TableCell data-testid="stats-luck-nat1" className={NUM}>
                  {row.nat1}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

const NUM = "px-1.5 py-1 text-right tabular-nums";
