// One full sheet (CHARX §7, FR-CHARX-26): header (FR-CHAR-03 + Draft / Locked badges, Edit
// toggle, DM Approve / Lock), header sections, then the tabs Main · Actions · Features ·
// Inventory · Notes · section tabs. Header + tab strip pinned, the tab content scrolls; in a
// small window only the name row + tab strip (FR-CHARX-48). The tab strip scrolls sideways with
// the wheel and arrows (FR-CHARX-115); the sheet body is the `sheet` container the printed
// layout switches on (FR-CHARX-112). NPC sheets: CR + XP; imported definitions read-only.
import { levelLine } from "@shared/character-sheet/logic";
import { CHARX_INTENTS, type CreatureSheetRecord } from "@shared/character-sheet/sheet";
import type { DefinitionRecord } from "@shared/entities/schemas";
import { isLoaded, type LoadedSet } from "@shared/protocol/lazy";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyPlusIcon,
  LockIcon,
} from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { medallionInk, medallionOf } from "../../components/kit/medallion";
import { Button } from "../../components/ui/button";
import { Tooltip } from "../../components/ui/overlays";
import { Badge, Card } from "../../components/ui/primitives";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { cn } from "../../lib/utils";
import { useSync } from "../../sync/store";
import { AssetImg } from "../assets-pipeline/AssetImg";
import { colorHex, colorKeyOf } from "../campaign-management/colors";
import { useOpenWindow } from "../play-shell/ShellContext";
import { ActionsTab } from "./ActionsTab";
import { useBusy } from "./fields";
import { MainTab } from "./MainTab";
import { FeaturesTab, InventoryTab, NotesTab } from "./MoreTabs";
import { PublicRollsMenu } from "./PublicMenu";
import { rollRoutes } from "./roll-routes";
import { SheetOverridesProvider, usePublicOverrides } from "./rolls";
import { sheetBadge } from "./routing";
import { SectionView, SheetSlotView } from "./SheetSections";
import { sectionCount, sectionsFor } from "./sections";
import { SheetContext, type SheetCtx, useSheet, useSheetIntents } from "./sheet-context";
import { sheetSections } from "./sheet-sections";
import {
  canEdit,
  canUseCounters,
  compactFullPx,
  crLine,
  type PinnedPart,
  pinnedPart,
  type SeenFull,
  sheetData,
  TAB_ARROW_STEP_PX,
  tabArrows,
  wheelScroll,
} from "./view-model";

const NOTHING_LOADED: LoadedSet = { types: [], ids: {} };

/** Creatures window kind (entities): "Derive to customise" opens it (FR-CHARX-31). */
const CREATURES_KIND = "ent.creatures";
/** The read-only sheet's Derive button: its label, in the Tooltip (K11). */
export const DERIVE_HINT = "Derive to customise";
export const CREATE_HINT = "Fill in class, ability scores, AC and HP. Your DM approves the sheet.";

/**
 * FR-KIT-85 / K11: the kit's square framed portrait: the image, else the name's initial in name
 * type on `colour` (the owner's player colour) or the neutral muted fill. `large` = the sheet
 * header's 64 px (84 px once the sheet is wide, kit `.portrait`); else 56 px (summary cards).
 * The colour is passed as `--portrait` / `--portrait-ink` so a theme can deepen the fill.
 */
