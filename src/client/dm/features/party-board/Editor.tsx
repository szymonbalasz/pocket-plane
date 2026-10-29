// DM handout editor in `party.handout` (FR-PARTY-15): title, images strip (add via the image
// attach control: upload, drop, paste anywhere in the editor, From library, FR-PARTY-39; remove,
// move left / right; above the body so the attach row is never below the fold, FR-PARTY-48;
// uploads tagged Handouts, FR-PARTY-47), body with a counter, Save / Cancel. Save disabled
// while invalid (FR-PARTY-02 mirrored), unchanged, not live or in flight; a reject keeps the
// values; a remote change to the open handout keeps the draft and shows "Changed in another tab".
import type { HandoutBodyRecord, HandoutRecord } from "@shared/party-board/schemas";
import { HANDOUT_IMAGES_MAX, HANDOUT_TITLE_MAX } from "@shared/party-board/schemas";
import { Button } from "@ui/components/ui/button";
import { Input, Label } from "@ui/components/ui/primitives";
import { ScrollArea } from "@ui/components/ui/scroll-area";
import { Tip } from "@ui/components/ui/tip";
import { AssetImg } from "@ui/features/assets-pipeline/AssetImg";
import { ImageAttach } from "@ui/features/assets-pipeline/attach/ImageAttach";
import { Textarea } from "@ui/features/party-board/controls";
import {
  bodyCounter,
  CHANGED_ELSEWHERE,
  draftUnchanged,
  EMPTY_HANDOUT,
  type HandoutDraft,
  handoutPayload,
  LOST_SAVE,
  moveImage,
  removeImage,
} from "@ui/features/party-board/logic";
import { ArrowLeftIcon, ArrowRightIcon, XIcon } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { ALREADY_IN_HANDOUT, attachImage } from "./attach";
import { useIntent, useLive } from "./send";

export interface EditorProps {
  /** The stored handout (edit), or null (new). */
  stored: { header: HandoutRecord; body: HandoutBodyRecord } | null;
  /** After a successful save: the handout's id. */
  onSaved(handoutId: string): void;
  onCancel(): void;
}

export function HandoutEditor({ stored, onSaved, onCancel }: EditorProps) {
  const live = useLive();
  const [draft, setDraft] = useState<HandoutDraft>(() =>
    stored
      ? {
          title: stored.header.title,
          body: stored.body.body,
          imageAssetIds: [...stored.header.imageAssetIds],
        }
      : EMPTY_HANDOUT,
  );
  const [startRev] = useState(stored?.header.rev ?? null);
  const [duplicate, setDuplicate] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  // The strip as of the last add: several uploads can finish before a re-render.
  const ids = useRef(draft.imageAssetIds);
  ids.current = draft.imageAssetIds;
  const [touched, setTouched] = useState(false);
  const { busy, error, send } = useIntent(LOST_SAVE);
  const parsed = handoutPayload(draft);
  const current = stored
    ? {
        title: stored.header.title,
        body: stored.body.body,
        imageAssetIds: stored.header.imageAssetIds,
      }
    : null;
  const unchanged = draftUnchanged(draft, current);
  const enabled = parsed.ok && !unchanged && live && !busy;
  const changedElsewhere = stored !== null && startRev !== null && stored.header.rev !== startRev;
  const set = (patch: Partial<HandoutDraft>) => {
    setTouched(true);
    setDraft((d) => ({ ...d, ...patch }));
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!enabled || !parsed.ok) return;
    if (stored) {
      const r = await send("party.updateHandout", { handoutId: stored.header.id, ...parsed.value });
      if (r) onSaved(stored.header.id);
    } else {
      const r = await send("party.createHandout", parsed.value);
      const id = (r?.result as { handoutId?: string } | undefined)?.handoutId;
      if (id) onSaved(id);
    }
  };
  const attach = (id: string) => {
    const r = attachImage(ids.current, id);
    setDuplicate(r.duplicate);
    if (r.duplicate) return;
    ids.current = r.ids;
    set({ imageAssetIds: r.ids });
  };
  const message = error ?? (!parsed.ok && touched ? parsed.message : null);
  return (
    <form
      ref={form}
      data-testid="party-editor"
      data-record-id={stored?.header.id}
      onSubmit={submit}
      className="flex h-full flex-col gap-2 p-3"
    >
      <ScrollArea className="min-h-0 flex-1">
        <fieldset disabled={!live} className="flex flex-col gap-3 pr-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="party-editor-title">Title</Label>
            <Input
              id="party-editor-title"
              data-testid="party-editor-title"
              maxLength={HANDOUT_TITLE_MAX * 2}
              value={draft.title}
              onChange={(e) => set({ title: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">
              Images ({draft.imageAssetIds.length}/{HANDOUT_IMAGES_MAX})
            </span>
            <ul className="flex flex-wrap gap-2">
              {draft.imageAssetIds.map((id, i) => (
                <li
                  key={id}
                  data-testid="party-editor-image"
                  data-record-id={id}
                  className="flex flex-col items-center gap-1 rounded-md border p-1"
                >
                  <AssetImg id={id} file="thumb" alt={`Image ${i + 1}`} className="size-16" />
                  <span className="flex gap-0.5">
                    <Tip content="Move left" off={i === 0}>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-6"
                        aria-label="Move left"
                        data-testid="party-editor-image-left"
                        disabled={i === 0}
                        onClick={() =>
                          set({ imageAssetIds: moveImage(draft.imageAssetIds, i, -1) })
                        }
                      >
                        <ArrowLeftIcon className="size-3.5" />
                      </Button>
                    </Tip>
                    <Tip content="Remove image">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-6"
                        aria-label="Remove image"
                        data-testid="party-editor-image-remove"
                        onClick={() => set({ imageAssetIds: removeImage(draft.imageAssetIds, i) })}
                      >
                        <XIcon className="size-3.5" />
                      </Button>
                    </Tip>
                    <Tip content="Move right" off={i === draft.imageAssetIds.length - 1}>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-6"
                        aria-label="Move right"
                        data-testid="party-editor-image-right"
                        disabled={i === draft.imageAssetIds.length - 1}
                        onClick={() => set({ imageAssetIds: moveImage(draft.imageAssetIds, i, 1) })}
                      >
                        <ArrowRightIcon className="size-3.5" />
                      </Button>
                    </Tip>
                  </span>
                </li>
              ))}
            </ul>
            <ImageAttach
              owner="party-editor"
              context="handout"
              max={HANDOUT_IMAGES_MAX}
              count={draft.imageAssetIds.length}
              onAdd={attach}
              pasteTarget={form}
              dropTarget={form}
              disabled={busy}
            />
            {duplicate && (
              <p data-testid="party-editor-duplicate" className="text-xs text-muted-foreground">
                {ALREADY_IN_HANDOUT}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="party-editor-body">Text</Label>
              <span data-testid="party-editor-counter" className="text-xs text-muted-foreground">
                {bodyCounter(draft.body)}
              </span>
            </div>
            <Textarea
              id="party-editor-body"
              data-testid="party-editor-body"
              rows={8}
              value={draft.body}
              onChange={(e) => set({ body: e.target.value })}
            />
          </div>
        </fieldset>
      </ScrollArea>
      {changedElsewhere && (
        <p data-testid="party-editor-changed" className="text-xs text-muted-foreground">
          {CHANGED_ELSEWHERE}
        </p>
      )}
      {message && (
        <p data-testid="party-editor-error" role="alert" className="text-xs text-destructive">
          {message}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid="party-editor-cancel"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" data-testid="party-editor-save" disabled={!enabled}>
          Save
        </Button>
      </div>
    </form>
  );
}
