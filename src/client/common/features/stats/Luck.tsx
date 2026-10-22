// Luck tab (FR-STATS-37–41, -46, -50) `stats-luck`, both clients: the scope picker (one session,
// default the newest, or Campaign) over a Table of the ack's rows in server order: Name, Rolls,
// d20s, Avg, Nat 20, Nat 1. The DM's ack alone holds the `dm-dice` row (FR-STATS-47). A `pending`
// campaign answer shows skeleton rows and is asked again in 1 s (`useStatsQuery`). Refreshes on
// a live roll entry (FR-STATS-17).
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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
import { avgText, refreshes, sessionLabel } from "./logic";
import { useStatsQuery } from "./query";
import type { QueryState } from "./refresh";
import { Empty, LoadError, SkeletonRows } from "./states";
import type { StatsView } from "./view";

type LuckResult = DmLuckResult | PlayerLuckResult;
const CAMPAIGN = "campaign";

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
      retry={() => {
        list.retry();
        luck.retry();
      }}
    />
  );
}

export function LuckView({
  list,
  luck,
  live,
  onPick,
  retry,
  now,
}: {
  list: Pick<QueryState<unknown, SessionsResult>, "status" | "result">;
  luck: Pick<QueryState<unknown, LuckResult>, "status" | "result">;
  live: boolean;
  onPick(value: string): void;
  retry(): void;
  /** "Today" in the picker (tests pin it). */
  now?: Date;
}) {
  const r = luck.result?.luck ?? null;
  const sessions = list.result?.sessions ?? [];
  const failed = live && (list.status === "error" || luck.status === "error");
  const value = r ? (r.scope === "campaign" ? CAMPAIGN : r.fromN ? String(r.fromN) : "") : "";
  return (
    <div
      data-testid="stats-luck"
      data-state={live ? (r?.pending ? "pending" : luck.status) : "offline"}
      className="flex min-h-0 flex-1 flex-col gap-2"
    >
      <Select value={value} onValueChange={onPick} disabled={!live}>
        <SelectTrigger
          data-testid="stats-luck-scope"
          className="h-8 w-full min-w-0"
          aria-label="Scope"
        >
          <SelectValue placeholder="Newest session" />
        </SelectTrigger>
        <SelectContent>
          {sessions.map((x) => (
            <SelectItem
              key={x.fromN}
              value={String(x.fromN)}
              data-testid="stats-luck-scope-option"
              data-record-id={String(x.fromN)}
            >
              {sessionLabel(x, now)}
            </SelectItem>
          ))}
          <SelectItem
            value={CAMPAIGN}
            data-testid="stats-luck-scope-option"
            data-record-id={CAMPAIGN}
          >
            Campaign
          </SelectItem>
        </SelectContent>
      </Select>
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
