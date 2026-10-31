// `cmp.rules` body (FR-CMP-63–74), both clients: page Tabs (a Select below 420 px), a search
// Input (rule cards + conditions, debounced 200 ms) whose results replace the page until cleared,
// cards as Collapsibles (heading, muted section, text through the one markdown-lite renderer with
// clickable dice, "SRD 5.1" / "House rule"), a star per card (Pinned, per browser), the footer
// attribution + About. Opening on a card (FR-CMP-69) selects its page, opens and scrolls to it, or
// shows it alone. Reads on demand; the DM's New house rule comes in as `houseAction`.
import type { EntrySummary } from "@shared/compendium/rest";
import type { RuleCardBody, RulesIndexResponse } from "@shared/compendium/rules";
import { HOUSE_PAGE_ID, PINNED_PAGE_ID } from "@shared/compendium/rules-pages";
import { ArrowLeftIcon, ChevronDownIcon, ChevronRightIcon, StarIcon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Api } from "../../../api";
import { Button } from "../../../components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../../components/ui/menus";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
} from "../../../components/ui/overlays";
import { Badge, Skeleton } from "../../../components/ui/primitives";
import { SearchInput } from "../../../components/ui/search-input";
import { Tabs, TabsList, TabsTrigger } from "../../../components/ui/tabs";
import { cn } from "../../../lib/utils";
import { useSync } from "../../../sync/store";
import { AboutDialog } from "../credits";
import { MarkdownLite, type OnRef } from "../MarkdownLite";
import {
  fetchRuleCard,
  type RulesRead,
  resolveRuleRef,
  useRuleCards,
  useRuleSearch,
  useRulesIndex,
  useRulesPage,
} from "./fetch";
import {
  EMPTY_COPY,
  pageOfCard,
  RULES_TABS,
  RULES_TABS_MIN_W,
  type RulesRole,
  rulesEmpty,
} from "./logic";
import {
  clearSingle,
  landScrollTop,
  placeTarget,
  scrolled,
  setCardOpen,
  setRulesPage,
  setRulesQuery,
  targetCard,
  useRulesNav,
} from "./nav";
import { rulesPins, usePins } from "./pins";

export interface CardCtx {
  viewer: RulesRole;
  campaignId: string | null;
  pins: readonly string[];
  /** Where the card sits: a page id, `search` or `card` (its open state is kept per place). */
  where: string;
  /** BL-102: an `srd:` reference in a card's text opens its card here. */
  onRef?: OnRef;
}

/** BL-102: open the card an `srd:` reference names; none (or offline) → search its words. */
export async function followRuleRef(api: Api, slug: string) {
  const id = await resolveRuleRef(api, slug).catch(() => null);
  if (id === null) setRulesQuery(slug.replaceAll("-", " "));
  else targetCard(id);
}

function PinButton({ id, ctx }: { id: string; ctx: CardCtx }) {
  const on = ctx.pins.includes(id);
  const label = on ? "Unpin" : "Pin";
  return (
    <Tooltip content={label}>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 shrink-0 p-0"
        data-testid="cmp-rules-pin"
        data-record-id={id}
        data-state={on ? "on" : "off"}
        aria-label={label}
        aria-pressed={on}
        disabled={ctx.campaignId === null}
        onClick={() => ctx.campaignId && rulesPins().toggle(ctx.campaignId, id)}
      >
        <StarIcon className={cn("size-3.5", on && "fill-current text-primary")} />
      </Button>
    </Tooltip>
  );
}

/** FR-CMP-68: "SRD 5.1" on imported cards; "House rule" (+ "DM only" for the DM) on homebrew. */
function CardSource({ card, viewer }: { card: RuleCardBody; viewer: RulesRole }) {
  if (!card.house) return <p className="text-xs text-muted-foreground">SRD 5.1</p>;
  return (
    <p className="flex items-center gap-1 text-xs text-muted-foreground">
      <Badge variant="outline">House rule</Badge>
      {viewer === "dm" && !card.shared && <Badge variant="secondary">DM only</Badge>}
    </p>
  );
}

function CardBody({ card, ctx }: { card: RuleCardBody; ctx: CardCtx }) {
  return (
    <div className="space-y-1.5 px-2 pb-2 text-sm">
      <MarkdownLite
        text={card.text}
        context={{ kind: "plain", label: card.name }}
        onRef={ctx.onRef}
      />
      <CardSource card={card} viewer={ctx.viewer} />
    </div>
  );
}

/** Frames a landing re-applies itself (late layout: the window placed, text laid out). */
const LAND_FRAMES = 6;

