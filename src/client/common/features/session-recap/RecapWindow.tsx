// `recap.session` "Recap" body, both clients (FR-RECAP-10–19, -22, -24): one scrolling column of
// sections over stats' session picker. Renders only what the ack holds (the server filtered and
// counted per role, FR-RECAP-08); the DM's extras are in the DM schema only. DM: Share + Copy as
// Markdown, sections players don't see greyed "Hidden from players"; players: Copy, the note.
import type { You } from "@shared/protocol/frames";
import {
  DmRecapResult,
  PlayerRecapResult,
  RECAP_SHARE_INTENT,
  type RecapSection,
  SECTION_TITLE,
} from "@shared/session-recap/schemas";
import { feedText } from "@shared/stats/feed";
import {
  AWARD_TITLE,
  type Award,
  type SessionsResult,
  SessionsResult as SessionsSchema,
} from "@shared/stats/schemas";
import { CopyIcon, EyeOffIcon, Share2Icon } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
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
import { cn } from "../../lib/utils";
import { useSync } from "../../sync/store";
import { type ColorPerson, useColorOf } from "../campaign-management/colors";
import { awardDetailText, awardValueText, sessionLabel, winnerText } from "../stats/logic";
import { useStatsQuery } from "../stats/query";
import { viewKey } from "../stats/view";
import {
  coinsText,
  fightMeta,
  headerText,
  holderText,
  isEmptyRecap,
  listBehind,
  lootAmount,
  mvpText,
  pickerSessions,
  type Recap,
  recapMarkdown,
  refreshes,
  rollText,
  sectionState,
  shareOpenOf,
  visibleSections,
} from "./logic";
import { recapViews } from "./open";
import type { QueryState } from "./query";
import { EMPTY_DRAFT, ShareDialog, type ShareDraft, shareInput } from "./ShareDialog";
import { useRecapQuery } from "./use-recap";

type Role = "dm" | "player";
type RecapResult = { recap: Recap | null };

function useView(you: You | null): [number | null, (fromN: number | null) => void] {
  const key = you ? viewKey(you) : null;
  const views = recapViews();
  const read = () => views.get(key).fromN;
  const fromN = useSyncExternalStore(views.state.subscribe, read, read);
  const set = useCallback((n: number | null) => views.set(key, { fromN: n }), [views, key]);
  return [fromN, set];
}

/** Page memory: the DM's Share draft survives a close and a reconnect (DM §11). */
let draftMemory: ShareDraft = EMPTY_DRAFT;

/** FR-RECAP-19: the clipboard write (injected in tests). */
export async function copyRecap(
  recap: Recap,
  role: Role,
  write: (text: string) => Promise<void> = (t) => navigator.clipboard.writeText(t),
): Promise<boolean> {
  try {
    await write(recapMarkdown(recap, role));
    toast("Recap copied");
    return true;
  } catch {
    toast.error("Couldn't copy");
    return false;
  }
}

