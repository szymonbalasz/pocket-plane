// One full sheet (CHARX §7, FR-CHARX-26): header (FR-CHAR-03 + Draft / Locked badges, Edit
// toggle, DM Approve / Lock), header sections, then the tabs Main · Actions · Features ·
// Inventory · Notes · section tabs. Header + tab strip pinned, the tab content scrolls
// (FR-CHARX-48). NPC sheets: CR + XP; imported definitions read-only.
import { initials, levelLine } from "@shared/character-sheet/logic";
import { CHARX_INTENTS, type CreatureSheetRecord } from "@shared/character-sheet/sheet";
import type { DefinitionRecord } from "@shared/entities/schemas";
import { LockIcon } from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { Tooltip } from "../../components/ui/overlays";
import { Badge, Card } from "../../components/ui/primitives";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { cn } from "../../lib/utils";
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
import { sectionsFor } from "./sections";
import { SheetContext, type SheetCtx, useSheet, useSheetIntents } from "./sheet-context";
import { sheetSections } from "./sheet-sections";
import { canEdit, canUseCounters, crLine, headerPinned, sheetData } from "./view-model";

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

function SheetHeader({
  picker,
  editing,
  setEditing,
}: {
  picker: ReactNode;
  editing: boolean;
  setEditing(v: boolean): void;
}) {
  const ctx = useSheet();
  const store = useSync((s) => s.store);
  const c = ctx.creature;
  const s = ctx.stats;
  const combat = c.kind === "character" ? sheetBadge(rollRoutes, store, c.id) : null;
  const sub = "cr" in s ? crLine(s.cr) : levelLine(s.level, s.className);
  const species = "species" in s && s.species ? s.species : null;
  const showStatus = ctx.client === "dm" || c.kind === "character";
  return (
    <div className="flex flex-col gap-1.5">
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
        </div>
        {picker}
      </div>
      {!ctx.readOnly && (
        <SheetSlotView slot="header" creatureId={c.id} client={ctx.client} kind={c.kind} />
      )}
      <HeaderActions editing={editing} setEditing={setEditing} />
    </div>
  );
}

/**
 * FR-CHARX-48: measures the window body (the Card) and the pinned part; pinned while the part
 * takes at most half the body. Window size and geometry are untouched (FR-CHARX-26).
 */
function usePinnedHeader() {
  const bodyRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    const header = headerRef.current;
    if (!body || !header || typeof ResizeObserver === "undefined") return;
    const measure = () => setPinned(headerPinned(header.offsetHeight, body.clientHeight));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(body);
    ro.observe(header);
    return () => ro.disconnect();
  }, []);
  return { bodyRef, headerRef, pinned };
}

export function SheetView({
  creature,
  row,
  client,
  playerId,
  ownerName,
  picker,
  startEditing,
}: {
  creature: DefinitionRecord;
  row: CreatureSheetRecord | undefined;
  client: "dm" | "player";
  playerId: string | null;
  ownerName: string | null;
  picker: ReactNode;
  /** A just-created character: open in edit mode with the creation hint (FR-CHARX-30). */
  startEditing: boolean;
}) {
  const store = useSync((s) => s.store);
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
  const current = tabs.some(([v]) => v === tab) ? tab : "main";
  const { bodyRef, headerRef, pinned } = usePinnedHeader();
  return (
    <SheetContext.Provider value={ctx}>
      <Card
        ref={bodyRef}
        data-testid="char-sheet"
        data-record-id={creature.id}
        data-editing={ctx.editing ? "true" : "false"}
        className={cn(
          "flex h-full flex-col border-0 bg-transparent p-1 shadow-none",
          pinned ? "overflow-hidden" : "overflow-auto",
        )}
      >
        {/* FR-CHARX-48: pinned = only the tab content scrolls; else the Card scrolls as a whole.
            Nothing outside the content box may shrink (an overflow-x box would collapse to 0 px). */}
        <Tabs
          value={current}
          onValueChange={setTab}
          className={cn("flex flex-col gap-2", pinned ? "min-h-0 flex-1" : "shrink-0")}
        >
          <div
            ref={headerRef}
            data-testid="charx-header"
            data-pinned={pinned ? "true" : "false"}
            className="flex shrink-0 flex-col gap-2"
          >
            <SheetHeader picker={picker} editing={ctx.editing} setEditing={setEditing} />
            {hint && ctx.editing && (
              <p data-testid="charx-create-hint" className="rounded-md bg-muted p-2 text-xs">
                {CREATE_HINT}{" "}
                <button type="button" className="underline" onClick={() => setHint(false)}>
                  OK
                </button>
              </p>
            )}
            <div className="shrink-0 overflow-x-auto pb-0.5">
              <TabsList className="w-max">
                {tabs.map(([v, label]) => (
                  <TabsTrigger key={v} value={v} data-testid="charx-tab" data-value={v}>
                    {label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
          </div>
          <div
            data-testid="charx-content"
            className={pinned ? "min-h-0 flex-1 overflow-y-auto" : undefined}
          >
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
