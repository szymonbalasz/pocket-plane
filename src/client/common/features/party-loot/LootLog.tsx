// Party window Loot tab body (FR-LOOT-21; was window `loot.log`), both clients (FR-LOOT-15–19, FR-PARTY-25/27): pot strip with the DM's
// Split… dialog, wallets, DM add form, Move form, log (newest first) with DM Edit on loot rows and
// item rows. Reads the synced store; every change is an intent (`loot.add`, `loot.edit`,
// `loot.move`, `loot.split`). DM-only parts render from `you.role`. *(S9)* The Move form offers the
// Stores (FR-LOOT-34) and the log names them from `stronghold-index` (FR-LOOT-35; a name opens the
// Stronghold window); the Stronghold window's Stores tab reuses `MoveForm` (preset) and `Purse`.
import { CREATURE_SHEET_TYPE, type CreatureSheetRecord } from "@shared/character-sheet/sheet";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import { formatCoin, formatGpValue, nonZeroCoins } from "@shared/party-loot/format";
import type { WireEndpoint } from "@shared/party-loot/schemas";
import {
  COINS_DISPLAY,
  type CoinKey,
  type Coins,
  LOOT_ENTRY_TYPE,
  type LootEntryRecord,
  PARTY_POT_TYPE,
  type PartyPotRecord,
  WALLET_TYPE,
  type WalletRecord,
  ZERO_COINS,
} from "@shared/party-loot/schemas";
import { STRONGHOLD_INDEX_TYPE, type StrongholdIndexRecord } from "@shared/strongholds/schemas";
import { EyeOffIcon, PencilIcon } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/controls";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
} from "../../components/ui/overlays";
import { Badge, Input, Label, Skeleton } from "../../components/ui/primitives";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Tip } from "../../components/ui/tip";
import { cn } from "../../lib/utils";
import { useHasType, useRecords, useSync } from "../../sync/store";
import { timeOf } from "../notifications/parts";
import { useOpenStronghold } from "../strongholds/memory";
import {
  type CharacterRef,
  type CoinDraft,
  canMove,
  draftOf,
  EMPTY_DRAFT,
  editPayload,
  endpointLabel,
  fromOptions,
  intentFailure,
  LOST_ADD,
  LOST_EDIT,
  LOST_MOVE,
  LOST_SPLIT,
  lootPayload,
  MOVE_TO_PARTY,
  type MoveScope,
  type MoveViewer,
  movePayload,
  NO_MOVE_TEXT,
  newestFirst,
  parseCoin,
  type StoresRef,
  splitCharacters,
  splitPayload,
  splitPrefill,
  storesRefs,
  submitEnabled,
  toOptions,
  walletRows,
} from "./logic";

const coinsOf = (c: Coins): Coins => ({ cp: c.cp, sp: c.sp, ep: c.ep, gp: c.gp, pp: c.pp });

/** One Badge per non-zero coin (pp → cp); negatives muted with "−" (FR-LOOT-15). */
function CoinBadges({ coins, testId }: { coins: Coins; testId: string }) {
  return (
    <>
      {nonZeroCoins(coins).map((x) => (
        <Badge
          key={x.coin}
          variant="outline"
          data-testid={testId}
          data-value={x.coin}
          className={cn("px-1.5 py-0 tabular-nums", x.value < 0 && "text-muted-foreground")}
        >
          {formatCoin(x.coin, x.value)}
        </Badge>
      ))}
    </>
  );
}

/** Coin Badges with the "≈ gp" Tooltip; all zero → "No coin". */
export function Purse({
  coins,
  testId,
  emptyTestId,
}: {
  coins: Coins;
  testId: string;
  emptyTestId?: string;
}) {
  if (nonZeroCoins(coins).length === 0) {
    return (
      <span data-testid={emptyTestId} className="text-xs text-muted-foreground">
        No coin
      </span>
    );
  }
  return (
    <Tooltip content={`≈ ${formatGpValue(coins)} gp`}>
      <span className="flex flex-wrap gap-1">
        <CoinBadges coins={coins} testId={testId} />
      </span>
    </Tooltip>
  );
}

