// The DM's Pause control (FR-SHELL-129): a top-bar item (lazy chunk; `top-bar.tsx`). Running:
// "Pause" → Popover (message, image, back in none / 5 / 10 / 15 / 30 min) → `camp.pause`. Paused:
// "Paused · m:ss" → the same Popover with Update, Resume and Preview (the card in a non-blocking
// Dialog). An icon button like search (kit-parity K10), on while paused; the label and countdown in
// its Tooltip. Disabled unless `live`. The draft lives in `pp.pause.v1.<campaignId>` (this browser).
import {
  BACK_IN_MINUTES,
  type BackInMin,
  type CampaignPause,
  PAUSE_INTENT,
  PAUSE_MESSAGE_MAX,
  RESUME_INTENT,
} from "@shared/campaign-management/table-state";
import { CoffeeIcon, ImageIcon, PlayIcon, XIcon } from "lucide-react";
import { Dialog as D } from "radix-ui";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  ToggleGroup,
  ToggleGroupItem,
} from "../../components/ui/menus";
import { Tooltip } from "../../components/ui/overlays";
import { Input, Label } from "../../components/ui/primitives";
import { Tip } from "../../components/ui/tip";
import { useSync } from "../../sync/store";
import { AssetImg } from "../assets-pipeline/AssetImg";
import { AssetPickerDialog } from "../assets-pipeline/AssetPicker";
import { intentErrorText } from "../character-sheet/routing";
import {
  controlLabel,
  type DraftStorage,
  type PauseDraft,
  pauseOf,
  pauseSlotWidth,
  readDraft,
  writeDraft,
} from "./logic";
import { PauseCard, useNow } from "./PauseCard";

/** The form's "back in": a choice, none, or (paused) keep the running countdown. */
type BackIn = BackInMin | null | "keep";

interface Form {
  message: string;
  imageAssetId: string | null;
  backIn: BackIn;
}

const browserStorage = (): DraftStorage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/** The intent's payload: `keep` leaves `backInMin` out (the server keeps `backAt`). */
export function pausePayload(f: Form): Record<string, unknown> {
  return {
    message: f.message,
    imageAssetId: f.imageAssetId,
    ...(f.backIn === "keep" ? {} : { backInMin: f.backIn }),
  };
}

/** What the Preview draws: the form as the card (FR-SHELL-129). */
export function previewPause(f: Form, pause: CampaignPause | null, nowMs: number): CampaignPause {
  const backAt =
    f.backIn === "keep"
      ? (pause?.backAt ?? null)
      : f.backIn === null
        ? null
        : new Date(nowMs + f.backIn * 60_000).toISOString();
  return {
    message: f.message.trim() || null,
    imageAssetId: f.imageAssetId,
    backAt,
    startedAt: pause?.startedAt ?? new Date(nowMs).toISOString(),
  };
}

const toDraft = (f: Form, prev: PauseDraft): PauseDraft => ({
  message: f.message,
  imageAssetId: f.imageAssetId,
  backInMin: f.backIn === "keep" ? prev.backInMin : f.backIn,
});