export function RecapWindow() {
  const you = useSync((s) => s.store.you);
  const role: Role = you?.role === "dm" ? "dm" : "player";
  const live = useSync((s) => s.state === "live");
  const connection = useSync((s) => s.connection);
  const [fromN, setFromN] = useView(you);
  const list = useStatsQuery<SessionsResult>(
    { scope: "sessions" },
    SessionsSchema.parse,
    () => false,
  );
  const listed = list.state.result?.sessions ?? null;
  const lastRecap = useRef<Recap | null>(null);
  const newestFromN = pickerSessions(listed ?? [], lastRecap.current)[0]?.fromN ?? null;
  const newest = fromN === null || fromN === newestFromN;
  const parse = role === "dm" ? DmRecapResult.parse : PlayerRecapResult.parse;
  const shownFromN = useRef<number | null>(null);
  const recap = useRecapQuery<RecapResult>(
    fromN === null ? {} : { n: fromN },
    parse,
    (f) => refreshes(f, newest),
    (f) => shareOpenOf(f)?.fromN === shownFromN.current,
  );
  shownFromN.current = recap.state.result?.recap?.fromN ?? null;
  lastRecap.current = recap.state.result?.recap ?? null;
  // RC5: a recap answer the session list doesn't cover yet (a new session, a grown span) asks
  // stats' list again, so the picker lists the shown session and a pick keeps its id.
  // Checked once per recap answer (a list answer that is still behind never loops).
  const behind = useRef(false);
  behind.current = listBehind(listed, lastRecap.current);
  const retryList = list.retry;
  const answered = recap.state.result;
  useEffect(() => {
    if (answered && behind.current) retryList();
  }, [answered, retryList]);
  // A picked session gone (`not_found`): back to the newest.
  const missing = recap.state.status === "error" && recap.state.error?.code === "not_found";
  useEffect(() => {
    if (missing && fromN !== null) setFromN(null);
  }, [missing, fromN, setFromN]);
  const [sharing, setSharing] = useState(false);
  const [draft, setDraft] = useState<ShareDraft>(draftMemory);
  const onDraft = (d: ShareDraft) => {
    draftMemory = d;
    setDraft(d);
  };
  const shown = recap.state.result?.recap ?? null;
  return (
    <>
      <RecapBody
        role={role}
        list={list.state}
        recap={recap.state}
        live={live}
        onPick={setFromN}
        onShare={() => setSharing(true)}
        onCopy={(r) => void copyRecap(r, role)}
        retry={() => {
          list.retry();
          recap.retry();
        }}
      />
      {role === "dm" && shown ? (
        <ShareDialog
          open={sharing}
          onOpenChange={setSharing}
          label={shown.label}
          live={live}
          draft={draft}
          onDraft={onDraft}
          onSend={() =>
            connection.sendIntent(RECAP_SHARE_INTENT, shareInput(shown.fromN, draft)).then(() => {
              onDraft(EMPTY_DRAFT);
              toast("Recap shared");
            })
          }
        />
      ) : null}
    </>
  );
}

/** FR-RECAP-17 states + the sections; pure props (render tests). */
export function RecapBody({
  role,
  list,
  recap,
  live,
  onPick,
  onShare,
  onCopy,
  retry,
  now,
}: {
  role: Role;
  list: Pick<QueryState<unknown, SessionsResult>, "status" | "result">;
  recap: Pick<QueryState<unknown, RecapResult>, "status" | "result">;
  live: boolean;
  onPick(fromN: number | null): void;
  onShare(): void;
  onCopy(recap: Recap): void;
  retry(): void;
  /** "Today" in the picker (tests pin it). */
  now?: Date;
}) {
  const r = recap.result?.recap ?? null;
  const sessions = pickerSessions(list.result?.sessions ?? [], r);
  const failed = live && recap.status === "error";
  return (
    <div
      data-testid="recap-window"
      data-state={live ? recap.status : "offline"}
      className="@container flex h-full min-h-0 flex-col gap-2 overflow-y-auto"
    >
      <div className="flex items-center gap-2">
        <Select
          value={r ? String(r.fromN) : ""}
          onValueChange={(v) => onPick(Number(v))}
          disabled={!live || sessions.length === 0}
        >
          <SelectTrigger
            data-testid="recap-session-picker"
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
                data-testid="recap-session-option"
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
            data-testid="recap-share"
            disabled={!live || !r}
            onClick={onShare}
          >
            <Share2Icon className="size-3.5" />
            Share
          </Button>
        ) : null}
        <Tooltip content="Copy as Markdown">
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            data-testid="recap-copy"
            aria-label="Copy as Markdown"
            disabled={!r}
            onClick={() => r && onCopy(r)}
          >
            <CopyIcon className="size-3.5" />
          </Button>
        </Tooltip>
      </div>
      {failed ? (
        <div data-testid="recap-error" className="flex items-center gap-2 text-sm text-destructive">
          Couldn't load the recap
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2"
            data-testid="recap-retry"
            onClick={retry}
          >
            Retry
          </Button>
        </div>
      ) : null}
      {!recap.result ? (
        failed ? null : (
          <div data-testid="recap-loading" className="flex flex-col gap-1.5">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        )
      ) : !r ? (
        <Empty text="No sessions yet" />
      ) : (
        <RecapSections role={role} recap={r} muted={!live} />
      )}
    </div>
  );
}

const Empty = ({ text }: { text: string }) => (
  <p data-testid="recap-empty" className="text-sm text-muted-foreground">
    {text}
  </p>
);