/**
 * FR-CMP-69 (BL-98): put a placed card's heading at the top of the rules scroller, now and for a
 * few frames after, then clear `scrollTo`. Only the scroller moves (no `scrollIntoView`: it would
 * also scroll the window body and the page). Returns the cleanup.
 */
function landCard(el: HTMLElement): () => void {
  const scroller = el.closest<HTMLElement>('[data-testid="cmp-rules-scroll"]');
  const align = () => {
    if (!scroller) return;
    const r = scroller.getBoundingClientRect();
    scroller.scrollTop = landScrollTop(
      {
        top: r.top,
        scrollTop: scroller.scrollTop,
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
      },
      el.getBoundingClientRect().top,
    );
  };
  align();
  if (typeof requestAnimationFrame === "undefined") {
    scrolled();
    return () => {};
  }
  let frames = 0;
  let raf = requestAnimationFrame(function again() {
    align();
    if (++frames < LAND_FRAMES) raf = requestAnimationFrame(again);
    else scrolled();
  });
  return () => cancelAnimationFrame(raf);
}

/**
 * A collapsible card; `body` renders only while open (a search result loads its text then). The
 * card an `openRules` placed lands itself once it renders (its page's cards may arrive later).
 */
function CardShell({
  id,
  name,
  section,
  house,
  dmOnly = false,
  ctx,
  body,
}: {
  id: string;
  name: string;
  section: string;
  house: boolean;
  /** BL-104: the DM's unshared house rule, marked while collapsed too. */
  dmOnly?: boolean;
  ctx: CardCtx;
  body: () => ReactNode;
}) {
  const open = useRulesNav((s) => (s.open[ctx.where] ?? []).includes(id));
  const land = useRulesNav((s) => s.scrollTo === id);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (land && ref.current) return landCard(ref.current);
  }, [land]);
  return (
    <Collapsible
      ref={ref}
      open={open}
      onOpenChange={(o) => setCardOpen(ctx.where, id, o)}
      className="rounded-md border"
      data-testid="cmp-rules-card"
      data-record-id={id}
      data-state={open ? "open" : "closed"}
    >
      <div className="flex items-center gap-1 pr-1">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left"
          >
            {open ? (
              <ChevronDownIcon className="size-3.5 shrink-0" />
            ) : (
              <ChevronRightIcon className="size-3.5 shrink-0" />
            )}
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="min-w-0 break-words text-sm font-medium">{name}</span>
                {dmOnly && (
                  <Badge
                    variant="secondary"
                    className="shrink-0 px-1.5 py-0 text-[10px]"
                    data-testid="cmp-rules-dm-only"
                  >
                    DM only
                  </Badge>
                )}
              </span>
              <span className="block break-words text-xs text-muted-foreground">
                {house && section === "" ? "House rule" : section}
              </span>
            </span>
          </button>
        </CollapsibleTrigger>
        <PinButton id={id} ctx={ctx} />
      </div>
      <CollapsibleContent>{open && body()}</CollapsibleContent>
    </Collapsible>
  );
}

export function RuleCard({ card, ctx }: { card: RuleCardBody; ctx: CardCtx }) {
  return (
    <CardShell
      id={card.id}
      name={card.name}
      section={card.section}
      house={card.house}
      dmOnly={ctx.viewer === "dm" && card.house && !card.shared}
      ctx={ctx}
      body={() => <CardBody card={card} ctx={ctx} />}
    />
  );
}

function LoadedText({ api, id, ctx }: { api: Api; id: string; ctx: CardCtx }) {
  const [card, setCard] = useState<RuleCardBody | "error" | null>(null);
  useEffect(() => {
    let live = true;
    fetchRuleCard(api, id).then(
      (c) => live && setCard(c),
      () => live && setCard("error"),
    );
    return () => {
      live = false;
    };
  }, [api, id]);
  if (card === null) return <Skeleton className="mx-2 mb-2 h-12" />;
  if (card === "error") {
    return <p className="px-2 pb-2 text-xs text-muted-foreground">Couldn't load this card</p>;
  }
  return <CardBody card={card} ctx={ctx} />;
}

function ResultCard({ api, r, ctx }: { api: Api; r: EntrySummary; ctx: CardCtx }) {
  return (
    <CardShell
      id={r.id}
      name={r.name}
      section={r.kind === "condition" ? "Conditions" : r.line}
      house={r.sourceLabel === "Homebrew"}
      ctx={ctx}
      body={() => <LoadedText api={api} id={r.id} ctx={ctx} />}
    />
  );
}