export function SectionTitle({
  children,
  ...props
}: { children: string } & React.ComponentProps<"h3">) {
  return (
    // BL-141 (K6c gap 10): `section-label`, the label type a theme gives section headings.
    <h3 data-slot="section-label" className="text-xs font-medium text-muted-foreground" {...props}>
      {children}
    </h3>
  );
}

export type AddMode = "add" | "subtract";

/** FR-LOOT-26: under the coin Inputs of the add and edit forms, always shown. */
export const SUBTRACT_HINT = "Enter a negative amount to subtract.";

const ADD_TEXT: Record<AddMode, { title: string; button: string }> = {
  add: { title: "Add loot", button: "Add" },
  subtract: { title: "Subtract from the pot", button: "Subtract" },
};

/**
 * The DM add form as drawn (FR-LOOT-25, -27): "Subtract" while any coin Input holds a negative
 * integer (mixed signs too: the server's spend rule, so no player toast); enabled only with a
 * non-zero coin ("", 0, "-" or text alone → disabled), on top of FR-LOOT-16's reasons.
 */
export function addForm(text: string, draft: CoinDraft, s: { live: boolean; busy: boolean }) {
  const parsed = lootPayload(text, draft);
  const coins = COINS_DISPLAY.map((k) => parseCoin(draft[k], true) ?? 0);
  const mode: AddMode = coins.some((v) => v < 0) ? "subtract" : "add";
  return {
    parsed,
    mode,
    ...ADD_TEXT[mode],
    enabled: coins.some((v) => v !== 0) && submitEnabled({ valid: parsed.ok, ...s }),
  };
}

function CoinHint() {
  return (
    <p data-testid="loot-add-hint" className="text-xs text-muted-foreground">
      {SUBTRACT_HINT}
    </p>
  );
}

/** Five coin Inputs, pp → cp (FR-LOOT-16, FR-LOOT-18). */
function CoinInputs({
  draft,
  onChange,
  signed,
  testId,
}: {
  draft: CoinDraft;
  onChange(next: CoinDraft): void;
  signed: boolean;
  testId: string;
}) {
  return (
    <div className="grid grid-cols-5 gap-1">
      {COINS_DISPLAY.map((k: CoinKey) => (
        <Input
          key={k}
          data-testid={testId}
          data-value={k}
          aria-label={k}
          placeholder={k}
          inputMode={signed ? "text" : "numeric"}
          className="h-8 px-2 text-xs tabular-nums"
          value={draft[k]}
          onChange={(e) => onChange({ ...draft, [k]: e.target.value })}
        />
      ))}
    </div>
  );
}

/** One intent in flight per form; outcome per FR-LOOT-16–18. */
function useSend(lost: string) {
  const connection = useSync((s) => s.connection);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async (name: string, payload: unknown): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      await connection.sendIntent(name, payload);
      return true;
    } catch (err) {
      const f = intentFailure(err, lost);
      if (f.kind === "toast") toast.error(f.message);
      else setError(f.message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, send };
}

const dirty = (text: string, draft: CoinDraft) =>
  text !== "" || Object.values(draft).some((v) => v !== "");

