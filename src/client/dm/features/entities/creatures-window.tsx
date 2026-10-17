// `ent.creatures` (FR-ENT-18, FR-ENT-20, ENT §7): every definition the campaign can use,
// read-only. Characters and customs live from sync; imported monsters from the compendium search
// (FR-CMP-17: debounced 150 ms, pages of 50 + More), their definitions loaded on demand
// (`useDefinitions`). Rows are HTML5 drag sources for the canvas (FR-MAP-13), data unchanged.
import type { PlayerRecord } from "@shared/campaign-management/schemas";
import type { SearchResponse } from "@shared/compendium/rest";
import {
  DEFINITION_DRAG_MIME,
  type DefinitionDragData,
  ENTITY_TYPE,
} from "@shared/entities/schemas";
import { Button } from "@ui/components/ui/button";
import { Tooltip } from "@ui/components/ui/overlays";
import {
  Badge,
  Input,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableRow,
} from "@ui/components/ui/primitives";
import { Tabs, TabsList, TabsTrigger } from "@ui/components/ui/tabs";
import { AssetImg } from "@ui/features/assets-pipeline/AssetImg";
import { useDefinitions } from "@ui/features/compendium/definitions";
import { lazyApi, searchCompendium, useCompendiumSearch } from "@ui/features/compendium/search";
import { defineWindow } from "@ui/features/play-shell/registry";
import { useRecords, useSync } from "@ui/sync/store";
import { LockIcon, PawPrintIcon, UserIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { actionsOf, type CreatureAction, creatureActions } from "./creature-actions";
import {
  CREATURE_TABS,
  type CreatureRow,
  type CreatureTab,
  creatureRows,
  matchCreatureRows,
} from "./list";

/** The DM REST client, imported lazily (the session reads localStorage at import). */
const api = lazyApi(() => import("../campaign-management/session").then((m) => m.api));

export const CREATURES_KIND = "ent.creatures";

const TAB_LABEL: Record<CreatureTab, string> = {
  all: "All",
  character: "Characters",
  monster: "Monsters",
};

function Portrait({ row }: { row: CreatureRow }) {
  if (row.portraitAssetId) {
    return <AssetImg id={row.portraitAssetId} file="thumb" alt="" className="size-8 rounded-sm" />;
  }
  const Icon = row.kind === "character" ? UserIcon : PawPrintIcon;
  return (
    <div className="flex size-8 items-center justify-center rounded-sm bg-muted text-muted-foreground">
      <Icon className="size-4" />
    </div>
  );
}

function Row({ row, actions }: { row: CreatureRow; actions: ReturnType<typeof actionsOf>["row"] }) {
  return (
    <TableRow
      data-testid="ent-list-row"
      data-record-id={row.id}
      data-kind={row.kind}
      draggable
      onDragStart={(e) => {
        const data: DefinitionDragData = { definitionId: row.id };
        e.dataTransfer.setData(DEFINITION_DRAG_MIME, JSON.stringify(data));
        e.dataTransfer.effectAllowed = "copy";
      }}
      className="cursor-grab active:cursor-grabbing"
    >
      <TableCell className="w-10 p-1.5">
        <Portrait row={row} />
      </TableCell>
      {/* Name column takes the free width (w-full + max-w-0: truncate inside a table). CR /
          XP sit on the second line, so a narrow window still shows names. */}
      <TableCell className="w-full max-w-0 p-1.5">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium" data-testid="ent-list-row-name" title={row.name}>
            {row.name}
          </span>
          {row.readOnly && (
            <Tooltip content="Read-only — derive to customise">
              <span data-testid="ent-list-row-lock" className="shrink-0 text-muted-foreground">
                <LockIcon className="size-3.5" aria-label="Read-only" />
              </span>
            </Tooltip>
          )}
        </div>
        <div className="truncate text-xs tabular-nums text-muted-foreground">
          {row.kind === "character" ? "Character" : "Monster"}
          {row.cr !== null && (
            <>
              {" · "}
              <span data-testid="ent-list-row-cr">
                CR {row.cr} · {row.xp} XP
              </span>
            </>
          )}
          {row.derivedFrom !== null && (
            <span data-testid="ent-list-row-derived"> · derived from {row.derivedFrom}</span>
          )}
        </div>
      </TableCell>
      <TableCell className="w-px whitespace-nowrap p-1.5">
        <Badge data-testid="ent-list-row-badge" variant={row.readOnly ? "outline" : "secondary"}>
          {row.badge}
        </Badge>
      </TableCell>
      {actions.length > 0 && (
        <TableCell className="w-px whitespace-nowrap p-1.5">
          {actions.map((a) => (
            <a.component key={a.id} row={row} />
          ))}
        </TableCell>
      )}
    </TableRow>
  );
}

/**
 * Imported monsters matching `q` (FR-CMP-17): the first page from the debounced search, further
 * pages on `loadMore` (kept per query).
 */
function useImportedMonsters(q: string, enabled: boolean) {
  const text = q.trim();
  const first = useCompendiumSearch(api, { q: text, kind: "monster" }, { enabled });
  const [more, setMore] = useState<{ q: string; pages: SearchResponse[] }>({ q: "", pages: [] });
  const extra = more.q === text ? more.pages : [];
  const last = extra.at(-1) ?? first.page;
  const loadMore = () => {
    const cursor = last?.nextCursor;
    if (!cursor) return;
    searchCompendium(api, { q: text, kind: "monster", cursor }).then(
      (p) => setMore((m) => ({ q: text, pages: [...(m.q === text ? m.pages : []), p] })),
      () => {},
    );
  };
  const results = enabled
    ? [...(first.page?.results ?? []), ...extra.flatMap((p) => p.results)]
    : [];
  return { results, hasMore: enabled && Boolean(last?.nextCursor), loadMore };
}

export function CreaturesList({
  actions = creatureActions,
}: {
  actions?: readonly CreatureAction[];
}) {
  const entities = useRecords<unknown>(ENTITY_TYPE);
  const players = useRecords<PlayerRecord>("player");
  const everLive = useSync((s) => s.everLive);
  const [tab, setTab] = useState<CreatureTab>("all");
  const [q, setQ] = useState("");
  const imported = useImportedMonsters(q, tab !== "character");
  // Imported rows need their definitions (CR, portrait, actions); derived customs their base's name.
  const ids = useMemo(() => {
    const out = new Set(imported.results.flatMap((r) => (r.definitionId ? [r.definitionId] : [])));
    for (const e of entities) {
      const base = (e as { derivedFromId?: string | null }).derivedFromId;
      if (base) out.add(base);
    }
    return [...out];
  }, [imported.results, entities]);
  const defs = useDefinitions(ids).byId;
  const rows = useMemo(() => {
    const shown = new Set(imported.results.map((r) => r.definitionId));
    const importedDefs = [...defs.values()].filter((d) => d.campaignId === null && shown.has(d.id));
    // FR-ENT-18: store and loaded imported rows alike match by the shared name tier (FR-CMP-37).
    return matchCreatureRows(creatureRows(entities, importedDefs, players, tab), q).map((r) => {
      const base = r.definition.derivedFromId;
      return base && r.derivedFrom === "(unknown)" && defs.has(base)
        ? { ...r, derivedFrom: defs.get(base)?.name ?? r.derivedFrom }
        : r;
    });
  }, [entities, defs, imported.results, players, tab, q]);
  const { toolbar, row: rowActions } = useMemo(() => actionsOf(actions), [actions]);

  return (
    <section aria-label="Creatures" data-testid="ent-list" className="flex min-h-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        <Tabs value={tab} onValueChange={(v) => setTab(v as CreatureTab)}>
          <TabsList>
            {CREATURE_TABS.map((t) => (
              <TabsTrigger key={t} value={t} data-testid={`ent-list-tab-${t}`}>
                {TAB_LABEL[t]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="ml-auto flex items-center gap-1">
          {toolbar.map((a) => (
            <a.component key={a.id} tab={tab} />
          ))}
        </div>
      </div>
      <Input
        data-testid="ent-list-search"
        aria-label="Search creatures"
        placeholder="Search creatures…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {!everLive ? (
        <div className="flex flex-col gap-2" data-testid="ent-list-loading">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-9" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p data-testid="ent-list-empty" className="py-6 text-center text-sm text-muted-foreground">
          {q.trim() === "" ? "No creatures yet" : `No creature matches ‘${q.trim()}’`}
        </p>
      ) : (
        <Table>
          <TableBody>
            {rows.map((r) => (
              <Row key={r.id} row={r} actions={rowActions} />
            ))}
          </TableBody>
        </Table>
      )}
      {imported.hasMore && (
        <Button variant="ghost" size="sm" data-testid="ent-list-more" onClick={imported.loadMore}>
          More
        </Button>
      )}
    </section>
  );
}

function CreaturesBody() {
  return <CreaturesList />;
}

export const creaturesWindow = defineWindow({
  kind: CREATURES_KIND,
  title: "Creatures",
  clients: ["dm"],
  // Left edge, top (map-first, #162; protocol §18): above `dice.log` at 1600×900. Shares the
  // spot with `map.scenes` / `cbt.encounters`; the second one opened goes to the next free slot
  // (FR-SHELL-08).
  defaultSize: { w: 340, h: 512 },
  minSize: { w: 300, h: 240 },
  defaultPosition: { anchor: "top-left", dx: 56 },
  launcher: { icon: PawPrintIcon, label: "Creatures", order: 30 },
  component: CreaturesBody,
});
