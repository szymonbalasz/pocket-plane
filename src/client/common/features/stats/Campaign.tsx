// Campaign tab (FR-STATS-81–88, sprint 10 T3) `stats-campaign`, both clients, first in the strip:
// a header line (sessions, fights, monsters slain), the party's lifetime table (by Dealt; scrolls
// sideways inside its box when the window is narrow), the campaign records and the session awards
// won per character. Renders the ack as sent (one `stats.query {scope: "campaign"}`, the viewer's
// numbers); a `pending` answer shows skeleton rows and is asked again in 1 s (`useStatsQuery`).
// Refreshes on any live log upsert (FR-STATS-87, as the Session tab).
import {
  CAMPAIGN_RECORD_KEYS,
  type CampaignResult,
  CampaignResult as CampaignSchema,
  type CampaignStats,
} from "@shared/stats/schemas";
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
import { type ColorPerson, useColorOf } from "../campaign-management/colors";
import {
  awardsWonText,
  CAMPAIGN_RECORD_TITLE,
  campaignHeaderText,
  recordValueText,
  recordWhereText,
  refreshes,
} from "./logic";
import { useStatsQuery } from "./query";
import type { QueryState } from "./refresh";
import { Empty, LoadError, SkeletonRows } from "./states";

type Role = "dm" | "player";

export function CampaignPanel({ role }: { role: Role }) {
  const live = useSync((s) => s.state === "live");
  const q = useStatsQuery<CampaignResult>(
    { scope: "campaign" },
    CampaignSchema.parse,
    (f) => refreshes(f, { tab: "campaign", pickedFight: null }),
    (r) => "pending" in r.campaign,
  );
  return <CampaignView role={role} state={q.state} live={live} retry={q.retry} />;
}

export function CampaignView({
  role,
  state,
  live,
  retry,
}: {
  role: Role;
  state: Pick<QueryState<unknown, CampaignResult>, "status" | "result">;
  live: boolean;
  retry(): void;
}) {
  const c = state.result?.campaign ?? null;
  const pending = c !== null && "pending" in c;
  const stats = c !== null && !("pending" in c) ? c : null;
  const failed = live && state.status === "error";
  return (
    <div
      data-testid="stats-campaign"
      data-state={live ? (pending ? "pending" : state.status) : "offline"}
      className="flex min-h-0 flex-1 flex-col gap-2"
    >
      {failed ? <LoadError retry={retry} /> : null}
      {!stats ? (
        failed ? null : (
          <SkeletonRows />
        )
      ) : (
        <div className={cn("flex min-w-0 flex-col gap-3", !live && "opacity-60")}>
          <p
            data-testid="stats-campaign-header"
            data-sessions={stats.sessions}
            data-fights={stats.fights}
            data-slain={stats.slain}
            className="text-xs text-muted-foreground"
          >
            {campaignHeaderText(stats)}
          </p>
          {stats.rows.length === 0 ? (
            <Empty text="No fights yet" />
          ) : (
            <>
              <PartyTable rows={stats.rows} />
              <Records role={role} records={stats.records} />
            </>
          )}
          <AwardsWon awards={stats.awards} />
        </div>
      )}
    </div>
  );
}

const NUM = "px-1 py-1 text-right tabular-nums";
const HEAD = "h-7 px-1 text-right";

/** FR-STATS-82: label, full name (the header's title), row field. */
const COLUMNS = [
  ["Dealt", "Damage dealt", "dealt"],
  ["Taken", "Damage taken", "taken"],
  ["Healed", "Healing done", "healed"],
  ["Kills", "Kills", "kills"],
  ["Down", "Times downed", "downed"],
  ["20s", "Nat 20s", "nat20"],
  ["1s", "Nat 1s", "nat1"],
  ["Fights", "Fights", "fights"],
] as const;

function PartyTable({ rows }: { rows: CampaignStats["rows"] }) {
  return (
    // FR-STATS-88: the table scrolls sideways inside this box, never the window.
    <section data-testid="stats-campaign-party" className="flex min-w-0 flex-col gap-1">
      <h3 className="text-xs font-medium">Party</h3>
      <div data-testid="stats-campaign-scroll" className="min-w-0 overflow-x-auto">
        <Table data-testid="stats-campaign-table" className="text-xs">
          <TableHeader>
            <TableRow>
              <TableHead className="h-7 px-1">Name</TableHead>
              {COLUMNS.map(([label, title]) => (
                <TableHead key={label} className={HEAD} title={title}>
                  {label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key} data-testid="stats-campaign-row" data-record-id={row.key}>
                <TableCell
                  data-testid="stats-campaign-name"
                  // FR-STATS-66: names whole (they wrap), never cut.
                  className="wrap-anywhere px-1 py-1"
                >
                  <Who name={row.name} playerId={row.playerId} />
                </TableCell>
                {COLUMNS.map(([label, , field]) => (
                  <TableCell key={label} data-testid={`stats-campaign-${field}`} className={NUM}>
                    {row[field]}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function Records({ role, records }: { role: Role; records: CampaignStats["records"] }) {
  // BL-121: a record the server left out (withheld for players) has no line; none → no section.
  const keys = CAMPAIGN_RECORD_KEYS.filter((key) => key in records);
  if (keys.length === 0) return null;
  return (
    <section data-testid="stats-campaign-records" className="flex flex-col gap-1">
      <h3 className="text-xs font-medium">Records</h3>
      <ul className="flex flex-col gap-1 text-xs">
        {keys.map((key) => {
          const r = records[key];
          return (
            <li
              key={key}
              data-testid="stats-campaign-record"
              data-record-id={key}
              className="flex min-w-0 flex-col wrap-anywhere"
            >
              <span className="flex flex-wrap items-baseline gap-x-1.5">
                <span className="text-muted-foreground">{CAMPAIGN_RECORD_TITLE[key]}</span>
                <span
                  data-testid="stats-campaign-record-value"
                  className="font-semibold tabular-nums"
                >
                  {r ? recordValueText(key, r, role) : "—"}
                </span>
              </span>
              {r ? (
                <span>
                  <span data-testid="stats-campaign-record-who" data-record-id={r.characterId}>
                    <Who name={r.name} playerId={r.playerId} />
                  </span>{" "}
                  <span data-testid="stats-campaign-record-where" className="text-muted-foreground">
                    {recordWhereText(r)}
                  </span>
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function AwardsWon({ awards }: { awards: CampaignStats["awards"] }) {
  return (
    <section data-testid="stats-campaign-awards" className="flex flex-col gap-1">
      <h3 className="text-xs font-medium">Session awards won</h3>
      {awards.length === 0 ? (
        <Empty text="No awards yet" />
      ) : (
        <ul className="flex flex-col gap-1 text-xs">
          {awards.map((a) => (
            <li
              key={a.key}
              data-testid="stats-campaign-award-row"
              data-record-id={a.key}
              className="min-w-0 wrap-anywhere"
            >
              <span className="font-medium">
                <Who name={a.name} playerId={a.playerId} />
              </span>{" "}
              <span data-testid="stats-campaign-award-total" className="tabular-nums">
                {a.total}
              </span>
              <span className="text-muted-foreground">: {awardsWonText(a)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A character's name in its player's colour (the award cards' rule). */
function Who({ name, playerId }: { name: string; playerId: string | null }) {
  const colorOf = useColorOf();
  const person: ColorPerson = playerId ? { role: "player", playerId } : { role: "dm" };
  return <span style={{ color: colorOf(person) ?? undefined }}>{name}</span>;
}
