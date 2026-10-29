// The sheet's gem block (FR-CHARX-71, -72, FR-GEM-32, -35; OQ-CHARX-37 A: the header chip row).
// Five icon + count chips and the static "max 5" label for everyone who sees the sheet; the owner
// gets the Spend menu (plain spends, 4-s confirm, FR-GEM-17); the DM gets a Popover per chip with
// − / + and the same Spend menu (OQ-GEM-14 A). Gems are DM-awarded play state, so the sheet lock
// never blocks this; controls are disabled while not `live` (FR-CHARX-76). FR-GEM-43: quick ± clicks
// are summed (`award-batch.ts`) into one `gem.adjust`; the count shows the sum at once, muted.
import { GEM_SPEND_INTENT, type GemKind } from "@shared/gems/schemas";
import { CheckIcon, ChevronDownIcon, MinusIcon, PlusIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/menus";
import { Tooltip } from "../../components/ui/overlays";
import { Tip } from "../../components/ui/tip";
import { cn } from "../../lib/utils";
import { useSync } from "../../sync/store";
import { intentErrorText } from "../character-sheet/routing";
import type { SheetSection } from "../character-sheet/sections";
import { type AwardBatch, createAwardBatch } from "./award-batch";
import { GemCountChip, GemIcon } from "./GemCounts";
import {
  affordable,
  CONFIRM_MS,
  countsOf,
  GEM_TIP,
  type GemChip,
  type GemCounts,
  gemChips,
  gemSectionAvailable,
  gemsRow,
  MAX_LABEL,
  MAX_TIP,
  maySpend,
  SPEND_CHOICES,
  type SpendChoice,
  spendPayload,
} from "./model";

/** One gem intent in flight; a reject shows inline (`gem-error`). */
export function useGemIntent() {
  const connection = useSync((s) => s.connection);
  const live = useSync((s) => s.state === "live");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const send = useCallback(
    async (name: string, payload: unknown): Promise<boolean> => {
      if (inFlight.current) return false;
      inFlight.current = true;
      setBusy(true);
      setError(null);
      try {
        await connection.sendIntent(name, payload);
        return true;
      } catch (err) {
        setError(intentErrorText(err));
        return false;
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [connection],
  );
  return { send, live, error, disabled: busy || !live };
}

/** DM: the chip opens a Popover with − / + for that gem; clicks sum (FR-GEM-43). */
function DmChip({
  chip,
  creatureId,
  disabled,
  batch,
}: {
  chip: GemChip;
  creatureId: string;
  disabled: boolean;
  batch: AwardBatch;
}) {
  const { count, pending } = batch.shown(creatureId, chip.gem, chip.count);
  const adjust = (gem: GemKind, step: 1 | -1) => batch.click(creatureId, gem, step, chip.count);
  const shown = cn("tabular-nums", pending && "text-muted-foreground");
  return (
    <Popover
      onOpenChange={(open) => {
        // FR-GEM-43: closing the popover sends the pending sum now.
        if (!open) batch.flush(creatureId, chip.gem);
      }}
    >
      <Tooltip content={GEM_TIP[chip.gem]}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid="gem-count"
            data-value={chip.gem}
            data-count={count}
            data-pending={pending || undefined}
            aria-label={chip.label}
            className={cn(
              "inline-flex h-6 items-center gap-0.5 rounded-sm px-1 text-xs tabular-nums hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              chip.muted && "text-muted-foreground",
            )}
          >
            <GemIcon gem={chip.gem} className={cn(chip.muted && "opacity-60")} />
            <span className={shown}>{count}</span>
          </button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent
        data-testid="gem-adjust"
        data-value={chip.gem}
        className="flex w-auto items-center gap-2 p-2"
      >
        <GemIcon gem={chip.gem} />
        <span className="text-sm font-medium">{chip.name}</span>
        <Tip content={`Remove a ${chip.name} gem`} off={disabled || count <= 0}>
          <Button
            size="icon"
            variant="outline"
            className="size-7"
            data-testid="gem-remove"
            data-value={chip.gem}
            aria-label={`Remove a ${chip.name} gem`}
            disabled={disabled || count <= 0}
            onClick={() => adjust(chip.gem, -1)}
          >
            <MinusIcon className="size-3.5" />
          </Button>
        </Tip>
        <span
          data-testid="gem-adjust-count"
          data-value={chip.gem}
          data-pending={pending || undefined}
          className={cn("w-6 text-center text-sm", shown)}
        >
          {count}
        </span>
        <Tip content={`Award a ${chip.name} gem`} off={disabled}>
          <Button
            size="icon"
            variant="outline"
            className="size-7"
            data-testid="gem-award"
            data-value={chip.gem}
            aria-label={`Award a ${chip.name} gem`}
            disabled={disabled}
            onClick={() => adjust(chip.gem, 1)}
          >
            <PlusIcon className="size-3.5" />
          </Button>
        </Tip>
      </PopoverContent>
    </Popover>
  );
}

/** FR-CHARX-72: the Spend menu (plain spends only; rerolls and Combat gems live elsewhere). */
function SpendMenu({
  counts,
  disabled,
  onPick,
}: {
  counts: GemCounts;
  disabled: boolean;
  onPick(c: SpendChoice): void;
}) {
  const item = (c: SpendChoice) => (
    <DropdownMenuItem
      key={c.value}
      data-testid="gem-spend"
      data-value={c.value}
      disabled={!affordable(counts, c)}
      onSelect={() => onPick(c)}
    >
      <GemIcon gem={c.gem} />
      {c.label}
    </DropdownMenuItem>
  );
  const plain = SPEND_CHOICES.filter((c) => c.gem !== "action");
  const action = SPEND_CHOICES.filter((c) => c.gem === "action");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="h-6 gap-1 px-2 text-xs"
          data-testid="gem-spend-menu"
          disabled={disabled}
        >
          Spend <ChevronDownIcon className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {plain.filter((c) => c.gem !== "inspiration").map(item)}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">Action gem</DropdownMenuLabel>
        {action.map(item)}
        <DropdownMenuSeparator />
        {plain.filter((c) => c.gem === "inspiration").map(item)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** FR-GEM-17: "Spend? ✓ ✗" for 4 s, once. */
function SpendConfirm({
  choice,
  disabled,
  onConfirm,
  onCancel,
}: {
  choice: SpendChoice;
  disabled: boolean;
  onConfirm(): void;
  onCancel(): void;
}) {
  return (
    <span
      data-testid="gem-spend-ask"
      data-value={choice.value}
      className="inline-flex items-center gap-1 text-xs"
    >
      {choice.ask}
      <Tip content="Spend" off={disabled}>
        <Button
          size="icon"
          variant="outline"
          className="size-6"
          data-testid="gem-spend-confirm"
          aria-label="Spend"
          disabled={disabled}
          onClick={onConfirm}
        >
          <CheckIcon className="size-3.5" />
        </Button>
      </Tip>
      <Tip content="Cancel">
        <Button
          size="icon"
          variant="ghost"
          className="size-6"
          data-testid="gem-spend-cancel"
          aria-label="Cancel"
          onClick={onCancel}
        >
          <XIcon className="size-3.5" />
        </Button>
      </Tip>
    </span>
  );
}

export function GemBlock({ creatureId }: { creatureId: string; client: "dm" | "player" }) {
  const row = useSync((s) => gemsRow(s.store, creatureId));
  const isDm = useSync((s) => s.store.you?.role === "dm");
  const may = useSync((s) => maySpend(s.store, creatureId));
  const { send, live, error, disabled } = useGemIntent();
  const [pending, setPending] = useState<SpendChoice | null>(null);
  const counts = countsOf(row);
  const connection = useSync((s) => s.connection);
  const [awardError, setAwardError] = useState<string | null>(null);
  // FR-GEM-43: one batch per block; a reject shows inline like any gem intent.
  const batch = useMemo(
    () =>
      createAwardBatch({
        send: (name, payload) => {
          setAwardError(null);
          return connection.sendIntent(name, payload).catch((err: unknown) => {
            setAwardError(intentErrorText(err));
          });
        },
      }),
    [connection],
  );
  useSyncExternalStore(batch.subscribe, batch.version, batch.version);
  // Not live → the unsent sum is dropped (the count reverts); unmount → sent now.
  useEffect(() => {
    if (!live) batch.drop();
  }, [live, batch]);
  useEffect(() => () => batch.flush(), [batch]);

  // FR-GEM-17: the confirm resets after 4 s; FR-CHARX-76: and when the connection drops.
  useEffect(() => {
    if (!pending) return;
    if (!live) {
      setPending(null);
      return;
    }
    const t = setTimeout(() => setPending(null), CONFIRM_MS);
    return () => clearTimeout(t);
  }, [pending, live]);

  const confirm = async () => {
    if (!pending) return;
    const c = pending;
    setPending(null);
    await send(GEM_SPEND_INTENT, spendPayload(creatureId, c));
  };

  return (
    <div data-testid="gem-block" data-record-id={creatureId} className="flex flex-col gap-0.5">
      <div className="flex flex-wrap items-center gap-1">
        {gemChips(counts).map((c) =>
          isDm ? (
            <DmChip key={c.gem} chip={c} creatureId={creatureId} disabled={!live} batch={batch} />
          ) : (
            <GemCountChip key={c.gem} chip={c} testId="gem-count" className="h-6 px-1 text-xs" />
          ),
        )}
        <Tooltip content={MAX_TIP}>
          {/* biome-ignore lint/a11y/noNoninteractiveTabindex: focusable so the Tooltip shows on keyboard focus */}
          <span data-testid="gem-max-label" tabIndex={0} className="text-xs text-muted-foreground">
            {MAX_LABEL}
          </span>
        </Tooltip>
        {may && (
          <span className="ml-auto inline-flex items-center">
            {pending ? (
              <SpendConfirm
                choice={pending}
                disabled={disabled}
                onConfirm={() => void confirm()}
                onCancel={() => setPending(null)}
              />
            ) : (
              <SpendMenu counts={counts} disabled={disabled} onPick={setPending} />
            )}
          </span>
        )}
      </div>
      {(error ?? awardError) && (
        <p data-testid="gem-error" role="alert" className="text-xs text-destructive">
          {error ?? awardError}
        </p>
      )}
    </div>
  );
}

/** FR-CHARX-71: `gem.counts`, header slot after the effect chips, characters only, both clients. */
export const gemCountsSection: SheetSection = {
  id: "gem.counts",
  slot: "header",
  order: 60,
  kinds: ["character"],
  available: gemSectionAvailable,
  component: GemBlock,
};