export function Portrait({
  id,
  name,
  colour = null,
  large = false,
  className,
}: {
  id: string | null;
  name: string;
  colour?: string | null;
  large?: boolean;
  className?: string;
}) {
  const m = medallionOf(name, id, colour);
  return (
    <div
      data-testid="char-sheet-portrait"
      data-slot="sheet-portrait"
      className={cn(
        "shrink-0 overflow-hidden rounded-md border",
        large ? "size-16 @min-[560px]/sheet:size-[84px]" : "size-14",
        className,
      )}
      style={
        m.colour && !id
          ? ({
              "--portrait": m.colour,
              "--portrait-ink": medallionInk(m.colour),
            } as CSSProperties)
          : undefined
      }
    >
      {id ? (
        <AssetImg id={id} file="thumb" alt={name} className="size-full object-cover" />
      ) : (
        <div
          data-slot="sheet-portrait-initial"
          data-colour={m.colour ? "player" : "none"}
          className={cn(
            "flex size-full items-center justify-center font-bold leading-none",
            large ? "text-[30px] @min-[560px]/sheet:text-[40px]" : "text-2xl",
            m.colour
              ? "bg-[var(--portrait)] text-[var(--portrait-ink)]"
              : "bg-muted text-muted-foreground",
          )}
        >
          {m.letter}
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

/** FR-KIT-85: the kit's small stone button (`.btn.sm`: 24 px high, 13 px type). */
const SMALL = "h-6 px-2 text-[13px]";

/**
 * FR-KIT-85 / K11: Derive / Approve / Lock / Edit / the DM's Public rolls menu, small, top-right:
 * a column in the narrow sheet (the name keeps its room beside the portrait), a row once wide.
 */
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
    // Narrow: the Public rolls menu left of a column of buttons (two rows at most); wide: a row.
    <div className="flex items-start gap-1 @min-[560px]/sheet:items-center @min-[560px]/sheet:gap-1.5">
      <PublicRollsMenu className={cn(SMALL, "w-6 px-0")} />
      <div className="flex flex-col items-end gap-1 @min-[560px]/sheet:flex-row @min-[560px]/sheet:items-center @min-[560px]/sheet:gap-1.5">
        {ctx.readOnly && (
          // K11 walkthrough F1: a 24-px icon button (the label in its Tooltip), so an imported
          // NPC's name keeps the header's middle column at 320 px.
          <Tooltip content={DERIVE_HINT}>
            <Button
              size="sm"
              className={cn(SMALL, "w-6 px-0")}
              variant="outline"
              data-testid="charx-derive"
              aria-label={DERIVE_HINT}
              onClick={() => openWindow(CREATURES_KIND)}
            >
              <CopyPlusIcon className="size-3.5" />
            </Button>
          </Tooltip>
        )}
        {isDm && character && ctx.sheet.status === "draft" && (
          <Button
            size="sm"
            className={SMALL}
            data-testid="charx-approve"
            disabled={!live || busy.busy}
            onClick={() =>
              busy.run(() => intents.send(CHARX_INTENTS.approve, { characterId: c.id }))
            }
          >
            Approve
          </Button>
        )}
        {isDm && character && (
          <Button
            size="sm"
            className={SMALL}
            variant={ctx.sheet.locked ? "secondary" : "outline"}
            data-testid="charx-lock-toggle"
            data-state={ctx.sheet.locked ? "on" : "off"}
            aria-pressed={ctx.sheet.locked}
            disabled={!live || busy.busy}
            onClick={() =>
              busy.run(() =>
                intents.send(CHARX_INTENTS.setLock, {
                  characterId: c.id,
                  locked: !ctx.sheet.locked,
                }),
              )
            }
          >
            {ctx.sheet.locked ? "Unlock" : "Lock"}
          </Button>
        )}
        {ctx.canEdit && (
          <Button
            size="sm"
            className={SMALL}
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
    </div>
  );
}

/**
 * K11: the kit's chip (`.chip`): a 13-px pill. The sheet's badges use it, and the chips line
 * draws the `header` sections' effect chips the same size, every theme alike.
 */
const CHIP = "w-fit rounded-full px-2.5 py-0.5 text-[13px] font-normal leading-tight";
// The `header` sections' wrappers and chip rows flatten into the line (`contents`): every chip
// and the effects menu wrap as one line (K11 walkthrough: the menu alone on a row at 280 px); a
// chip longer than the line truncates.
const CHIPS_LINE = cn(
  "flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1",
  "[&_[data-testid=charx-section]]:contents [&_[data-testid=cbtx-sheet-effects]]:contents [&_[data-chip-row]]:contents",
  "[&_[data-testid=cbtx-sheet-effects-menu]]:size-6",
  "[&_[data-testid=cbtx-sheet-effect]]:max-w-full [&_[data-testid=cbtx-sheet-effect]]:rounded-full [&_[data-testid=cbtx-sheet-effect]]:px-2 [&_[data-testid=cbtx-sheet-effect]]:py-0.5 [&_[data-testid=cbtx-sheet-effect]]:text-[13px]",
);

/** "In combat", "Draft", "Locked" badges (FR-CHAR-16, FR-CHARX-26), as kit chips. */
function HeaderBadges() {
  const ctx = useSheet();
  const store = useSync((s) => s.store);
  const c = ctx.creature;
  const combat = c.kind === "character" ? sheetBadge(rollRoutes, store, c.id) : null;
  const showStatus = ctx.client === "dm" || c.kind === "character";
  return (
    <>
      {combat && (
        <Badge
          data-testid="char-sheet-combat"
          data-slot="sheet-chip"
          variant="outline"
          className={CHIP}
        >
          {combat}
        </Badge>
      )}
      {showStatus && ctx.sheet.status === "draft" && (
        <Badge data-testid="charx-draft" data-slot="sheet-chip" variant="outline" className={CHIP}>
          Draft
        </Badge>
      )}
      {showStatus && ctx.sheet.locked && (
        <Tooltip content="Locked by the DM">
          <Badge
            data-testid="charx-locked"
            data-slot="sheet-chip"
            variant="outline"
            className={CHIP}
          >
            Locked
          </Badge>
        </Tooltip>
      )}
    </>
  );
}

/**
 * FR-KIT-85: the name in name type (the kit's 21 px, 32 px wide; two lines before it truncates,
 * the full name in its Tooltip). With a picker to show, the name **is** the picker: the select
 * (`char-sheet-picker`) lies over the name and its chevron, transparent, so a click on the name
 * opens it and the keyboard reaches it as before. K11: in the compact fallback too, so no boxed
 * select shows anywhere.
 */
function SheetName({ picker }: { picker: ReactNode }) {
  const ctx = useSheet();
  const name = (
    <span
      data-testid="char-sheet-name"
      data-slot="sheet-name"
      className="flex min-w-0 items-center gap-1 text-[21px] font-bold leading-[1.1] @min-[560px]/sheet:text-[32px]"
    >
      {ctx.readOnly && (
        <LockIcon
          data-testid="charx-readonly"
          aria-label="Read-only"
          className="size-3.5 shrink-0"
        />
      )}
      {/* K11 walkthrough: whole words only (never "Go / b…"), lines balanced as the kit's
          `.cname`; the picker's chevron follows the last word, not the column's edge. */}
      <span className="line-clamp-2 min-w-0 break-normal text-balance">
        {ctx.creature.name}
        {picker && (
          <ChevronDownIcon
            aria-hidden
            className="ml-1 inline size-4 align-middle text-muted-foreground"
          />
        )}
      </span>
    </span>
  );
  if (!picker) return <Tooltip content={ctx.creature.name}>{name}</Tooltip>;
  return (
    <Tooltip content={ctx.creature.name}>
      <span
        data-testid="charx-name-picker"
        className="relative flex min-w-0 max-w-full items-center self-start rounded-sm has-[select:focus-visible]:ring-2 has-[select:focus-visible]:ring-ring"
      >
        {name}
        <span className="absolute inset-0 [&>select]:size-full [&>select]:max-w-none [&>select]:cursor-pointer [&>select]:opacity-0">
          {picker}
        </span>
      </span>
    </Tooltip>
  );
}

/**
 * The header's top (FR-KIT-85, kit "Character sheet"): the square portrait; the name (the picker
 * when shown) and the level line ("Level 5 Ranger · Wood Elf", the background too once wide);
 * pinned in full, the chips line; the small actions top-right, always pinned (K11). The compact
 * fallback (FR-CHARX-48) only moves the chips line into the scrolling content (`HeaderRest`).
 */
function NameRow({
  picker,
  full,
  editing,
  setEditing,
}: {
  picker: ReactNode;
  full: boolean;
  editing: boolean;
  setEditing(v: boolean): void;
}) {
  const ctx = useSheet();
  const c = ctx.creature;
  const s = ctx.stats;
  // The owner's stored colour only: an unknown player stays neutral (no role accent).
  const players = useSync((st) => st.store.records.player);
  const key =
    c.kind === "character"
      ? colorKeyOf(
          { you: null, records: { player: players ?? {} } },
          { role: "player", playerId: c.ownerPlayerId },
        )
      : null;
  const colour = key ? colorHex(key) : null;
  const sub = "cr" in s ? crLine(s.cr) : levelLine(s.level, s.className);
  const species = "species" in s && s.species ? s.species : null;
  const background = c.kind === "character" ? ctx.sheet.background.trim() : "";
  return (
    // A grid: portrait, the name column, the actions. The chips line spans the row under them in
    // the narrow sheet (room for "Concentrating: Bless 10r" beside "In combat", so the header
    // stays pinned at 320 px), and sits under the name once wide (the kit's enlarged sheet).
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1.5">
      <Portrait
        id={c.portraitAssetId}
        name={c.name}
        colour={colour}
        large
        className={full ? "@min-[560px]/sheet:row-span-2" : undefined}
      />
      <div className="flex min-w-0 flex-col gap-1">
        <SheetName picker={picker} />
        <span
          data-testid="char-sheet-level"
          className="text-sm text-muted-foreground @min-[560px]/sheet:text-base"
        >
          <LevelParts parts={[...sub.split(" · "), ...(species ? [species] : [])]} />
          {background && (
            <span className="hidden @min-[560px]/sheet:inline">
              {" "}
              <span className="whitespace-nowrap">· {background}</span>
            </span>
          )}
        </span>
      </div>
      <div data-testid="charx-header-actions" className="ml-auto shrink-0">
        <HeaderActions editing={editing} setEditing={setEditing} />
      </div>
      {full && (
        <ChipsLine className="col-span-3 @min-[560px]/sheet:col-span-1 @min-[560px]/sheet:col-start-2 @min-[560px]/sheet:row-start-2 @min-[560px]/sheet:-mt-1" />
      )}
    </div>
  );
}

/**
 * The level line's parts ("Level 1 Fighter", "Human"; "CR 1/4", "50 XP"): a later part keeps its
 * "·" and its words together, so the line wraps between parts, never right after a "·" (K11).
 */
function LevelParts({ parts }: { parts: readonly string[] }) {
  return parts.map((p, i) =>
    i === 0 ? (
      <span key={p}>{p}</span>
    ) : (
      <span key={p}>
        {" "}
        <span className="whitespace-nowrap">· {p}</span>
      </span>
    ),
  );
}

/** FR-KIT-85 chips line: the badges, then the `header` sections (effect chips, brain menu). */
function ChipsLine({ className }: { className?: string }) {
  const ctx = useSheet();
  const c = ctx.creature;
  return (
    <div data-testid="charx-header-chips" className={cn(CHIPS_LINE, className)}>
      <HeaderBadges />
      {!ctx.readOnly && (
        <SheetSlotView
          slot="header"
          creatureId={c.id}
          client={ctx.client}
          kind={c.kind}
          className="contents"
        />
      )}
    </div>
  );
}

/** K11: the kit's tab (`.tab`): label type 15 px, roomy, the active marker inside it. */
const TAB = "h-auto px-2.5 pt-[5px] pb-2 text-[15px] leading-[1.2]";

/**
 * FR-CHARX-115: the tab strip scrolls sideways only (the active marker sits inside the tab): the
 * wheel turns into sideways scroll, arrows (the kit's ‹ ›) show at an end with hidden tabs, a
 * thin scrollbar stays. The arrows sit beside the strip, never over a tab. K11: while the strip
 * overflows both arrows are drawn, as the kit's, the one at an end with nothing hidden disabled;
 * scrolling never shifts the tabs under the pointer.
 */
function TabStrip({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [arrows, setArrows] = useState({ prev: false, next: false, overflow: false });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => {
      const next = {
        ...tabArrows(el.scrollLeft, el.scrollWidth, el.clientWidth),
        overflow: el.scrollWidth - el.clientWidth > 1,
      };
      setArrows((a) =>
        a.prev === next.prev && a.next === next.next && a.overflow === next.overflow ? a : next,
      );
    };
    // React's wheel listener is passive; turning the wheel sideways needs `preventDefault`.
    const wheel = (e: WheelEvent) => {
      const dx = wheelScroll(e.deltaX, e.deltaY, el.scrollWidth > el.clientWidth);
      if (dx === null) return;
      e.preventDefault();
      el.scrollLeft += dx;
    };
    sync();
    el.addEventListener("scroll", sync, { passive: true });
    el.addEventListener("wheel", wheel, { passive: false });
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync);
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", sync);
      el.removeEventListener("wheel", wheel);
      ro?.disconnect();
    };
  }, []);
  const step = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * TAB_ARROW_STEP_PX });
  const arrow = (dir: 1 | -1, shown: boolean) => (
    <button
      type="button"
      data-testid={dir < 0 ? "charx-tabs-prev" : "charx-tabs-next"}
      aria-label={dir < 0 ? "Earlier tabs" : "More tabs"}
      disabled={!shown}
      className="mb-1.5 flex w-[22px] shrink-0 items-center justify-center rounded-[3px] border text-muted-foreground enabled:hover:bg-accent enabled:hover:text-foreground disabled:opacity-40"
      onClick={() => step(dir)}
    >
      {dir < 0 ? (
        <ChevronLeftIcon className="size-3.5" />
      ) : (
        <ChevronRightIcon className="size-3.5" />
      )}
    </button>
  );
  return (
    <div data-slot="sheet-tabs" className="flex shrink-0 items-stretch gap-1">
      {arrows.overflow && arrow(-1, arrows.prev)}
      <div
        ref={ref}
        className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden pb-1 [scrollbar-width:thin]"
      >
        {children}
      </div>
      {arrows.overflow && arrow(1, arrows.next)}
    </div>
  );
}