export default function PauseControl() {
  const pause = useSync((s) => pauseOf(s.store));
  const live = useSync((s) => s.state === "live");
  const campaignId = useSync((s) => s.store.you?.campaignId ?? null);
  const connection = useSync((s) => s.connection);
  const now = useNow(pause?.backAt != null);
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Form>({ message: "", imageAssetId: null, backIn: null });

  // Opening fills the form: paused → the card (back in: keep); running → the draft.
  const onOpenChange = (next: boolean) => {
    if (next && campaignId) {
      const draft = readDraft(browserStorage(), campaignId);
      setForm(
        pause
          ? { message: pause.message ?? "", imageAssetId: pause.imageAssetId, backIn: "keep" }
          : { message: draft.message, imageAssetId: draft.imageAssetId, backIn: draft.backInMin },
      );
      setError(null);
    }
    setOpen(next);
  };
  const edit = (patch: Partial<Form>) => {
    const f = { ...form, ...patch };
    setForm(f);
    if (campaignId) {
      const s = browserStorage();
      writeDraft(s, campaignId, toDraft(f, readDraft(s, campaignId)));
    }
  };
  // A pause ending elsewhere (another DM tab) closes the Preview.
  useEffect(() => {
    if (!pause) setPreview(false);
  }, [pause]);

  const send = async (name: string, payload: unknown) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await connection.sendIntent(name, payload);
      setOpen(false);
    } catch (err) {
      setError(intentErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  const paused = pause !== null;
  const label = controlLabel(pause, now);

  return (
    <div className="flex w-full justify-end">
      <Popover open={open && live} onOpenChange={onOpenChange}>
        <Tooltip content={label}>
          <PopoverTrigger asChild>
            {/* K10 (K6 gap 11): the search button's look; paused = on (secondary). The label
                stays in the text for screen readers and text queries. */}
            <Button
              variant={paused ? "secondary" : "ghost"}
              size="icon"
              data-testid="ui-pause-open"
              data-state={paused ? "paused" : "running"}
              aria-label={label}
              disabled={!live}
              className="h-8"
              style={{ width: pauseSlotWidth }}
            >
              <CoffeeIcon aria-hidden className="size-4" />
              <span className="sr-only">{label}</span>
            </Button>
          </PopoverTrigger>
        </Tooltip>
        <PopoverContent
          align="end"
          className="w-80"
          data-testid="ui-pause-form"
          // The image picker's Dialog is outside the Popover: keep the form open meanwhile.
          onInteractOutside={(e) => {
            if (picking) e.preventDefault();
          }}
        >
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send(PAUSE_INTENT, pausePayload(form));
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pp-pause-message">Message</Label>
              <Input
                id="pp-pause-message"
                data-testid="ui-pause-message-input"
                maxLength={PAUSE_MESSAGE_MAX}
                placeholder="Pizza break, back soon"
                value={form.message}
                onChange={(e) => edit({ message: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-2">
              {form.imageAssetId ? (
                <AssetImg
                  id={form.imageAssetId}
                  file="thumb"
                  alt="Pause image"
                  className="size-12 rounded"
                />
              ) : (
                <div className="flex size-12 items-center justify-center rounded bg-muted">
                  <ImageIcon aria-hidden className="size-5 text-muted-foreground" />
                </div>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="ui-pause-image-pick"
                onClick={() => setPicking(true)}
              >
                {form.imageAssetId ? "Change image…" : "Choose image…"}
              </Button>
              {form.imageAssetId && (
                <Tip content="Remove image">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remove image"
                    data-testid="ui-pause-image-clear"
                    onClick={() => edit({ imageAssetId: null })}
                  >
                    <XIcon aria-hidden className="size-4" />
                  </Button>
                </Tip>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium" id="pp-pause-back-in">
                Back in
                {form.backIn === "keep" && pause?.backAt && (
                  <span className="ml-2 font-normal text-muted-foreground tabular-nums">
                    {label.replace(/^Paused · /, "")} left
                  </span>
                )}
              </span>
              <ToggleGroup
                type="single"
                aria-labelledby="pp-pause-back-in"
                data-testid="ui-pause-back-in"
                data-value={String(form.backIn)}
                value={form.backIn === "keep" ? "" : String(form.backIn ?? "none")}
                onValueChange={(v) => {
                  if (v === "") return;
                  edit({ backIn: v === "none" ? null : (Number(v) as BackInMin) });
                }}
              >
                {(["none", ...BACK_IN_MINUTES] as const).map((m) => (
                  <ToggleGroupItem
                    key={m}
                    value={String(m)}
                    data-testid="ui-pause-back-in-item"
                    data-value={String(m)}
                    className="h-8 w-auto px-2"
                  >
                    {m === "none" ? "None" : `${m} min`}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
            {error && (
              <p data-testid="ui-pause-error" role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {paused ? (
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-testid="ui-pause-preview"
                  onClick={() => {
                    setPreview(true);
                    setOpen(false);
                  }}
                >
                  Preview
                </Button>
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  data-testid="ui-pause-update"
                  disabled={busy || !live}
                >
                  Update
                </Button>
                <Button
                  type="button"
                  size="sm"
                  data-testid="ui-pause-resume"
                  disabled={busy || !live}
                  onClick={() => void send(RESUME_INTENT, {})}
                >
                  <PlayIcon aria-hidden className="size-4" />
                  Resume
                </Button>
              </div>
            ) : (
              <div className="flex justify-end">
                <Button
                  type="submit"
                  size="sm"
                  data-testid="ui-pause-submit"
                  disabled={busy || !live}
                >
                  <CoffeeIcon aria-hidden className="size-4" />
                  Pause the table
                </Button>
              </div>
            )}
          </form>
        </PopoverContent>
      </Popover>
      <AssetPickerDialog
        open={picking}
        onOpenChange={setPicking}
        title="Pause image"
        initialSelectedId={form.imageAssetId}
        onSelect={(id) => edit({ imageAssetId: id })}
      />
      <PausePreview
        open={preview && pause !== null}
        onOpenChange={setPreview}
        pause={pause ? previewPause(form, pause, now) : null}
      />
    </div>
  );
}

/**
 * FR-SHELL-129 Preview: the card in a non-blocking Dialog (no overlay, no focus trap; the DM's
 * windows stay usable), closed by Escape or ✕.
 */
function PausePreview({
  open,
  onOpenChange,
  pause,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  pause: CampaignPause | null;
}) {
  if (!pause) return null;
  return (
    <D.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <D.Portal>
        <D.Content
          data-testid="ui-pause-preview-dialog"
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-lg border bg-background p-6 shadow-lg"
          onInteractOutside={(e) => e.preventDefault()}
        >
          <D.Title className="sr-only">Pause preview</D.Title>
          <p className="mb-4 text-xs font-medium uppercase text-muted-foreground">Players see</p>
          <PauseCard pause={pause} className="mx-auto" />
          <D.Close
            className="absolute right-4 top-4 opacity-70 hover:opacity-100"
            aria-label="Close"
            data-testid="ui-pause-preview-close"
          >
            <XIcon className="size-4" />
          </D.Close>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