/** DM add form (FR-LOOT-16, -25–27). */
function AddForm({ live }: { live: boolean }) {
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<CoinDraft>(EMPTY_DRAFT);
  const { busy, error, send } = useSend(LOST_ADD);
  const { parsed, mode, title, button, enabled } = addForm(text, draft, { live, busy });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!enabled || !parsed.ok) return;
    if (await send("loot.add", parsed.value)) {
      setText("");
      setDraft(EMPTY_DRAFT);
    }
  };
  const message = error ?? (!parsed.ok && dirty(text, draft) ? parsed.message : null);
  return (
    <form data-testid="loot-add" onSubmit={submit} className="flex flex-col gap-1">
      <SectionTitle data-testid="loot-add-title" data-mode={mode}>
        {title}
      </SectionTitle>
      <fieldset disabled={!live} className="flex flex-col gap-1">
        <div className="flex gap-1">
          <Input
            data-testid="loot-add-text"
            aria-label="Loot"
            placeholder="Goblin chief's pouch"
            className="h-8 text-sm"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <Button
            type="submit"
            size="sm"
            data-testid="loot-add-submit"
            data-mode={mode}
            disabled={!enabled}
          >
            {button}
          </Button>
        </div>
        <CoinInputs draft={draft} onChange={setDraft} signed testId="loot-add-coin" />
        <CoinHint />
      </fieldset>
      {message && (
        <p data-testid="loot-add-error" role="alert" className="text-xs text-destructive">
          {message}
        </p>
      )}
    </form>
  );
}

/** The characters (full or redacted `entity` records) as the Move form and wallets need them. */
export function useCharacters(): CharacterRef[] {
  const entities = useRecords<CharacterRecordLike>(ENTITY_TYPE);
  return useMemo(
    () =>
      entities
        .filter((e) => e.kind === "character")
        .map((e) => ({ id: e.id, name: e.name, ownerPlayerId: e.ownerPlayerId })),
    [entities],
  );
}

/** *(S9)* The Stores the viewer may use, from the snapshot's `stronghold-index` (FR-LOOT-34). */
export function useStores(): StoresRef[] {
  const index = useRecords<StrongholdIndexRecord>(STRONGHOLD_INDEX_TYPE);
  return useMemo(() => storesRefs(index), [index]);
}

/** One From / To option; the DM's DM-only Stores with eye-off (FR-LOOT-34). */
function OptionItem({ o }: { o: { key: string; label: string; hidden?: true } }) {
  return (
    <SelectItem
      value={o.key}
      data-testid="loot-move-option"
      data-value={o.key}
      data-dm-only={o.hidden ? "true" : undefined}
    >
      {o.hidden && <EyeOffIcon className="size-3.5 text-muted-foreground" aria-label="DM only" />}
      {o.label}
    </SelectItem>
  );
}

/**
 * Move form, both clients (FR-LOOT-18). *(S9)* `scope` adds the Stores (FR-LOOT-34); with a
 * `preset` Stores it is the Stronghold window's "Move to party" (From = the Stores, To = Party pot
 * by default; only pairs with that Stores).
 */
