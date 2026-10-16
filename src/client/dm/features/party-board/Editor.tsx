// DM handout editor in `party.handout` (FR-PARTY-15): title, body with a counter, images strip
// (add via the asset picker, remove, move left / right), Save / Cancel. Save disabled while
// invalid (FR-PARTY-02 mirrored), unchanged, not live or in flight; a reject keeps the values; a
// remote change to the open handout keeps the draft and shows "Changed in another tab".
import type { HandoutBodyRecord, HandoutRecord } from "@shared/party-board/schemas";
import { HANDOUT_IMAGES_MAX, HANDOUT_TITLE_MAX } from "@shared/party-board/schemas";
import { Button } from "@ui/components/ui/button";
import { Input, Label } from "@ui/components/ui/primitives";
import { ScrollArea } from "@ui/components/ui/scroll-area";
import { AssetImg } from "@ui/features/assets-pipeline/AssetImg";
import { Textarea } from "@ui/features/party-board/controls";
import {
  addImage,
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
import { ArrowLeftIcon, ArrowRightIcon, ImagePlusIcon, XIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { AssetPickerDialog } from "../assets-pipeline/AssetPicker";
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
  const [picking, setPicking] = useState(false);
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
  const message = error ?? (!parsed.ok && touched ? parsed.message : null);
  return (
    <form
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
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-6"
                      aria-label="Move left"
                      data-testid="party-editor-image-left"
                      disabled={i === 0}
                      onClick={() => set({ imageAssetIds: moveImage(draft.imageAssetIds, i, -1) })}
                    >
                      <ArrowLeftIcon className="size-3.5" />
                    </Button>
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
                  </span>
                </li>
              ))}
              <li>
                <Button
                  type="button"
                  variant="outline"
                  className="size-[5.5rem] flex-col gap-1 text-xs"
                  data-testid="party-editor-add-image"
                  disabled={draft.imageAssetIds.length >= HANDOUT_IMAGES_MAX}
                  onClick={() => setPicking(true)}
                >
                  <ImagePlusIcon className="size-5" />
                  Add image
                </Button>
              </li>
            </ul>
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
      <AssetPickerDialog
        open={picking}
        onOpenChange={setPicking}
        title="Add an image"
        selectLabel="Add"
        onSelect={(id) => set({ imageAssetIds: addImage(draft.imageAssetIds, id) })}
      />
    </form>
  );
}