const Hidden = () => (
  <EyeOffIcon
    data-testid="recap-hidden"
    aria-label="Hidden"
    className="ml-0.5 inline size-3 text-muted-foreground"
  />
);

function Section({
  role,
  recap,
  k,
  children,
}: {
  role: Role;
  recap: Recap;
  k: RecapSection;
  children: ReactNode;
}) {
  const state = sectionState(recap, k);
  const greyed = role === "dm" && state === "hidden-from-players";
  return (
    <section
      data-testid="recap-section"
      data-record-id={k}
      data-state={state}
      className={cn("flex flex-col gap-1", greyed && "opacity-60")}
    >
      {k === "header" ? null : (
        <h3 className="flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {SECTION_TITLE[k]}
          {greyed ? (
            <span className="normal-case tracking-normal">· Hidden from players</span>
          ) : null}
        </h3>
      )}
      {children}
    </section>
  );
}

export function RecapSections({
  role,
  recap: r,
  muted,
}: {
  role: Role;
  recap: Recap;
  muted: boolean;
}) {
  const sections = visibleSections(r);
  return (
    <div className={cn("flex flex-col gap-3", muted && "opacity-60")}>
      <Section role={role} recap={r} k="header">
        <p className="text-sm font-medium">{r.label}</p>
        <p className="text-xs text-muted-foreground tabular-nums">{headerText(r)}</p>
        {r.shared?.note ? (
          <blockquote
            data-testid="recap-note"
            className="border-l-2 pl-2 text-sm whitespace-pre-wrap wrap-anywhere italic"
          >
            {r.shared.note}
          </blockquote>
        ) : null}
      </Section>
      {isEmptyRecap(r) ? <Empty text="Nothing happened yet this session" /> : null}
      {isEmptyRecap(r) ? null : (
        <>
          <Section role={role} recap={r} k="fights">
            {r.fights.length === 0 ? <Empty text="No fights this session" /> : null}
            {r.fights.map((f) => (
              <Card
                key={f.key}
                data-testid="recap-fight"
                data-record-id={f.key}
                className="flex flex-col gap-0.5 p-2 text-xs wrap-anywhere"
              >
                <span className="text-sm font-medium">{f.label}</span>
                <span className="text-muted-foreground">
                  {fightMeta(f)}
                  {mvpText(f) ? ` · MVP ${mvpText(f)}` : ""}
                </span>
                {f.kills.events.length ? (
                  <span>
                    <span className="text-muted-foreground">Kills: </span>
                    {f.kills.events.map((e) => feedText(e)).join("; ")}
                    {f.kills.more ? ` +${f.kills.more}` : ""}
                  </span>
                ) : null}
                {f.downed.events.length ? (
                  <span>
                    <span className="text-muted-foreground">Downs: </span>
                    {f.downed.events.map((e) => feedText(e)).join("; ")}
                    {f.downed.more ? ` +${f.downed.more}` : ""}
                  </span>
                ) : null}
                {"standing" in f && f.standing.length ? (
                  <span data-testid="recap-standing">
                    <span className="text-muted-foreground">Still standing: </span>
                    {f.standing.map((s, i) => (
                      <span key={s.key}>
                        {i > 0 ? ", " : ""}
                        {s.name}
                        {s.hidden ? <Hidden /> : null}
                      </span>
                    ))}
                  </span>
                ) : null}
              </Card>
            ))}
            {r.fightsMore ? (
              <span className="text-xs text-muted-foreground">+{r.fightsMore} more</span>
            ) : null}
          </Section>
          {sections.includes("party") && r.party ? (
            <Section role={role} recap={r} k="party">
              <PartyTable rows={r.party} />
            </Section>
          ) : null}
          {sections.includes("loot") && r.loot ? (
            <Section role={role} recap={r} k="loot">
              <LootTable loot={r.loot} />
            </Section>
          ) : null}
          {sections.includes("rolls") && r.rolls ? (
            <Section role={role} recap={r} k="rolls">
              <ul className="flex flex-col text-xs">
                {r.rolls.rows.map((x) => (
                  <li key={x.id} data-testid="recap-roll" data-record-id={x.id}>
                    {rollText(x)}
                    {"hidden" in x && x.hidden ? <Hidden /> : null}
                  </li>
                ))}
                {r.rolls.more ? (
                  <li className="text-muted-foreground">+{r.rolls.more} more</li>
                ) : null}
              </ul>
            </Section>
          ) : null}
          {sections.includes("awards") && r.awards ? (
            <Section role={role} recap={r} k="awards">
              <div className="grid grid-cols-1 gap-1.5 @min-[376px]:grid-cols-2">
                {r.awards
                  .filter((a) => a.value !== null)
                  .map((a) => (
                    <AwardCard key={a.key} award={a} />
                  ))}
              </div>
            </Section>
          ) : null}
        </>
      )}
    </div>
  );
}