export function MoveForm({
  chars,
  viewer,
  live,
  scope,
}: {
  chars: CharacterRef[];
  viewer: MoveViewer;
  live: boolean;
  scope: MoveScope;
}) {
  const froms = fromOptions(chars, viewer, scope);
  const [fromSel, setFrom] = useState<string>("");
  const from = froms.some((o) => o.key === fromSel) ? fromSel : (froms[0]?.key ?? "");
  const tos = toOptions(chars, viewer, from, scope);
  const [toSel, setTo] = useState<string>("");
  const to = tos.some((o) => o.key === toSel) ? toSel : (tos[0]?.key ?? "");
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<CoinDraft>(EMPTY_DRAFT);
  const { busy, error, send } = useSend(LOST_MOVE);
  const parsed = movePayload(chars, viewer, from, to, text, draft, scope);
  const preset = scope.preset !== undefined;
  const title = preset ? MOVE_TO_PARTY : "Move coin";
  const enabled = submitEnabled({ valid: parsed.ok, live, busy });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!enabled || !parsed.ok) return;
    if (await send("loot.move", parsed.value)) {
      setText("");
      setDraft(EMPTY_DRAFT);
    }
  };
  const message = error ?? (!parsed.ok && dirty(text, draft) ? parsed.message : null);
  if (!canMove(chars, viewer, scope)) {
    return (
      <form
        data-testid="loot-move"
        data-preset={preset ? "stores" : undefined}
        onSubmit={(e) => e.preventDefault()}
        className="flex flex-col gap-1"
      >
        <SectionTitle>{title}</SectionTitle>
        <div className="flex items-center gap-1">
          <span data-testid="loot-move-empty" className="flex-1 text-xs text-muted-foreground">
            {NO_MOVE_TEXT}
          </span>
          <Button type="submit" size="sm" data-testid="loot-move-submit" disabled>
            Move
          </Button>
        </div>
      </form>
    );
  }
  return (
    <form
      data-testid="loot-move"
      data-preset={preset ? "stores" : undefined}
      onSubmit={submit}
      className="flex flex-col gap-1"
    >
      <SectionTitle data-testid="loot-move-title">{title}</SectionTitle>
      <fieldset disabled={!live} className="flex flex-col gap-1">
        <div className="flex items-center gap-1">
          <Select value={from} onValueChange={setFrom}>
            <SelectTrigger
              data-testid="loot-move-from"
              aria-label="From"
              className="h-8 min-w-0 flex-1"
            >
              <SelectValue placeholder="From" />
            </SelectTrigger>
            <SelectContent>
              {froms.map((o) => (
                <OptionItem key={o.key} o={o} />
              ))}
            </SelectContent>
          </Select>
          <span aria-hidden className="text-muted-foreground">
            →
          </span>
          <Select value={to} onValueChange={setTo}>
            <SelectTrigger
              data-testid="loot-move-to"
              aria-label="To"
              className="h-8 min-w-0 flex-1"
            >
              <SelectValue placeholder="To" />
            </SelectTrigger>
            <SelectContent>
              {tos.map((o) => (
                <OptionItem key={o.key} o={o} />
              ))}
            </SelectContent>
          </Select>
        </div>
        <CoinInputs draft={draft} onChange={setDraft} signed={false} testId="loot-move-coin" />
        <div className="flex gap-1">
          <Input
            data-testid="loot-move-text"
            aria-label="Note"
            placeholder="Note (optional)"
            className="h-8 text-sm"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <Button type="submit" size="sm" data-testid="loot-move-submit" disabled={!enabled}>
            Move
          </Button>
        </div>
      </fieldset>
      {message && (
        <p data-testid="loot-move-error" role="alert" className="text-xs text-destructive">
          {message}
        </p>
      )}
    </form>
  );
}

