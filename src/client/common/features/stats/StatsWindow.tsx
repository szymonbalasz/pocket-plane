// `stats.board` "Stats" body, both clients (FR-STATS-18, -19, -24; FR-SHELL-93): Fight = a live
// leaderboard over the fight picker, Session = 9 award cards over the session picker (DM: Show
// awards). Renders only what the ack holds (rows in server order, no client aggregation); the
// DM's extra fields are in the DM schema only. Only the shown tab queries.
import type { You } from "@shared/protocol/frames";
import {
  AWARD_TITLE,
  type Award,
  type DmFightResult,
  type DmFightRow,
  DmFightResult as DmFightSchema,
  type PlayerFightResult,
  type PlayerFightRow,
  PlayerFightResult as PlayerFightSchema,
  type SessionResult,
  SessionResult as SessionSchema,
  type SessionsResult,
  SessionsResult as SessionsSchema,
  STATS_SHOW_AWARDS_INTENT,
} from "@shared/stats/schemas";
import { EyeOffIcon } from "lucide-react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
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
  Card,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/primitives";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { cn } from "../../lib/utils";
import { useSync } from "../../sync/store";
import { type ColorPerson, useColorOf } from "../campaign-management/colors";
import {
  awardDetailText,
  awardValueText,
  noDamageYet,
  refreshes,
  STATS_TABS,
  type StatsTab,
  sessionLabel,
  winnerText,
} from "./logic";
import { useStatsQuery } from "./query";
import type { QueryState } from "./refresh";
import { type StatsView, statsViews, viewKey } from "./view";

type Role = "dm" | "player";
type FightResult = DmFightResult | PlayerFightResult;
type AnyRow = DmFightRow | PlayerFightRow;

const TAB_LABEL: Record<StatsTab, string> = { fight: "Fight", session: "Session" };

function useView(you: You | null): [StatsView, (patch: Partial<StatsView>) => void] {
  const key = you ? viewKey(you) : null;
  const views = statsViews();
  const read = () => views.get(key);
  // Not zustand's `useStore`: its server snapshot is the initial state (static render tests).
  const view = useSyncExternalStore(views.state.subscribe, read, read);
  const set = useCallback((patch: Partial<StatsView>) => views.set(key, patch), [views, key]);
  return [view, set];
}

