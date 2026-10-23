// FR-RECAP-24 Share dialog (DM, `recap-share-dialog`, opened by `recap-share`): a note for the table (≤ 280, counter) and one
// Checkbox per optional section (all ticked = shown to players); **Share** (`recap-share-send`,
// disabled unless live). Ack → the dialog closes, Toast "Recap shared"; a reject → an inline
// message, the draft kept. The draft survives a close and a disconnect (DM §11).
import {
  OMITTABLE_SECTIONS,
  type OmittableSection,
  RECAP_NOTE_MAX,
  SECTION_TITLE,
} from "@shared/session-recap/schemas";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/controls";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/overlays";
import { Label } from "../../components/ui/primitives";
import { cn } from "../../lib/utils";

export interface ShareDraft {
  note: string;
  /** The ticked (shown) optional sections. */
  shown: readonly OmittableSection[];
}

export const EMPTY_DRAFT: ShareDraft = { note: "", shown: OMITTABLE_SECTIONS };

/** The `recap.share` input of a draft. */
export const shareInput = (fromN: number, d: ShareDraft) => ({
  fromN,
  ...(d.note.trim() ? { note: d.note } : {}),
  omit: OMITTABLE_SECTIONS.filter((k) => !d.shown.includes(k)),
});

/** Code points (the server's 280 counts characters, not UTF-16 units). */
export const noteLength = (s: string) => [...s].length;

interface FormProps {
  live: boolean;
  draft: ShareDraft;
  onDraft(d: ShareDraft): void;
  sending: boolean;
  error: string | null;
  onSend(): void;
}

/** The dialog's body (render tests: a Radix portal renders nothing statically). */
export function ShareForm({ live, draft, onDraft, sending, error, onSend }: FormProps) {
  const len = noteLength(draft.note);
  return (
    <>
      <div className="flex flex-col gap-1">
        <Label htmlFor="recap-share-note">Note for the table (optional)</Label>
        <textarea
          id="recap-share-note"
          data-testid="recap-share-note"
          value={draft.note}
          rows={3}
          onChange={(e) => onDraft({ ...draft, note: e.target.value })}
          className="w-full resize-none rounded-md border border-input bg-transparent px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <span
          data-testid="recap-share-count"
          className={cn(
            "self-end text-xs tabular-nums text-muted-foreground",
            len > RECAP_NOTE_MAX && "text-destructive",
          )}
        >
          {len} / {RECAP_NOTE_MAX}
        </span>
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-sm font-medium">Show players</legend>
        {OMITTABLE_SECTIONS.map((k) => (
          <Label key={k} className="flex items-center gap-2 font-normal">
            <Checkbox
              data-testid="recap-share-omit"
              data-value={k}
              checked={draft.shown.includes(k)}
              onCheckedChange={(c) =>
                onDraft({
                  ...draft,
                  shown: OMITTABLE_SECTIONS.filter((x) =>
                    x === k ? c === true : draft.shown.includes(x),
                  ),
                })
              }
            />
            {SECTION_TITLE[k]}
          </Label>
        ))}
      </fieldset>
      {error ? (
        <p data-testid="recap-share-error" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <DialogFooter>
        <Button
          data-testid="recap-share-send"
          disabled={!live || sending || len > RECAP_NOTE_MAX}
          onClick={onSend}
        >
          Share
        </Button>
      </DialogFooter>
    </>
  );
}

export function ShareDialog({
  open,
  onOpenChange,
  label,
  live,
  draft,
  onDraft,
  onSend,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  label: string;
  live: boolean;
  draft: ShareDraft;
  onDraft(d: ShareDraft): void;
  /** Resolves on the ack; rejects with the server's message. */
  onSend(): Promise<void>;
}) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = () => {
    setSending(true);
    setError(null);
    onSend()
      .then(() => onOpenChange(false))
      .catch((err: unknown) => setError((err as Error)?.message ?? "Couldn't share the recap"))
      .finally(() => setSending(false));
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="recap-share-dialog" className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Share recap</DialogTitle>
          <DialogDescription>{label}: everyone's Recap opens on this session.</DialogDescription>
        </DialogHeader>
        <ShareForm
          live={live}
          draft={draft}
          onDraft={onDraft}
          sending={sending}
          error={error}
          onSend={send}
        />
      </DialogContent>
    </Dialog>
  );
}
