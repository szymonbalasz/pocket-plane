// One full sheet (CHARX §7, FR-CHARX-26): header (FR-CHAR-03 + Draft / Locked badges, Edit
// toggle, DM Approve / Lock), header sections, then the tabs Main · Actions · Features ·
// Inventory · Notes · section tabs. Header + tab strip pinned, the tab content scrolls; in a
// small window only the name row + tab strip (FR-CHARX-48). NPC sheets: CR + XP; imported
// definitions read-only.
import { initials, levelLine } from "@shared/character-sheet/logic";
import { CHARX_INTENTS, type CreatureSheetRecord } from "@shared/character-sheet/sheet";
import type { DefinitionRecord } from "@shared/entities/schemas";
import { isLoaded, type LoadedSet } from "@shared/protocol/lazy";
import { LockIcon } from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { Tooltip } from "../../components/ui/overlays";
import { Badge, Card } from "../../components/ui/primitives";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { useSync } from "../../sync/store";
import { AssetImg } from "../assets-pipeline/AssetImg";
import { useOpenWindow } from "../play-shell/ShellContext";
import { ActionsTab } from "./ActionsTab";
import { useBusy } from "./fields";
import { MainTab } from "./MainTab";
import { FeaturesTab, InventoryTab, NotesTab } from "./MoreTabs";
import { rollRoutes } from "./roll-routes";
import { sheetBadge } from "./routing";
import { SectionView, SheetSlotView } from "./SheetSections";
import { sectionCount, sectionsFor } from "./sections";
import { SheetContext, type SheetCtx, useSheet, useSheetIntents } from "./sheet-context";
import { sheetSections } from "./sheet-sections";
import {
  canEdit,
  canUseCounters,
  crLine,
  type PinnedPart,
  pinnedPart,
  sheetData,
} from "./view-model";

const NOTHING_LOADED: LoadedSet = { types: [], ids: {} };

/** Creatures window kind (entities): "Derive to customise" opens it (FR-CHARX-31). */
const CREATURES_KIND = "ent.creatures";
export const CREATE_HINT = "Fill in class, ability scores, AC and HP. Your DM approves the sheet.";

export function Portrait({ id, name }: { id: string | null; name: string }) {
  return (
    <div
      data-testid="char-sheet-portrait"
      className="size-11 shrink-0 overflow-hidden rounded-full"
    >
      {id ? (
        <AssetImg id={id} file="thumb" alt={name} className="size-full" />
      ) : (
        <div className="flex size-full items-center justify-center bg-muted text-sm font-semibold text-muted-foreground">
          {initials(name)}
        </div>
      )}
    </div>
  );
}

const TABS = [
  ["main", "Main"],
  ["actions", "Actions"],
  ["features", "Features"],
  ["inventory", "Inventory"],
  ["notes", "Notes"],
] as const;

function HeaderActions({
  editing,
  setEditing,
}: {
  editing: boolean;
  setEditing(v: boolean): void;
}) {
  const ctx = useSheet();
  const live = useSync((s) => s.state === "live");
  const intents = useSheetIntents();
  const busy = useBusy();
  const openWindow = useOpenWindow();
  const c = ctx.creature;
  const isDm = ctx.client === "dm";
  const character = c.kind === "character";
  const toggleEdit = () => {
    const on = !editing;
    setEditing(on);
    // FR-CHARX-16: legacy attacks get ids on the first write; a same-value set triggers it.
    if (on && ctx.stats.attacks.some((a) => a.id === undefined)) {
      busy.run(() => intents.edit(c.id, { initBonus: ctx.stats.initBonus }));
    }
  };
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {ctx.readOnly && (
        <Button
          size="sm"
          variant="outline"
          data-testid="charx-derive"
          onClick={() => openWindow(CREATURES_KIND)}
        >
          Derive to customise
        </Button>
      )}
      {isDm && character && ctx.sheet.status === "draft" && (
        <Button
          size="sm"
          data-testid="charx-approve"
          disabled={!live || busy.busy}
          onClick={() => busy.run(() => intents.send(CHARX_INTENTS.approve, { characterId: c.id }))}
        >
          Approve
        </Button>
      )}
      {isDm && character && (
        <Button
          size="sm"
          variant={ctx.sheet.locked ? "secondary" : "outline"}
          data-testid="charx-lock-toggle"
          data-state={ctx.sheet.locked ? "on" : "off"}
          aria-pressed={ctx.sheet.locked}
          disabled={!live || busy.busy}
          onClick={() =>
            busy.run(() =>
              intents.send(CHARX_INTENTS.setLock, { characterId: c.id, locked: !ctx.sheet.locked }),
            )
          }
        >
          {ctx.sheet.locked ? "Unlock" : "Lock"}
        </Button>
      )}
      {ctx.canEdit && (
        <Button
          size="sm"
          variant={editing ? "secondary" : "outline"}
          data-testid="charx-edit-toggle"
          data-state={editing ? "on" : "off"}
          aria-pressed={editing}
          disabled={!live}
          onClick={toggleEdit}
        >
          {editing ? "Done" : "Edit"}
        </Button>
      )}
    </div>
  );
}