function PartyTable({ rows }: { rows: NonNullable<Recap["party"]> }) {
  const colorOf = useColorOf();
  return (
    <Table className="text-xs">
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead className="text-right">Dealt</TableHead>
          <TableHead className="text-right">Kills</TableHead>
          <TableHead className="text-right" title="Times downed">
            Down
          </TableHead>
          <TableHead className="text-right">Healed</TableHead>
          <TableHead className="text-right">20s</TableHead>
          <TableHead className="text-right">1s</TableHead>
          <TableHead className="text-right" title="Average d20">
            Avg
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((p) => {
          const person: ColorPerson = p.playerId
            ? { role: "player", playerId: p.playerId }
            : { role: "dm" };
          return (
            <TableRow
              key={p.characterId}
              data-testid="recap-party-row"
              data-record-id={p.characterId}
            >
              <TableCell className="wrap-anywhere" style={{ color: colorOf(person) ?? undefined }}>
                {p.name}
              </TableCell>
              <TableCell className="text-right tabular-nums">{p.dealt}</TableCell>
              <TableCell className="text-right tabular-nums">{p.kills}</TableCell>
              <TableCell className="text-right tabular-nums">{p.downed}</TableCell>
              <TableCell className="text-right tabular-nums">{p.healed}</TableCell>
              <TableCell className="text-right tabular-nums">{p.nat20}</TableCell>
              <TableCell className="text-right tabular-nums">{p.nat1}</TableCell>
              <TableCell className="text-right tabular-nums">{p.avg ?? "—"}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function LootTable({ loot }: { loot: NonNullable<Recap["loot"]> }) {
  const totals = [
    coinsText(loot.totals.coins),
    ...loot.totals.items.map((i) => `${i.name} ${i.qty > 0 ? "+" : "−"}${Math.abs(i.qty)}`),
  ].filter((x) => x !== "");
  return (
    <>
      <Table className="text-xs">
        <TableBody>
          {loot.rows.map((row) => (
            <TableRow key={row.id} data-testid="recap-loot-row" data-record-id={row.id}>
              <TableCell className="wrap-anywhere">{row.text || "Coins"}</TableCell>
              <TableCell className="text-muted-foreground">{holderText(row)}</TableCell>
              <TableCell className="text-right tabular-nums">{lootAmount(row) || "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {loot.more ? <span className="text-xs text-muted-foreground">+{loot.more} more</span> : null}
      {totals.length ? (
        <span data-testid="recap-loot-totals" className="text-xs">
          <span className="text-muted-foreground">Totals: </span>
          {totals.join("; ")}
        </span>
      ) : null}
    </>
  );
}

/** Stats' award card, as the Session tab shows it (FR-RECAP-16). */
function AwardCard({ award: a }: { award: Award }) {
  const colorOf = useColorOf();
  const detail = awardDetailText(a);
  return (
    <Card
      data-testid="recap-award"
      data-record-id={a.key}
      className="flex min-w-0 flex-col gap-0.5 wrap-anywhere p-2 text-xs"
    >
      <span className="font-medium text-muted-foreground">{AWARD_TITLE[a.key]}</span>
      <span className="text-sm font-semibold tabular-nums">{awardValueText(a)}</span>
      <span className="flex flex-col">
        {a.winners.map((w) => {
          const person: ColorPerson = w.playerId
            ? { role: "player", playerId: w.playerId }
            : { role: "dm" };
          return (
            <span key={w.characterId} style={{ color: colorOf(person) ?? undefined }}>
              {winnerText(w)}
            </span>
          );
        })}
        {a.more ? <span className="text-muted-foreground">+{a.more} more</span> : null}
      </span>
      {detail ? <span className="text-muted-foreground">{detail}</span> : null}
    </Card>
  );
}
