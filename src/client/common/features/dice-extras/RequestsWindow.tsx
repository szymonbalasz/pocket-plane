// Window `dicex.requests` body (DM; FR-DICEX-86–88): the composer (roll, PC chips + "All PCs",
// DC + "Show DC", mode, eye, label, Send; folds away above the cards) and one card per request
// (open first): per target Waiting / total ✓ ✗ / Declined / No roll, nat 20 / 1, the total →
// `focusLogEntry`; Roll for missing; Close (asks once). Pass / fail only here (FR-DICEX-85). In
// the lazy `TableTools` chunk (DICEX §12).
import {
  DICEX_REQUEST_INTENTS,
  ROLL_REQUEST_TYPE,
  type RollRequestRecord,
} from "@shared/dice-extras/requests";
import {
  categoryPublic,
  GAME_LOG_SETTINGS_TYPE,
  type GameLogSettingsRecord,
  type RollCategory,
  type RollMode,
} from "@shared/dice-roll-log/schemas";
import { ChevronDownIcon, ChevronUpIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { Checkbox, ToggleGroup, ToggleGroupItem } from "../../components/ui/controls";
import { Tooltip } from "../../components/ui/overlays";
import { Input, Label } from "../../components/ui/primitives";
import { cn } from "../../lib/utils";
import { useRecords, useSync } from "../../sync/store";
import { toastIntentError } from "../combat-tracker/store";
import { focusLogEntry } from "../dice-roll-log/focus";
import {
  type ComposerForm,
  composerInput,
  naturalTag,
  ROLL_CHOICES,
  requestOrder,
  resultsPreset,
  targetOptions,
  targetText,
} from "./request-logic";

const SELECT =
  "h-7 min-w-0 rounded-md border border-input bg-background px-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

const MODES: readonly [RollMode, string][] = [
  ["disadvantage", "Dis"],
  ["normal", "Normal"],
  ["advantage", "Adv"],
];

const HIDDEN_TIP = "Only you and the PC's player see the results";

function useSend() {
  const connection = useSync((s) => s.connection);
  const [busy, setBusy] = useState(false);
  const send = async (name: string, payload: unknown): Promise<boolean> => {
    setBusy(true);
    try {
      await connection.sendIntent(name, payload);
      return true;
    } catch (err) {
      toastIntentError(err);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { send, busy };
}

const FRESH: ComposerForm = {
  choice: "skill:perception",
  expression: "",
  targets: [],
  dc: "",
  dcShown: false,
  mode: "normal",
  results: "hidden",
  label: "",
};

function Composer() {
  const store = useSync((s) => s.store);
  const live = useSync((s) => s.state === "live");
  const settings = useRecords<GameLogSettingsRecord>(GAME_LOG_SETTINGS_TYPE)[0];
  const isPublic = (c: string) => (settings ? categoryPublic(settings, c as RollCategory) : false);
  const options = useMemo(() => targetOptions(store), [store]);
  const [f, setF] = useState<ComposerForm>(() => ({
    ...FRESH,
    results: resultsPreset(FRESH.choice, isPublic),
  }));
  const { send, busy } = useSend();
  const out = composerInput(f);
  const toggle = (id: string) =>
    setF({
      ...f,
      targets: f.targets.includes(id) ? f.targets.filter((x) => x !== id) : [...f.targets, id],
    });
  const eligible = options.filter((o) => o.blocked === null).map((o) => o.id);
  return (
    <form
      data-testid="dicex-request-composer"
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!("input" in out) || busy || !live) return;
        void send(DICEX_REQUEST_INTENTS.request, out.input).then((ok) => {
          if (ok) setF({ ...FRESH, results: resultsPreset(FRESH.choice, isPublic) });
        });
      }}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          data-testid="dicex-request-roll"
          aria-label="Roll"
          className={cn(SELECT, "max-w-40")}
          value={f.choice}
          onChange={(e) =>
            setF({ ...f, choice: e.target.value, results: resultsPreset(e.target.value, isPublic) })
          }
        >
          {(["Skills", "Saves", "Checks", "Other"] as const).map((g) => (
            <optgroup key={g} label={g}>
              {ROLL_CHOICES.filter((c) => c.group === g).map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {f.choice === "custom" && (
          <Input
            data-testid="dicex-request-expression"
            aria-label="Dice"
            placeholder="1d20+2"
            className="h-7 w-24 font-mono text-xs"
            value={f.expression}
            onChange={(e) => setF({ ...f, expression: e.target.value })}
          />
        )}
        <Input
          data-testid="dicex-request-label"
          aria-label="Label"
          placeholder="Label"
          maxLength={60}
          className="h-7 w-24 min-w-0 flex-1 text-xs"
          value={f.label}
          onChange={(e) => setF({ ...f, label: e.target.value })}
        />
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <Button
          type="button"
          data-testid="dicex-request-all"
          size="sm"
          variant="outline"
          className="h-6 px-2 text-xs"
          disabled={eligible.length === 0}
          onClick={() => setF({ ...f, targets: eligible })}
        >
          All PCs
        </Button>
        {options.map((o) => {
          const on = f.targets.includes(o.id);
          return (
            <Button
              key={o.id}
              type="button"
              data-testid="dicex-request-target"
              data-record-id={o.id}
              data-state={o.blocked ? "blocked" : on ? "on" : "off"}
              size="sm"
              variant={on ? "default" : "outline"}
              className="h-6 px-2 text-xs"
              disabled={o.blocked !== null}
              data-reason={o.blocked ?? undefined}
              aria-label={o.blocked ? `${o.name} (${o.blocked})` : o.name}
              aria-pressed={on}
              onClick={() => toggle(o.id)}
            >
              {o.name}
            </Button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Input
          data-testid="dicex-request-dc"
          aria-label="DC"
          placeholder="DC"
          inputMode="numeric"
          className="h-7 w-14 text-xs"
          value={f.dc}
          onChange={(e) => setF({ ...f, dc: e.target.value })}
        />
        <Label className="flex items-center gap-1 text-xs">
          <Checkbox
            data-testid="dicex-request-dc-shown"
            checked={f.dcShown}
            onCheckedChange={(v) => setF({ ...f, dcShown: v === true })}
          />
          Show DC
        </Label>
        <ToggleGroup
          type="single"
          data-testid="dicex-request-mode"
          data-value={f.mode}
          aria-label="Mode"
          value={f.mode}
          onValueChange={(v) => v && setF({ ...f, mode: v as RollMode })}
        >
          {MODES.map(([m, label]) => (
            <ToggleGroupItem key={m} value={m} aria-label={m} className="h-[26px] px-1.5 text-xs">
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Tooltip content={f.results === "public" ? "Everyone sees the results" : HIDDEN_TIP}>
          <Button
            type="button"
            data-testid="dicex-request-results"
            data-state={f.results}
            aria-label={f.results === "public" ? "Results public" : "Results hidden"}
            size="icon"
            variant="ghost"
            className={cn("size-7", f.results === "hidden" && "text-visibility-hidden")}
            onClick={() => setF({ ...f, results: f.results === "public" ? "hidden" : "public" })}
          >
            {f.results === "public" ? (
              <EyeIcon className="size-4" />
            ) : (
              <EyeOffIcon className="size-4" />
            )}
          </Button>
        </Tooltip>
        <span className="flex-1" />
        <Button
          type="submit"
          data-testid="dicex-request-send"
          size="sm"
          className="h-7"
          disabled={!live || busy || !("input" in out)}
        >
          Send
        </Button>
      </div>
      {"error" in out && f.targets.length > 0 && (
        <p data-testid="dicex-request-error" role="alert" className="text-xs text-destructive">
          {out.error}
        </p>
      )}
    </form>
  );
}

function RequestCard({ r }: { r: RollRequestRecord }) {
  const live = useSync((s) => s.state === "live");
  const { send, busy } = useSend();
  const [confirm, setConfirm] = useState(false);
  const open = r.state === "open";
  const off = !live || busy;
  return (
    <li
      data-testid="dicex-request-card"
      data-record-id={r.id}
      data-state={r.state}
      className={cn("flex flex-col gap-1 rounded-md border p-2", !open && "text-muted-foreground")}
    >
      <p className="truncate text-sm font-medium">
        {r.label}
        {r.dc !== null && (
          <span className="text-xs text-muted-foreground">
            {` · DC ${r.dc}${r.dcShown ? "" : " (hidden)"}`}
          </span>
        )}
        <span className="text-xs text-muted-foreground">{` · ${r.results}`}</span>
      </p>
      <ul className="flex flex-col">
        {r.targets.map((t) => {
          const tag = naturalTag(t);
          return (
            <li
              key={t.characterId}
              data-testid="dicex-request-target-row"
              data-record-id={t.characterId}
              data-state={t.state}
              data-total={t.total ?? ""}
              data-success={t.success === null ? "" : String(t.success)}
              className="flex items-center gap-2 text-xs"
            >
              <span className="min-w-0 flex-1 truncate">{t.name}</span>
              {tag && <span className="text-muted-foreground">{tag}</span>}
              {t.state === "rolled" && t.entryId ? (
                <button
                  type="button"
                  className="font-mono underline-offset-2 hover:underline"
                  onClick={() => focusLogEntry(t.entryId as string)}
                >
                  {targetText(t)}
                </button>
              ) : (
                <span>{targetText(t)}</span>
              )}
            </li>
          );
        })}
      </ul>
      {open && (
        <div className="flex items-center justify-end gap-1.5">
          <Button
            type="button"
            data-testid="dicex-request-missing"
            size="sm"
            variant="outline"
            className="h-7"
            disabled={off}
            onClick={() => void send(DICEX_REQUEST_INTENTS.rollForMissing, { requestId: r.id })}
          >
            Roll for missing
          </Button>
          {confirm ? (
            <Button
              type="button"
              data-testid="dicex-request-close-confirm"
              size="sm"
              variant="destructive"
              className="h-7"
              disabled={off}
              onClick={() => void send(DICEX_REQUEST_INTENTS.closeRequest, { requestId: r.id })}
            >
              Close?
            </Button>
          ) : (
            <Button
              type="button"
              data-testid="dicex-request-close"
              size="sm"
              variant="ghost"
              className="h-7"
              disabled={off}
              onClick={() => setConfirm(true)}
            >
              Close
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

export function RequestsWindow() {
  const rows = useRecords<RollRequestRecord>(ROLL_REQUEST_TYPE);
  const list = useMemo(() => requestOrder(rows), [rows]);
  // Opens on the cards while a request is open (the useful size: composer folded + a card).
  const [composing, setComposing] = useState(() => !rows.some((r) => r.state === "open"));
  return (
    <section
      data-testid="dicex-requests"
      aria-label="Roll requests"
      className="flex h-full min-h-0 flex-col gap-2"
    >
      <div className="flex shrink-0 items-center gap-1">
        <h3 className="flex-1 text-xs font-medium text-muted-foreground">New request</h3>
        <Button
          type="button"
          data-testid="dicex-request-fold"
          data-state={composing ? "open" : "closed"}
          aria-label={composing ? "Fold the composer" : "New request"}
          aria-expanded={composing}
          size="icon"
          variant="ghost"
          className="size-6"
          onClick={() => setComposing(!composing)}
        >
          {composing ? (
            <ChevronUpIcon className="size-4" />
          ) : (
            <ChevronDownIcon className="size-4" />
          )}
        </Button>
      </div>
      {composing && (
        <div className="shrink-0">
          <Composer />
        </div>
      )}
      <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
        {list.length === 0 && <p className="text-xs text-muted-foreground">No requests yet.</p>}
        {list.map((r) => (
          <RequestCard key={r.id} r={r} />
        ))}
      </ul>
    </section>
  );
}