/** "In combat", "Draft", "Locked" badges (FR-CHAR-16, FR-CHARX-26). */
function HeaderBadges() {
  const ctx = useSheet();
  const store = useSync((s) => s.store);
  const c = ctx.creature;
  const combat = c.kind === "character" ? sheetBadge(rollRoutes, store, c.id) : null;
  const showStatus = ctx.client === "dm" || c.kind === "character";
  return (
    <span className="flex flex-wrap gap-1">
      {combat && (
        <Badge data-testid="char-sheet-combat" className="w-fit">
          {combat}
        </Badge>
      )}
      {showStatus && ctx.sheet.status === "draft" && (
        <Badge data-testid="charx-draft" variant="outline" className="w-fit">
          Draft
        </Badge>
      )}
      {showStatus && ctx.sheet.locked && (
        <Tooltip content="Locked by the DM">
          <Badge data-testid="charx-locked" variant="outline" className="w-fit">
            Locked
          </Badge>
        </Tooltip>
      )}
    </span>
  );
}

/**
 * The name row: portrait, name, level line. With the full header pinned (FR-CHARX-48) it also
 * carries the badges and the picker; in the compact fallback those scroll (`HeaderRest`).
 */
function NameRow({ picker, full }: { picker: ReactNode; full: boolean }) {
  const ctx = useSheet();
  const c = ctx.creature;
  const s = ctx.stats;
  const sub = "cr" in s ? crLine(s.cr) : levelLine(s.level, s.className);
  const species = "species" in s && s.species ? s.species : null;
  return (
    <div className="flex items-start gap-3">
      <Portrait id={c.portraitAssetId} name={c.name} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          data-testid="char-sheet-name"
          className="flex items-center gap-1 truncate font-semibold"
        >
          {ctx.readOnly && (
            <LockIcon data-testid="charx-readonly" aria-label="Read-only" className="size-3.5" />
          )}
          {c.name}
        </span>
        <span data-testid="char-sheet-level" className="text-xs text-muted-foreground">
          {sub}
          {species ? ` · ${species}` : ""}
        </span>
        {full && <HeaderBadges />}
      </div>
      {full && picker}
    </div>
  );
}

/**
 * The header below the name row: `header` sections and Edit / Approve / Lock on one line; in the
 * compact fallback (FR-CHARX-48) also the badges and the picker, since all of it scrolls then.
 */
function HeaderRest({
  picker,
  compact,
  editing,
  setEditing,
}: {
  picker: ReactNode;
  compact: boolean;
  editing: boolean;
  setEditing(v: boolean): void;
}) {
  const ctx = useSheet();
  const c = ctx.creature;
  return (
    <>
      {compact && (
        <div className="flex items-start justify-between gap-2">
          <HeaderBadges />
          {picker}
        </div>
      )}
      {/* P3 glitch 12: the `header` sections (e.g. the Effects chips + menu) share one line with
          Edit / Approve / Lock instead of a row of their own. */}
      <div data-testid="charx-header-line" className="flex items-center gap-1.5">
        {!ctx.readOnly && (
          <SheetSlotView
            slot="header"
            creatureId={c.id}
            client={ctx.client}
            kind={c.kind}
            className="flex min-w-0 flex-1 flex-col gap-1"
          />
        )}
        <div className="ml-auto shrink-0">
          <HeaderActions editing={editing} setEditing={setEditing} />
        </div>
      </div>
    </>
  );
}

/** Gap between the pinned part and the scrolling header rest (`gap-2`). */
const HEADER_GAP_PX = 8;

/**
 * FR-CHARX-48: measures the window body (the Card) and the full header (pinned part, plus the
 * scrolling header rest in the compact fallback); full while it takes at most half the body,
 * else compact. Window size and geometry are untouched (FR-CHARX-26).
 */
function usePinnedHeader(initial: PinnedPart) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const restRef = useRef<HTMLDivElement>(null);
  const [part, setPart] = useState<PinnedPart>(initial);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    const header = headerRef.current;
    if (!body || !header || typeof ResizeObserver === "undefined") return;
    const rest = part === "compact" ? restRef.current : null;
    const measure = () => {
      const full = header.offsetHeight + (rest ? rest.offsetHeight + HEADER_GAP_PX : 0);
      setPart((p) => pinnedPart(full, body.clientHeight, p));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(body);
    ro.observe(header);
    if (rest) ro.observe(rest);
    return () => ro.disconnect();
  }, [part]);
  return { bodyRef, headerRef, restRef, part };
}

