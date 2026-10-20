// Per-image tag editor (FR-ASSET-47, ASSET §7 row 4): the selected image's name, its tags as
// removable chips, and "Add tag" (suggestions: the campaign's tags and the built-ins, ranked by
// the shared matcher; Enter adds the typed text, ↑ / ↓ + Enter or a click adds a suggestion) →
// `assets.setTags`. Disabled with "Reconnecting…" while not live; a reject shows inline.
import type { AssetRecord } from "@shared/assets-pipeline/schemas";
import { type TagChips, tagSuggestions } from "@shared/assets-pipeline/search";
import { ASSET_INTENTS, TAGS_PER_IMAGE_MAX, tagKey } from "@shared/assets-pipeline/tags";
import { Popover, PopoverAnchor, PopoverContent } from "@ui/components/ui/controls";
import { Tooltip } from "@ui/components/ui/overlays";
import { Badge, Input } from "@ui/components/ui/primitives";
import { cn } from "@ui/lib/utils";
import { XIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { addTagPlan, imageFull, removeTag } from "./editor-logic";
import { RECONNECTING, useTagIntent } from "./intent";

export function TagEditor({
  asset,
  chips,
  live,
}: {
  asset: AssetRecord;
  chips: TagChips;
  live: boolean;
}) {
  const { busy, error, setError, send } = useTagIntent();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(-1);
  const [dismissed, setDismissed] = useState(false);
  const full = asset.tags.length >= TAGS_PER_IMAGE_MAX;
  const off = !live || busy;
  const shown = q.trim() === "" ? [] : tagSuggestions(chips, q, asset.tags);
  const open = !off && !dismissed && shown.length > 0;
  const at = Math.min(active, shown.length - 1);

  const setTags = async (tags: string[]) => {
    const r = await send(ASSET_INTENTS.setTags, { assetId: asset.id, tags });
    if (r) {
      setQ("");
      setActive(-1);
    }
  };
  const add = (typed: string) => {
    const plan = addTagPlan(asset.tags, typed, chips);
    if (plan.kind === "invalid") setError(plan.message);
    else if (plan.kind === "held") setQ("");
    else void setTags(plan.tags);
  };

  return (
    <div
      data-testid="asset-tags-editor"
      data-record-id={asset.id}
      className="flex flex-col gap-1 text-xs"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-muted-foreground">
          Selected:{" "}
          <span data-testid="asset-picker-selected" className="text-foreground">
            {asset.name}
          </span>
          {" · "}Tags:
        </span>
        {asset.tags.map((t) => (
          <Badge
            key={tagKey(t)}
            variant="secondary"
            data-testid="asset-tags-chip"
            data-tag={tagKey(t)}
            className="gap-0.5 pr-0.5"
          >
            {t}
            <Live why={live ? null : RECONNECTING}>
              <button
                type="button"
                aria-label={`Remove tag ${t}`}
                data-testid="asset-tags-remove"
                data-tag={tagKey(t)}
                disabled={off}
                className="rounded-sm p-0.5 hover:bg-accent disabled:opacity-50"
                onClick={() => void setTags(removeTag(asset.tags, tagKey(t)))}
              >
                <XIcon className="size-3" />
              </button>
            </Live>
          </Badge>
        ))}
        <Popover open={open} onOpenChange={(o) => !o && setDismissed(true)}>
          <Live why={live ? (full ? imageFull : null) : RECONNECTING}>
            <PopoverAnchor asChild>
              <Input
                data-testid="asset-tags-add"
                role="combobox"
                aria-label="Add tag"
                aria-expanded={open}
                aria-autocomplete="list"
                autoComplete="off"
                placeholder={full ? `${TAGS_PER_IMAGE_MAX} tags (max)` : "Add tag"}
                disabled={off || full}
                value={q}
                className="h-7 w-32 text-xs"
                onChange={(e) => {
                  setQ(e.target.value);
                  setActive(-1);
                  setDismissed(false);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    const step = e.key === "ArrowDown" ? 1 : -1;
                    setActive(Math.min(Math.max(-1, at + step), shown.length - 1));
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    const s = at >= 0 ? shown[at] : undefined;
                    if (s !== undefined) add(s);
                    else if (q.trim() !== "") add(q);
                  }
                }}
              />
            </PopoverAnchor>
          </Live>
          <PopoverContent
            align="start"
            className="w-48 p-1"
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
            onInteractOutside={(e) => {
              // A click back in the input keeps the list.
              if ((e.target as HTMLElement | null)?.closest?.('[data-testid="asset-tags-add"]')) {
                e.preventDefault();
              }
            }}
          >
            <ul aria-label="Tag suggestions">
              {shown.map((s, i) => (
                <li key={tagKey(s)}>
                  <button
                    type="button"
                    tabIndex={-1}
                    data-testid="asset-tags-suggestion"
                    data-tag={tagKey(s)}
                    data-active={i === at || undefined}
                    className={cn(
                      "w-full rounded-sm px-2 py-1 text-left text-xs hover:bg-accent",
                      i === at && "bg-accent",
                    )}
                    // Keep focus in the input.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => add(s)}
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      </div>
      {error && (
        <p data-testid="asset-tags-error" role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** A disabled control's reason as a Tooltip on a wrapper (disabled elements get no pointer events). */
export function Live({ why, children }: { why: string | null; children: ReactNode }) {
  if (why === null) return children;
  return (
    <Tooltip content={why}>
      <span className="inline-flex">{children}</span>
    </Tooltip>
  );
}