/** Gap between the pinned part and the scrolling header rest (`gap-2`). */
const HEADER_GAP_PX = 8;

/**
 * FR-CHARX-48: measures the window body (the Card) and the full header (pinned part, plus the
 * scrolling header rest in the compact fallback); full while it takes at most half the body,
 * else compact. The full header's own height, last seen at this width, counts in compact too:
 * its badges and buttons lay out taller than the compact parts, which flipped the part back and
 * forth for ever (CS walkthrough F1). Window size and geometry are untouched (FR-CHARX-26).
 */
function usePinnedHeader(initial: PinnedPart) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const restRef = useRef<HTMLDivElement>(null);
  const seenFull = useRef<SeenFull | null>(null);
  const [part, setPart] = useState<PinnedPart>(initial);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    const header = headerRef.current;
    if (!body || !header || typeof ResizeObserver === "undefined") return;
    const rest = part === "compact" ? restRef.current : null;
    const measure = () => {
      const width = body.clientWidth;
      let full = header.offsetHeight;
      if (rest)
        full = compactFullPx(full + rest.offsetHeight + HEADER_GAP_PX, seenFull.current, width);
      else seenFull.current = { px: full, width };
      setPart((p) => pinnedPart(full, body.clientHeight, p));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(body);
    ro.observe(header);
    if (rest) ro.observe(rest);
    return () => ro.disconnect();
  }, [part]);
  // K11: a sheet open at load measures its header in the fallback fonts, wider than the theme's,
  // and the full height seen then kept it compact for good. Once the fonts are in, measure the
  // full header again.
  useEffect(() => {
    const fonts = typeof document === "undefined" ? undefined : document.fonts;
    if (!fonts?.ready) return;
    let on = true;
    void fonts.ready.then(() => {
      if (!on) return;
      seenFull.current = null;
      setPart("full");
    });
    return () => {
      on = false;
    };
  }, []);
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
  // K11: one set of DM public overrides for the header's Public rolls menu and Main's rolls.
  const overrides = usePublicOverrides();
  // K11 (DM feedback: "the stat row is missing"): the tabs share one scrolling box, so a tab
  // opened after scrolling another one showed its middle (Main from the HP control down). Each
  // tab now opens at its top.
  const contentRef = useRef<HTMLDivElement>(null);
  const openTab = (v: string) => {
    setTab(v);
    if (contentRef.current) contentRef.current.scrollTop = 0;
  };
  const hintEl = hint && ctx.editing && (
    <p data-testid="charx-create-hint" className="rounded-md bg-muted p-2 text-xs">
      {CREATE_HINT}{" "}
      <button type="button" className="underline" onClick={() => setHint(false)}>
        OK
      </button>
    </p>
  );
  return (
    <SheetContext.Provider value={ctx}>
      <SheetOverridesProvider value={overrides}>
        <Card
          ref={bodyRef}
          data-testid="char-sheet"
          data-record-id={creature.id}
          data-editing={ctx.editing ? "true" : "false"}
          className="@container/sheet flex h-full flex-col overflow-hidden border-0 bg-transparent p-1 shadow-none"
        >
          {/* FR-CHARX-48: the pinned part stays, only the content box scrolls. Compact: the name
            row (with the picker and the actions) + tab strip are pinned; the chips line scrolls
            with the content. Nothing outside the content box may shrink (an overflow-x box would
            collapse to 0 px). */}
          <Tabs
            value={current}
            onValueChange={openTab}
            className="flex min-h-0 flex-1 flex-col gap-2"
          >
            <div
              ref={headerRef}
              data-testid="charx-header"
              data-pinned="true"
              data-pinned-part={part}
              className="flex shrink-0 flex-col gap-2"
            >
              <div className="flex flex-col gap-1.5">
                <NameRow
                  picker={picker}
                  full={!compact}
                  editing={ctx.editing}
                  setEditing={setEditing}
                />
                {!compact && hintEl}
              </div>
              <TabStrip>
                <TabsList className="h-auto w-max p-0">
                  {tabs.map(([v, label]) => {
                    const n = counts.get(v) ?? null;
                    return (
                      <TabsTrigger
                        key={v}
                        value={v}
                        data-testid="charx-tab"
                        data-value={v}
                        data-count={n ?? undefined}
                        className={TAB}
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
              </TabStrip>
            </div>
            <div
              ref={contentRef}
              data-testid="charx-content"
              className="min-h-0 flex-1 overflow-y-auto [overflow-anchor:none]"
            >
              {compact && (
                <div
                  ref={restRef}
                  data-testid="charx-header-rest"
                  className="mb-2 flex flex-col gap-1.5"
                >
                  <ChipsLine />
                  {hintEl}
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
      </SheetOverridesProvider>
    </SheetContext.Provider>
  );
}