function SkeletonCards() {
  return (
    <div className="space-y-1.5" data-testid="cmp-rules-loading">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

/** FR-CMP-73: loading, offline, error + Retry; else the children with the data. */
export function ReadState<T>({
  read,
  children,
}: {
  read: RulesRead<T>;
  children: (data: T) => ReactNode;
}) {
  if (read.state === "loading") return <SkeletonCards />;
  if (read.state === "offline") {
    return (
      <p
        className="p-2 text-sm text-muted-foreground"
        data-testid="cmp-rules-error"
        data-value="offline"
      >
        Offline
      </p>
    );
  }
  if (read.state !== "ready") {
    return (
      <div className="space-y-1.5 p-2 text-sm" data-testid="cmp-rules-error" data-value="error">
        <p className="text-muted-foreground">Couldn't load rules</p>
        <Button size="sm" variant="outline" data-testid="cmp-rules-retry" onClick={read.retry}>
          Retry
        </Button>
      </div>
    );
  }
  return <>{children(read.data)}</>;
}

function Cards({
  cards,
  ctx,
  empty,
}: {
  cards: readonly RuleCardBody[];
  ctx: CardCtx;
  empty: string;
}) {
  if (cards.length === 0) {
    return <p className="p-2 text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <div className="space-y-1.5">
      {cards.map((c) => (
        <RuleCard key={c.id} card={c} ctx={ctx} />
      ))}
    </div>
  );
}

export function EmptyRules({
  viewer,
  onOpenCompendium,
}: {
  viewer: RulesRole;
  onOpenCompendium?: () => void;
}) {
  return (
    <div className="space-y-2 p-2 text-sm" data-testid="cmp-rules-empty">
      <p className="text-muted-foreground">{EMPTY_COPY[viewer]}</p>
      {viewer === "dm" && onOpenCompendium && (
        <Button size="sm" variant="outline" onClick={onOpenCompendium}>
          Open Compendium
        </Button>
      )}
    </div>
  );
}

function PageView({
  api,
  pageId,
  ctx,
  index,
  nonce,
  houseAction,
  onOpenCompendium,
}: {
  api: Api;
  pageId: string;
  ctx: CardCtx;
  index: RulesIndexResponse;
  nonce: number;
  houseAction?: ReactNode;
  onOpenCompendium?: () => void;
}) {
  const house = pageId === HOUSE_PAGE_ID;
  const read = useRulesPage(api, pageId, nonce);
  if (!house && rulesEmpty(index)) {
    return <EmptyRules viewer={ctx.viewer} onOpenCompendium={onOpenCompendium} />;
  }
  return (
    <>
      {house && houseAction && <div className="mb-1.5 flex justify-end">{houseAction}</div>}
      <ReadState read={read}>
        {(data) => (
          <Cards
            cards={data.cards}
            ctx={ctx}
            empty={
              house
                ? ctx.viewer === "dm"
                  ? "No house rules yet"
                  : "No house rules shared yet"
                : "No cards on this page"
            }
          />
        )}
      </ReadState>
    </>
  );
}

function PinnedView({ api, ctx, nonce }: { api: Api; ctx: CardCtx; nonce: number }) {
  const read = useRuleCards(api, ctx.pins, nonce, (gone) => {
    if (ctx.campaignId) rulesPins().drop(ctx.campaignId, gone);
  });
  return (
    <ReadState read={read}>
      {(cards) => (
        <Cards cards={cards} ctx={ctx} empty="Pin a card with its star to keep it here" />
      )}
    </ReadState>
  );
}

function SearchView({ api, q, ctx }: { api: Api; q: string; ctx: CardCtx }) {
  const read = useRuleSearch(api, q);
  if (read === null) return null;
  return (
    <ReadState read={read}>
      {(results) =>
        results.length === 0 ? (
          <p className="p-2 text-sm text-muted-foreground" data-testid="cmp-rules-no-match">
            No matches for ‘{q.trim()}’. Every word must match.
          </p>
        ) : (
          <div className="space-y-1.5">
            {results.map((r) => (
              <ResultCard key={r.id} api={api} r={r} ctx={ctx} />
            ))}
          </div>
        )
      }
    </ReadState>
  );
}

function SingleView({
  api,
  id,
  ctx,
  nonce,
}: {
  api: Api;
  id: string;
  ctx: CardCtx;
  nonce: number;
}) {
  const ids = [id];
  const read = useRuleCards(api, ids, nonce);
  return (
    <div className="space-y-1.5">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2"
        data-testid="cmp-rules-back"
        onClick={clearSingle}
      >
        <ArrowLeftIcon className="size-4" /> Pages
      </Button>
      <ReadState read={read}>
        {(cards) => <Cards cards={cards} ctx={ctx} empty="No longer available" />}
      </ReadState>
    </div>
  );
}

function PagePicker({ page, narrow }: { page: string; narrow: boolean }) {
  if (narrow) {
    return (
      <Select value={page} onValueChange={setRulesPage}>
        <SelectTrigger className="h-8" data-testid="cmp-rules-page-select" data-value={page}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RULES_TABS.map((t) => (
            <SelectItem key={t.id} value={t.id} data-testid="cmp-rules-page" data-value={t.id}>
              {t.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  return (
    <Tabs value={page} onValueChange={setRulesPage}>
      <TabsList className="h-auto w-full flex-wrap justify-start">
        {RULES_TABS.map((t) => (
          <TabsTrigger key={t.id} value={t.id} data-testid="cmp-rules-page" data-value={t.id}>
            {t.title}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

/** The window's width class: Tabs from 420 px, a Select below (FR-CMP-66). */
function useNarrow(ref: React.RefObject<HTMLElement | null>): boolean {
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // The window's own width (its frame), not the body's inner one.
    const frame = el.closest('[data-testid="ui-window"]') ?? el;
    const measure = () => {
      const w = frame.getBoundingClientRect().width;
      if (w > 0) setNarrow(w < RULES_TABS_MIN_W);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(frame);
    return () => ro.disconnect();
  }, [ref]);
  return narrow;
}

export function RulesBody({
  api,
  viewer,
  houseAction,
  onOpenCompendium,
}: {
  api: Api;
  viewer: RulesRole;
  /** DM: New house rule on the House rules page. */
  houseAction?: ReactNode;
  /** DM: the empty state's Open Compendium. */
  onOpenCompendium?: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const narrow = useNarrow(root);
  const page = useRulesNav((s) => s.page);
  const q = useRulesNav((s) => s.q);
  const target = useRulesNav((s) => s.target);
  const single = useRulesNav((s) => s.single);
  const nonce = useRulesNav((s) => s.nonce);
  const campaignId = useSync((s) => s.store.you?.campaignId ?? null);
  const pins = usePins(campaignId);
  const index = useRulesIndex(api, nonce);
  const [about, setAbout] = useState(false);

  // FR-CMP-69: place an asked-for card once the index is known.
  useEffect(() => {
    if (target === null || index.state !== "ready") return;
    placeTarget(target, pageOfCard(index.data, target));
  }, [target, index]);

  const searching = q.trim() !== "";
  const where = searching ? "search" : single !== null ? "card" : page;
  const onRef = useCallback((slug: string) => void followRuleRef(api, slug), [api]);
  const ctx: CardCtx = { viewer, campaignId, pins, where, onRef };
  const attribution = index.state === "ready" ? index.data.attribution : null;
  return (
    <div
      ref={root}
      className="flex h-full min-h-0 flex-col"
      data-testid="cmp-rules-window"
      data-value={page}
    >
      <div className="space-y-1.5 px-2 pt-2">
        <PagePicker page={page} narrow={narrow} />
        <SearchInput
          className="h-8"
          placeholder="Search the rules"
          aria-label="Search the rules"
          data-testid="cmp-rules-search"
          maxLength={100}
          value={q}
          onChange={(e) => setRulesQuery(e.target.value)}
          onClear={() => setRulesQuery("")}
        />
      </div>
      <div
        className="mt-1.5 min-h-0 flex-1 overflow-y-auto px-2 pb-2"
        data-testid="cmp-rules-scroll"
      >
        {searching ? (
          <SearchView api={api} q={q} ctx={ctx} />
        ) : single !== null ? (
          <SingleView api={api} id={single} ctx={ctx} nonce={nonce} />
        ) : page === PINNED_PAGE_ID ? (
          <PinnedView api={api} ctx={ctx} nonce={nonce} />
        ) : (
          <ReadState read={index}>
            {(data) => (
              <PageView
                api={api}
                pageId={page}
                ctx={ctx}
                index={data}
                nonce={nonce}
                houseAction={houseAction}
                onOpenCompendium={onOpenCompendium}
              />
            )}
          </ReadState>
        )}
      </div>
      {/* FR-CMP-68: CC BY 4.0 asks to say what changed (About). */}
      <footer className="flex items-center justify-end gap-1 border-t px-2 py-0.5 text-xs text-muted-foreground">
        <span>Rules text: SRD 5.1 · CC BY 4.0 ·</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1 text-xs"
          data-testid="cmp-rules-about"
          onClick={() => setAbout(true)}
        >
          About
        </Button>
      </footer>
      <AboutDialog
        open={about}
        onOpenChange={setAbout}
        sources={attribution ? [attribution] : []}
      />
    </div>
  );
}
