// The sheet's Trophies tab (FR-CHARX-97–99, FR-STATS-42–44), both clients, mounted only while the
// tab shows (the sheet renders the shown tab only): `stats.query {scope: "trophies", characterId}`
// on show, again on a live line of the character or its companions (trailing 1 s), and in 1 s on
// a `pending` answer. Lifetime is a label / value grid (2 columns, 1 under 360 px), then Records
// with muted detail lines and the footnote. Renders only the ack (the server answers players for
// their own characters only, FR-STATS-43).
import { COMBATANT_TYPE } from "@shared/combat-tracker/schemas";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import { type TrophiesResult, TrophiesResult as TrophiesSchema } from "@shared/stats/schemas";
import { useMemo } from "react";
import { cn } from "../../../lib/utils";
import { useSync } from "../../../sync/store";
import type { SheetSection } from "../../character-sheet/sections";
import { useStatsQuery } from "../query";
import type { QueryState } from "../refresh";
import { Empty, LoadError, SkeletonRows } from "../states";
import { LIFETIME_ROWS, lifetimeText, RECORD_ROWS, recordText, trophiesRefresh } from "./logic";

type Row = { name?: unknown; entityId?: unknown; ownerCharacterId?: unknown };

/** The names the character's lines carry: its own, and its combatants' and companions'. */
function useNames(characterId: string): ReadonlySet<string> {
  const joined = useSync((s) => {
    const names = new Set<string>();
    const own = s.store.records[ENTITY_TYPE]?.[characterId] as Row | undefined;
    if (typeof own?.name === "string") names.add(own.name);
    for (const c of Object.values(s.store.records[COMBATANT_TYPE] ?? {}) as Row[]) {
      const mine = c.entityId === characterId || c.ownerCharacterId === characterId;
      if (mine && typeof c.name === "string") names.add(c.name);
    }
    return [...names].sort().join("\n");
  });
  return useMemo(() => new Set(joined ? joined.split("\n") : []), [joined]);
}

export function TrophiesTab({
  creatureId,
  client,
}: {
  creatureId: string;
  client: "dm" | "player";
}) {
  const live = useSync((s) => s.state === "live");
  const names = useNames(creatureId);
  const { state, retry } = useStatsQuery<TrophiesResult>(
    { scope: "trophies", characterId: creatureId },
    TrophiesSchema.parse,
    (f) => trophiesRefresh(f, names),
    (r) => r.trophies.pending === true,
  );
  return (
    <TrophiesView
      client={client}
      characterId={creatureId}
      state={state}
      live={live}
      retry={retry}
    />
  );
}

export function TrophiesView({
  client,
  characterId,
  state,
  live,
  retry,
}: {
  client: "dm" | "player";
  characterId: string;
  state: Pick<QueryState<unknown, TrophiesResult>, "status" | "result">;
  live: boolean;
  retry(): void;
}) {
  const t = state.result?.trophies ?? null;
  const failed = live && state.status === "error";
  const ready =
    t && !t.pending && t.lifetime && t.records
      ? { ...t, lifetime: t.lifetime, records: t.records }
      : null;
  return (
    <div
      data-testid="stats-trophies"
      data-record-id={characterId}
      data-state={live ? (t?.pending ? "pending" : state.status) : "offline"}
      className="@container flex flex-col gap-3 p-1 text-sm"
    >
      {failed ? <LoadError retry={retry} /> : null}
      {!ready ? (
        failed ? null : (
          <SkeletonRows />
        )
      ) : (
        <div className={cn("flex flex-col gap-3", !live && "opacity-60")}>
          {ready.lifetime.fights === 0 ? <Empty text="No fights yet" /> : null}
          <section className="flex flex-col gap-1">
            <h3 className="text-xs font-medium text-muted-foreground">Lifetime</h3>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-0.5 @min-[360px]:grid-cols-2">
              {LIFETIME_ROWS.map((r) => {
                const value = lifetimeText(r.key, ready.lifetime);
                return (
                  <div
                    key={r.key}
                    data-testid="stats-trophy"
                    data-record-id={r.key}
                    data-value={value}
                    className="flex justify-between gap-2"
                  >
                    <dt className="text-muted-foreground">{r.label}</dt>
                    <dd className="tabular-nums">{value}</dd>
                  </div>
                );
              })}
            </dl>
          </section>
          <section className="flex flex-col gap-1">
            <h3 className="text-xs font-medium text-muted-foreground">Records</h3>
            <dl className="flex flex-col gap-1">
              {RECORD_ROWS.map((r) => {
                const { value, detail } = recordText(ready.records[r.key], r.key, client);
                return (
                  <div
                    key={r.key}
                    data-testid="stats-trophy"
                    data-record-id={r.key}
                    data-value={value}
                    className="flex flex-wrap justify-between gap-x-2"
                  >
                    <dt className="text-muted-foreground">{r.label}</dt>
                    <dd className="tabular-nums">{value}</dd>
                    {detail ? (
                      <dd
                        data-testid="stats-trophy-detail"
                        className="w-full wrap-anywhere text-xs text-muted-foreground"
                      >
                        {detail}
                      </dd>
                    ) : null}
                  </div>
                );
              })}
            </dl>
          </section>
          <p className="text-xs text-muted-foreground">
            Whole campaign, counted from the game log
            {client === "dm" ? (
              <span data-testid="stats-trophies-dm-note" className="block">
                Includes hidden rolls and fights
              </span>
            ) : null}
          </p>
        </div>
      )}
    </div>
  );
}

/** FR-CHARX-97: sheet section `stats.trophies`, the last tab ("… Macros (90), Trophies"). */
export const statsTrophiesSection: SheetSection = {
  id: "stats.trophies",
  slot: "tab",
  order: 100,
  title: "Trophies",
  kinds: ["character"],
  component: TrophiesTab,
};