/** DM Split… dialog (FR-PARTY-27): coins prefilled from the pot, approved characters ticked. */
function SplitDialog({
  chars,
  pot,
  live,
  open,
  onOpenChange,
}: {
  chars: CharacterRef[];
  pot: Coins;
  live: boolean;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const sheets = useRecords<CreatureSheetRecord>(CREATURE_SHEET_TYPE);
  const status = useMemo(() => new Map(sheets.map((x) => [x.entityId, x.status])), [sheets]);
  const list = splitCharacters(chars, (id) => status.get(id));
  const [draft, setDraft] = useState<CoinDraft>(EMPTY_DRAFT);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const { busy, error, setError, send } = useSend(LOST_SPLIT);
  // A fresh draft from the pot and the sheets each time the dialog opens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on open only
  useEffect(() => {
    if (!open) return;
    setDraft(splitPrefill(pot));
    setTicked(new Set(list.filter((x) => x.ticked).map((x) => x.character.id)));
    setError(null);
  }, [open]);
  const parsed = splitPayload(
    list.map((x) => x.character.id),
    ticked,
    draft,
  );
  const enabled = submitEnabled({ valid: parsed.ok, live, busy });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!enabled || !parsed.ok) return;
    if (await send("loot.split", parsed.value)) onOpenChange(false);
  };
  const tick = (id: string, on: boolean) =>
    setTicked((t) => {
      const next = new Set(t);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="loot-split-dialog" className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Split the pot</DialogTitle>
          <DialogDescription>
            Each character gets an equal share of each coin; the rest stays in the pot.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-2">
          <fieldset disabled={!live} className="flex flex-col gap-2">
            <CoinInputs draft={draft} onChange={setDraft} signed={false} testId="loot-split-coin" />
            {list.length === 0 ? (
              <span className="text-xs text-muted-foreground">No characters</span>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {list.map(({ character: ch }) => (
                  <li key={ch.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`loot-split-${ch.id}`}
                      data-testid="loot-split-character"
                      data-record-id={ch.id}
                      checked={ticked.has(ch.id)}
                      onCheckedChange={(v) => tick(ch.id, v === true)}
                    />
                    <Label htmlFor={`loot-split-${ch.id}`} className="text-sm font-normal">
                      {ch.name}
                    </Label>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
          <p
            data-testid="loot-split-preview"
            data-valid={parsed.ok}
            className={cn("text-sm", !parsed.ok && "text-muted-foreground")}
          >
            {parsed.ok ? parsed.preview : parsed.message}
          </p>
          {error && (
            <p data-testid="loot-split-error" role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" data-testid="loot-split-submit" disabled={!enabled}>
              Split
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Time({ iso }: { iso: string }) {
  const t = timeOf(iso);
  return (
    <Tooltip content={t.full}>
      <time dateTime={iso} className="text-xs text-muted-foreground tabular-nums">
        {t.short}
      </time>
    </Tooltip>
  );
}

/** A loot row in edit (FR-LOOT-17, -28): same inputs and hint, prefilled; Enter saves, Esc cancels. */
export function EditRow({
  entry,
  live,
  onDone,
}: {
  entry: LootEntryRecord;
  live: boolean;
  onDone(): void;
}) {
  // Typed values are kept if another tab edits the entry meanwhile (LOOT §11).
  const [text, setText] = useState(entry.text);
  const [draft, setDraft] = useState<CoinDraft>(() => draftOf(coinsOf(entry)));
  const { busy, error, send } = useSend(LOST_EDIT);
  const parsed = editPayload(entry, text, draft);
  const canSave = submitEnabled({ valid: parsed.ok, live, busy, unchanged: parsed.unchanged });
  const save = async () => {
    if (!canSave || !parsed.ok) return;
    if (await send("loot.edit", parsed.value)) onDone();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onDone();
    } else if (e.key === "Enter") {
      e.preventDefault();
      void save();
    }
  };
  const message = error ?? (!parsed.ok ? parsed.message : null);
  return (
    <li
      data-testid="loot-entry"
      data-record-id={entry.id}
      data-kind={entry.kind}
      data-edited={entry.editedAt !== null}
      data-editing="true"
      className="flex flex-col gap-1 rounded-md border p-2"
      onKeyDown={onKeyDown}
    >
      <Input
        data-testid="loot-add-text"
        aria-label="Loot"
        className="h-8 text-sm"
        value={text}
        autoFocus
        onChange={(e) => setText(e.target.value)}
      />
      <CoinInputs draft={draft} onChange={setDraft} signed testId="loot-add-coin" />
      {/* FR-LOOT-28: the same hint; Save keeps FR-LOOT-17's rule and its label. */}
      <CoinHint />
      <div className="flex justify-end gap-1">
        <Button size="sm" variant="ghost" data-testid="loot-edit-cancel" onClick={onDone}>
          Cancel
        </Button>
        <Button
          size="sm"
          data-testid="loot-edit-save"
          disabled={!canSave}
          onClick={() => void save()}
        >
          Save
        </Button>
      </div>
      {message && (
        <p data-testid="loot-edit-error" role="alert" className="text-xs text-destructive">
          {message}
        </p>
      )}
    </li>
  );
}

/** *(S9)* A named Stores end opens its Stronghold window (FR-HOLD-23, FR-LOOT-35). */
function StoresName({ strongholdId, label }: { strongholdId: string; label: string }) {
  const open = useOpenStronghold();
  return (
    <button
      type="button"
      data-testid="loot-entry-stores"
      data-record-id={strongholdId}
      className="underline decoration-dotted underline-offset-2 hover:text-foreground"
      onClick={() => open(strongholdId)}
    >
      {label}
    </button>
  );
}

/** One end of a route: its label (FR-LOOT-35), a named Stores as a link. */
function EndName({
  end,
  nameOf,
  strongholdName,
  item,
}: {
  end: WireEndpoint;
  nameOf(id: string): string | undefined;
  strongholdName(id: string): string | undefined;
  item: boolean;
}) {
  if (end.kind === "stores" && strongholdName(end.strongholdId) !== undefined) {
    const label = endpointLabel(end, nameOf, strongholdName);
    return <StoresName strongholdId={end.strongholdId} label={label} />;
  }
  if (item && end.kind === "party") return <>Party</>;
  return <>{endpointLabel(end, nameOf, strongholdName)}</>;
}

function EntryRow({
  entry,
  nameOf,
  strongholdName,
  canEdit,
  onEdit,
}: {
  entry: LootEntryRecord;
  nameOf(id: string): string | undefined;
  strongholdName(id: string): string | undefined;
  canEdit: boolean;
  onEdit?: () => void;
}) {
  const isMove = entry.kind === "move";
  const edited = entry.editedAt !== null;
  const isItem = entry.kind === "item" && entry.qty !== undefined;
  const route = (item: boolean) => (
    <>
      <EndName end={entry.from} nameOf={nameOf} strongholdName={strongholdName} item={item} /> →{" "}
      <EndName end={entry.to} nameOf={nameOf} strongholdName={strongholdName} item={item} />
    </>
  );
  // FR-PARTY-25's item line (as `itemLine` writes it), with named Stores as links.
  const line = isItem ? (
    <span data-testid="loot-entry-item">
      {route(true)}: {entry.text} ×{entry.qty}
    </span>
  ) : null;
  return (
    <li
      data-testid="loot-entry"
      data-record-id={entry.id}
      data-kind={entry.kind}
      data-edited={edited}
      className="flex flex-col gap-1 py-1.5 text-sm"
    >
      <div className="flex items-start gap-1.5">
        <span className="min-w-0 flex-1 break-words">
          {line ??
            (isMove ? <span data-testid="loot-entry-route">{route(false)}</span> : entry.text)}
        </span>
        <Time iso={entry.createdAt} />
        {onEdit && (
          <Tip content="Edit" off={!canEdit}>
            <Button
              size="icon"
              variant="ghost"
              className="size-6"
              aria-label="Edit"
              data-testid="loot-entry-edit"
              disabled={!canEdit}
              onClick={onEdit}
            >
              <PencilIcon className="size-3.5" />
            </Button>
          </Tip>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <CoinBadges coins={coinsOf(entry)} testId="loot-entry-coin" />
        {isMove && entry.text && (
          <span className="text-xs text-muted-foreground">{entry.text}</span>
        )}
        {edited && entry.editedAt && (
          <Tooltip content={`Edited ${timeOf(entry.editedAt).full}`}>
            <Badge
              variant="secondary"
              data-testid="loot-entry-edited"
              className="px-1.5 py-0 text-muted-foreground"
            >
              Edited
            </Badge>
          </Tooltip>
        )}
      </div>
    </li>
  );
}

interface CharacterRecordLike extends CharacterRef {
  kind: string;
}

/** The whole Loot tab body (FR-LOOT-21). */
export function LootLog() {
  const you = useSync((s) => s.store.you);
  const live = useSync((s) => s.state === "live");
  const loaded = useHasType(LOOT_ENTRY_TYPE);
  const entries = useRecords<LootEntryRecord>(LOOT_ENTRY_TYPE);
  const pot = useRecords<PartyPotRecord>(PARTY_POT_TYPE)[0];
  const wallets = useRecords<WalletRecord>(WALLET_TYPE);
  const chars = useCharacters();
  const stores = useStores();
  const names = useMemo(() => new Map(chars.map((c) => [c.id, c.name])), [chars]);
  const holdNames = useMemo(() => new Map(stores.map((s) => [s.id, s.name])), [stores]);
  const [editing, setEditing] = useState<string | null>(null);
  const [splitting, setSplitting] = useState(false);
  const campaignId = you?.campaignId ?? null;
  // A campaign switch discards the open edit (FR-LOOT-17) and closes the Split… dialog.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on campaign change only
  useEffect(() => {
    setEditing(null);
    setSplitting(false);
  }, [campaignId]);

  if (!you || !loaded) {
    return (
      <div className="flex flex-col gap-2 p-3">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }
  const isDm = you.role === "dm";
  const viewer: MoveViewer = { role: you.role, playerId: you.playerId };
  const rows = walletRows(chars, wallets, you.playerId);
  const ownCount = rows.filter((r) => r.own).length;
  const sorted = newestFirst(entries);
  const editingEntry = editing ? entries.find((e) => e.id === editing) : undefined;
  const potCoins = pot ? coinsOf(pot) : ZERO_COINS;

  return (
    <ScrollArea className="h-full">
      <div data-testid="loot-log" className="flex flex-col gap-3 p-3">
        <section className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <SectionTitle>Party pot</SectionTitle>
            {isDm && (
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-xs"
                data-testid="loot-split-open"
                disabled={!live}
                onClick={() => setSplitting(true)}
              >
                Split…
              </Button>
            )}
          </div>
          <div data-testid="loot-pot" className="flex flex-wrap gap-1">
            <Purse coins={potCoins} testId="loot-pot-coin" emptyTestId="loot-pot-empty" />
          </div>
          {isDm && (
            <SplitDialog
              chars={chars}
              pot={potCoins}
              live={live}
              open={splitting}
              onOpenChange={setSplitting}
            />
          )}
        </section>

        <section className="flex flex-col gap-1">
          <SectionTitle>Wallets</SectionTitle>
          {rows.length === 0 ? (
            <span className="text-xs text-muted-foreground">No characters</span>
          ) : (
            <ul className="flex flex-col gap-1">
              {rows.map((r) => (
                <li
                  key={r.character.id}
                  data-testid="loot-wallet"
                  data-record-id={r.character.id}
                  data-own={r.own}
                  className="flex flex-wrap items-center gap-1.5 text-sm"
                >
                  <span className="font-medium">{r.character.name}</span>
                  {r.own && <Badge variant="secondary">You</Badge>}
                  <Purse coins={r.coins} testId="loot-wallet-coin" />
                </li>
              ))}
            </ul>
          )}
        </section>

        {isDm && <AddForm live={live} />}
        {(isDm || ownCount > 0 || stores.length > 0) && (
          <MoveForm chars={chars} viewer={viewer} live={live} scope={{ stores }} />
        )}

        <section className="flex flex-col gap-1">
          <SectionTitle>Log</SectionTitle>
          {sorted.length === 0 ? (
            <span data-testid="loot-log-empty" className="text-xs text-muted-foreground">
              No loot yet
            </span>
          ) : (
            <ul className="flex flex-col divide-y">
              {sorted.map((e) =>
                editingEntry?.id === e.id ? (
                  <EditRow
                    key={`edit-${e.id}`}
                    entry={e}
                    live={live}
                    onDone={() => setEditing(null)}
                  />
                ) : (
                  <EntryRow
                    key={e.id}
                    entry={e}
                    nameOf={(id) => names.get(id)}
                    strongholdName={(id) => holdNames.get(id)}
                    canEdit={live}
                    onEdit={isDm && e.kind === "loot" ? () => setEditing(e.id) : undefined}
                  />
                ),
              )}
            </ul>
          )}
        </section>
      </div>
    </ScrollArea>
  );
}