export function SheetView({
  creature,
  row,
  client,
  playerId,
  ownerName,
  picker,
  startEditing,
  initialPinnedPart = "full",
}: {
  creature: DefinitionRecord;
  row: CreatureSheetRecord | undefined;
  client: "dm" | "player";
  playerId: string | null;
  ownerName: string | null;
  picker: ReactNode;
  /** A just-created character: open in edit mode with the creation hint (FR-CHARX-30). */
  startEditing: boolean;
  /** FR-CHARX-48 part before the first measurement (static renders); measuring decides. */
  initialPinnedPart?: PinnedPart;
}) {
  const store = useSync((s) => s.store);
  // A store without lazy state (static test stores) has nothing loaded.
  const lazyLoaded = useSync((s) => s.lazy?.loaded ?? NOTHING_LOADED);
  const [editing, setEditing] = useState(startEditing);
  const [hint, setHint] = useState(startEditing && client === "player");
  const [tab, setTab] = useState<string>("main");
  const viewer = { role: client, playerId };
  const sheet = sheetData(row);
  const allowed = canEdit(viewer, creature, sheet);
  // FR-CHARX-12: a lock committed while the player edits closes edit mode (drafts dropped).
  useEffect(() => {
    if (!allowed) setEditing(false);
  }, [allowed]);
  // The create ack may arrive after this sheet is already shown (it can sort first).
  useEffect(() => {
    if (!startEditing) return;
    setEditing(true);
    setHint(client === "player");
  }, [startEditing, client]);
  const ctx: SheetCtx = {
    creature,
    stats: creature.statBlock,
    sheet,
    row,
    client,
    npc: creature.kind === "monster",
    readOnly: creature.campaignId === null,
    canEdit: allowed,
    editing: editing && allowed,
    canCount: canUseCounters(viewer, creature),
    ownerName,
  };
  const sectionTabs =
    creature.campaignId === null
      ? []
      : sectionsFor(sheetSections, {
          slot: "tab",
          client,
          kind: creature.kind,
          store,
          creatureId: creature.id,
        });
  const tabs = [...TABS, ...sectionTabs.map((s) => [`section:${s.id}`, s.title ?? s.id] as const)];
  // FR-CHARX-100: a tab section's count Badge (loaded rows only, FR-CHARX-103).
  const loaded = (type: string) => isLoaded(lazyLoaded, type);
  const counts = new Map(
    sectionTabs.map((s) => [`section:${s.id}`, sectionCount(s, store, creature.id, loaded)]),
  );
  const current = tabs.some(([v]) => v === tab) ? tab : "main";
  const { bodyRef, headerRef, restRef, part } = usePinnedHeader(initialPinnedPart);
  const compact = part === "compact";
  const rest = (
    <>
      <HeaderRest picker={picker} compact={compact} editing={ctx.editing} setEditing={setEditing} />
      {hint && ctx.editing && (
        <p data-testid="charx-create-hint" className="rounded-md bg-muted p-2 text-xs">
          {CREATE_HINT}{" "}
          <button type="button" className="underline" onClick={() => setHint(false)}>
            OK
          </button>
        </p>
      )}
    </>
  );
  return (
    <SheetContext.Provider value={ctx}>
      <Card
        ref={bodyRef}
        data-testid="char-sheet"
        data-record-id={creature.id}
        data-editing={ctx.editing ? "true" : "false"}
        className="flex h-full flex-col overflow-hidden border-0 bg-transparent p-1 shadow-none"
      >
        {/* FR-CHARX-48: the pinned part stays, only the content box scrolls. Compact: the name
            row + tab strip are pinned; badges, buttons, picker, sections scroll with the content.
            Nothing outside the content box may shrink (an overflow-x box would collapse to 0 px). */}
        <Tabs value={current} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-2">
          <div
            ref={headerRef}
            data-testid="charx-header"
            data-pinned="true"
            data-pinned-part={part}
            className="flex shrink-0 flex-col gap-2"
          >
            <div className="flex flex-col gap-1.5">
              <NameRow picker={picker} full={!compact} />
              {!compact && rest}
            </div>
            <div className="shrink-0 overflow-x-auto pb-0.5">
              <TabsList className="w-max">
                {tabs.map(([v, label]) => {
                  const n = counts.get(v) ?? null;
                  return (
                    <TabsTrigger
                      key={v}
                      value={v}
                      data-testid="charx-tab"
                      data-value={v}
                      data-count={n ?? undefined}
                    >
                      {label}
                      {n !== null && (
                        <Badge variant="secondary" className="ml-1 px-1 py-0 text-[10px]">
                          {n}
                        </Badge>
                      )}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </div>
          </div>
          <div data-testid="charx-content" className="min-h-0 flex-1 overflow-y-auto">
            {compact && (
              <div
                ref={restRef}
                data-testid="charx-header-rest"
                className="mb-2 flex flex-col gap-1.5"
              >
                {rest}
              </div>
            )}
            <TabsContent value="main">
              <MainTab />
            </TabsContent>
            <TabsContent value="actions">
              <ActionsTab />
            </TabsContent>
            <TabsContent value="features">
              <FeaturesTab />
            </TabsContent>
            <TabsContent value="inventory">
              <InventoryTab />
            </TabsContent>
            <TabsContent value="notes">
              <NotesTab />
            </TabsContent>
            {sectionTabs.map((s) => (
              <TabsContent key={s.id} value={`section:${s.id}`}>
                <SectionView section={s} creatureId={creature.id} client={client} />
              </TabsContent>
            ))}
          </div>
        </Tabs>
      </Card>
    </SheetContext.Provider>
  );
}