export function StatsWindow() {
  const you = useSync((s) => s.store.you);
  const [view, setView] = useView(you);
  const role: Role = you?.role === "dm" ? "dm" : "player";
  return (
    <div data-testid="stats-board" className="@container flex h-full flex-col gap-2">
      <Tabs value={view.tab} onValueChange={(t) => setView({ tab: t as StatsTab })}>
        <TabsList data-testid="stats-tabs">
          {STATS_TABS.map((t) => (
            <TabsTrigger key={t} value={t} data-testid="stats-tab" data-value={t}>
              {TAB_LABEL[t]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {view.tab === "fight" ? (
        <FightPanel role={role} view={view} setView={setView} />
      ) : (
        <SessionPanel role={role} view={view} setView={setView} />
      )}
    </div>
  );
}

// ---------- states (FR-STATS-24) ----------

function SkeletonRows() {
  return (
    <div data-testid="stats-loading" className="flex flex-col gap-1.5">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-6 w-full" />
      ))}
    </div>
  );
}

function LoadError({ retry }: { retry(): void }) {
  return (
    <div data-testid="stats-error" className="flex items-center gap-2 text-sm text-destructive">
      Couldn't load stats
      <Button
        size="sm"
        variant="outline"
        className="h-6 px-2"
        data-testid="stats-retry"
        onClick={retry}
      >
        Retry
      </Button>
    </div>
  );
}

const Empty = ({ text }: { text: string }) => (
  <p data-testid="stats-empty" className="text-sm text-muted-foreground">
    {text}
  </p>
);

interface PanelProps {
  role: Role;
  view: StatsView;
  setView(patch: Partial<StatsView>): void;
}

/** `not_found` for a picked fight / session (gone or hidden): back to the default. */
function useDropMissing<R>(state: QueryState<unknown, R>, picked: boolean, drop: () => void) {
  const missing = state.status === "error" && state.error?.code === "not_found" && picked;
  useEffect(() => {
    if (missing) drop();
  }, [missing, drop]);
}

// ---------- Fight (FR-STATS-15, -18) ----------

function FightPanel({ role, view, setView }: PanelProps) {
  const live = useSync((s) => s.state === "live");
  const parse = role === "dm" ? DmFightSchema.parse : PlayerFightSchema.parse;
  const { state, retry } = useStatsQuery<FightResult>(
    view.fightKey ? { scope: "fight", encounterId: view.fightKey } : { scope: "fight" },
    parse,
    (f) => refreshes(f, { tab: "fight", pickedFight: view.fightKey }),
  );
  const drop = useCallback(() => setView({ fightKey: null }), [setView]);
  useDropMissing(state, view.fightKey !== null, drop);
  return (
    <FightView
      role={role}
      state={state}
      live={live}
      onPick={(fightKey) => setView({ fightKey })}
      retry={retry}
    />
  );
}

export function FightView({
  role,
  state,
  live,
  onPick,
  retry,
}: {
  role: Role;
  state: Pick<QueryState<unknown, FightResult>, "status" | "result">;
  live: boolean;
  onPick(key: string): void;
  retry(): void;
}) {
  const r = state.result;
  const fight = r?.fight ?? null;
  return (
    <div
      data-testid="stats-fight"
      data-state={live ? state.status : "offline"}
      className="flex min-h-0 flex-1 flex-col gap-2"
    >
      <Select
        value={fight?.key ?? ""}
        onValueChange={onPick}
        disabled={!live || !r || r.fights.length === 0}
      >
        <SelectTrigger
          data-testid="stats-fight-picker"
          className="h-8 w-full min-w-0"
          aria-label="Fight"
        >
          <SelectValue placeholder="No fight" />
        </SelectTrigger>
        <SelectContent>
          {(r?.fights ?? []).map((f) => (
            <SelectItem
              key={f.key}
              value={f.key}
              data-testid="stats-fight-option"
              data-record-id={f.key}
            >
              {f.label}
              {f.status === "started" ? " · live" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {state.status === "error" && live ? <LoadError retry={retry} /> : null}
      {!r ? (
        state.status === "error" && live ? null : (
          <SkeletonRows />
        )
      ) : !fight ? (
        <Empty text="No fight yet" />
      ) : (
        <div className={cn("flex min-h-0 flex-col gap-1", !live && "opacity-60")}>
          <p data-testid="stats-fight-status" className="text-xs text-muted-foreground">
            {fight.status === "started" ? `Round ${fight.round}` : "Ended"}
          </p>
          {fight.rows.length === 0 || noDamageYet(fight.rows) ? (
            <Empty text="No damage yet this fight" />
          ) : null}
          {fight.rows.length > 0 ? <FightTable role={role} rows={fight.rows} /> : null}
        </div>
      )}
    </div>
  );
}

const NUM = "px-1.5 py-1 text-right tabular-nums";

function FightTable({ role, rows }: { role: Role; rows: readonly AnyRow[] }) {
  return (
    <Table data-testid="stats-fight-table" className="text-xs">
      <TableHeader>
        <TableRow>
          <TableHead className="h-7 px-1.5">Name</TableHead>
          <TableHead className="h-7 px-1.5 text-right">Dealt</TableHead>
          <TableHead className="h-7 px-1.5 text-right">Taken</TableHead>
          <TableHead className="h-7 px-1.5 text-right">Healed</TableHead>
          <TableHead className="h-7 px-1.5 text-right">Kills</TableHead>
          {role === "dm" ? <TableHead className="h-7 px-1.5 text-right">Eff.</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const dm = role === "dm" && "effective" in row ? row : null;
          return (
            <TableRow
              key={row.key}
              data-testid="stats-fight-row"
              data-record-id={row.key}
              data-kind={row.kind}
              data-hidden={dm?.hidden || undefined}
            >
              <TableCell
                data-testid="stats-fight-name"
                // FR-STATS-66: names whole (they wrap), never cut.
                className={cn("wrap-anywhere px-1.5 py-1", row.ownerKey && "pl-4")}
              >
                {row.ownerKey ? "↳ " : ""}
                {row.name}
                {dm?.hidden ? (
                  <EyeOffIcon
                    data-testid="stats-fight-hidden"
                    aria-label="Hidden"
                    className="ml-1 inline size-3 text-muted-foreground"
                  />
                ) : null}
              </TableCell>
              <TableCell data-testid="stats-fight-dealt" className={NUM}>
                {row.dealt}
              </TableCell>
              <TableCell data-testid="stats-fight-taken" className={NUM}>
                {row.taken}
              </TableCell>
              <TableCell data-testid="stats-fight-healed" className={NUM}>
                {row.healed}
              </TableCell>
              <TableCell data-testid="stats-fight-kills" className={NUM}>
                {row.kills}
              </TableCell>
              {dm ? (
                <TableCell className={NUM}>
                  <Tooltip
                    content={`Effective (HP actually lost or gained): dealt ${dm.effective.dealt} · taken ${dm.effective.taken} · healed ${dm.effective.healed} · downs ${dm.downs}`}
                  >
                    <span data-testid="stats-fight-effective">{dm.effective.dealt}</span>
                  </Tooltip>
                </TableCell>
              ) : null}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

// ---------- Session (FR-STATS-12, -13, -19, -20) ----------

function SessionPanel({ role, view, setView }: PanelProps) {
  const live = useSync((s) => s.state === "live");
  const connection = useSync((s) => s.connection);
  const list = useStatsQuery<SessionsResult>({ scope: "sessions" }, SessionsSchema.parse, (f) =>
    refreshes(f, { tab: "session", pickedFight: null }),
  );
  const one = useStatsQuery<SessionResult>(
    view.sessionFromN !== null ? { scope: "session", n: view.sessionFromN } : { scope: "session" },
    SessionSchema.parse,
    (f) => refreshes(f, { tab: "session", pickedFight: null }),
  );
  const drop = useCallback(() => setView({ sessionFromN: null }), [setView]);
  useDropMissing(one.state, view.sessionFromN !== null, drop);
  const [sending, setSending] = useState(false);
  const showAwards = (fromN: number) => {
    setSending(true);
    connection
      .sendIntent(STATS_SHOW_AWARDS_INTENT, { fromN })
      .catch((err: unknown) =>
        toast.error(`Couldn't show awards: ${(err as Error)?.message ?? "request failed"}`),
      )
      .finally(() => setSending(false));
  };
  return (
    <SessionView
      role={role}
      list={list.state}
      session={one.state}
      live={live}
      sending={sending}
      onPick={(fromN) => setView({ sessionFromN: fromN })}
      onShowAwards={showAwards}
      retry={() => {
        list.retry();
        one.retry();
      }}
    />
  );
}

export function SessionView({
  role,
  list,
  session,
  live,
  sending = false,
  onPick,
  onShowAwards,
  retry,
  now,
}: {
  role: Role;
  list: Pick<QueryState<unknown, SessionsResult>, "status" | "result">;
  session: Pick<QueryState<unknown, SessionResult>, "status" | "result">;
  live: boolean;
  sending?: boolean;
  onPick(fromN: number): void;
  onShowAwards(fromN: number): void;
  retry(): void;
  /** "Today" in the picker (tests pin it). */
  now?: Date;
}) {
  const s = session.result?.session ?? null;
  const sessions = list.result?.sessions ?? [];
  const failed = live && (list.status === "error" || session.status === "error");
  return (
    <div
      data-testid="stats-session"
      data-state={live ? session.status : "offline"}
      className="flex min-h-0 flex-1 flex-col gap-2"
    >
      <div className="flex items-center gap-2">
        <Select
          value={s ? String(s.fromN) : ""}
          onValueChange={(v) => onPick(Number(v))}
          disabled={!live || sessions.length === 0}
        >
          <SelectTrigger
            data-testid="stats-session-picker"
            className="h-8 min-w-0 flex-1"
            aria-label="Session"
          >
            <SelectValue placeholder="No session" />
          </SelectTrigger>
          <SelectContent>
            {sessions.map((x) => (
              <SelectItem
                key={x.fromN}
                value={String(x.fromN)}
                data-testid="stats-session-option"
                data-record-id={String(x.fromN)}
              >
                {sessionLabel(x, now)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {role === "dm" ? (
          <Button
            size="sm"
            className="h-8"
            data-testid="stats-show-awards"
            disabled={!live || !s || sending}
            onClick={() => s && onShowAwards(s.fromN)}
          >
            Show awards
          </Button>
        ) : null}
      </div>
      {failed ? <LoadError retry={retry} /> : null}
      {!session.result ? (
        failed ? null : (
          <SkeletonRows />
        )
      ) : !s ? (
        <Empty text="No sessions yet" />
      ) : (
        <div
          data-testid="stats-awards"
          data-record-id={String(s.fromN)}
          // FR-STATS-67 (amends FR-STATS-19): columns follow the window body's width (the board is
          // the body less its 2 × 12 px padding): 3 ≥ 600 px, 2 ≥ 380 px, else 1.
          className={cn(
            "grid grid-cols-1 gap-1.5 @min-[356px]:grid-cols-2 @min-[576px]:grid-cols-3",
            !live && "opacity-60",
          )}
        >
          {s.awards.map((a) => (
            <AwardCard key={a.key} award={a} />
          ))}
        </div>
      )}
    </div>
  );
}

function AwardCard({ award: a }: { award: Award }) {
  const colorOf = useColorOf();
  const detail = awardDetailText(a);
  return (
    // FR-STATS-67: one line per part (title, value, winners, detail); names and values wrap
    // inside the card, never into the next one.
    <Card
      data-testid="stats-award"
      data-record-id={a.key}
      className="flex min-w-0 flex-col gap-0.5 wrap-anywhere p-2 text-xs"
    >
      <span className="font-medium text-muted-foreground">{AWARD_TITLE[a.key]}</span>
      <span data-testid="stats-award-value" className="text-sm font-semibold tabular-nums">
        {awardValueText(a)}
      </span>
      <span data-testid="stats-award-winners" className="flex flex-col">
        {a.winners.map((w) => {
          const person: ColorPerson = w.playerId
            ? { role: "player", playerId: w.playerId }
            : { role: "dm" };
          return (
            <span
              key={w.characterId}
              data-testid="stats-award-winner"
              data-record-id={w.characterId}
              style={{ color: colorOf(person) ?? undefined }}
            >
              {winnerText(w)}
            </span>
          );
        })}
        {a.more ? <span className="text-muted-foreground">+{a.more} more</span> : null}
      </span>
      {detail ? (
        <span data-testid="stats-award-detail" className="text-muted-foreground">
          {detail}
        </span>
      ) : null}
    </Card>
  );
}
