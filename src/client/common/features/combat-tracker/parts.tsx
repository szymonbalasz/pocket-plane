// Small combat UI parts for both clients: portrait / initials, health band badge, turn marker;
// the creature lookup (FR-CBT-63) used by the DM's encounter builder and Add dialog.
import type { HealthBand } from "@shared/combat-tracker/schemas";
import { initials } from "@shared/scenes-map/geometry";
import { ChevronRightIcon, SwordsIcon } from "lucide-react";
import { useState } from "react";
import { Popover, PopoverAnchor, PopoverContent } from "../../components/ui/controls";
import { Badge, Input } from "../../components/ui/primitives";
import { cn } from "../../lib/utils";
import { AssetImg } from "../assets-pipeline/AssetImg";
import { type LookupRow, lookupMatches, noMatchText } from "./lookup";

export function Portrait({ name, imageAssetId }: { name: string; imageAssetId: string | null }) {
  if (imageAssetId) {
    return (
      <AssetImg id={imageAssetId} file="thumb" alt="" className="size-7 shrink-0 rounded-sm" />
    );
  }
  return (
    <div className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-muted text-[10px] font-semibold text-muted-foreground">
      {initials(name)}
    </div>
  );
}

const BAND_LABEL: Record<HealthBand, string> = {
  healthy: "Healthy",
  bloodied: "Bloodied",
  down: "Down",
};

const BAND_CLASS: Record<HealthBand, string> = {
  healthy: "border-hp-full/40 text-hp-full",
  bloodied: "border-hp-bloodied/50 text-hp-bloodied",
  down: "border-hp-down/50 text-hp-down",
};

/** `hp.full` / `hp.bloodied` / `hp.down` tokens (visual-direction). */
export function BandBadge({ band, testId }: { band: HealthBand; testId: string }) {
  return (
    <Badge
      variant="outline"
      data-testid={testId}
      data-value={band}
      className={cn("px-1.5 text-[11px]", BAND_CLASS[band])}
    >
      {BAND_LABEL[band]}
    </Badge>
  );
}

export function TurnMarker({ active }: { active: boolean }) {
  return (
    <span className="flex w-4 shrink-0 justify-center text-primary" aria-hidden={!active}>
      {active ? <ChevronRightIcon className="size-4" aria-label="Current turn" /> : null}
    </span>
  );
}

export const InitiativeIcon = SwordsIcon;

/**
 * FR-CBT-63: a text input with up to 8 suggestions while something is typed (no list when
 * empty). ↑ / ↓ + Enter or click picks; focus stays in the input, which clears for the next
 * pick; Esc clears. Options `cbt-lookup-option` (+ `data-record-id`), none `cbt-lookup-empty`.
 */
export function CreatureLookup({
  rows,
  onPick,
  disabled = false,
  testId = "cbt-lookup-input",
  placeholder = "Add creature…",
}: {
  rows: readonly LookupRow[];
  onPick(id: string): void;
  disabled?: boolean;
  testId?: string;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const shown = lookupMatches(rows, q);
  const open = !disabled && !dismissed && q.trim() !== "";
  const at = Math.min(active, Math.max(0, shown.length - 1));
  const pick = (id: string) => {
    onPick(id);
    setQ("");
    setActive(0);
  };
  return (
    <Popover open={open} onOpenChange={(o) => !o && setDismissed(true)}>
      <PopoverAnchor asChild>
        <Input
          data-testid={testId}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          autoComplete="off"
          placeholder={placeholder}
          disabled={disabled}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
            setDismissed(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const step = e.key === "ArrowDown" ? 1 : -1;
              setActive(Math.min(Math.max(0, at + step), Math.max(0, shown.length - 1)));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const r = shown[at];
              if (r) pick(r.id);
            } else if (e.key === "Escape") {
              if (q !== "") e.stopPropagation();
              setQ("");
              setActive(0);
            }
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="max-h-72 w-[var(--radix-popover-trigger-width)] min-w-64 overflow-auto p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          // A click back in the input keeps the list.
          if ((e.target as HTMLElement | null)?.closest?.(`[data-testid="${testId}"]`)) {
            e.preventDefault();
          }
        }}
      >
        {shown.length === 0 ? (
          <p data-testid="cbt-lookup-empty" className="p-2 text-sm text-muted-foreground">
            {noMatchText(q)}
          </p>
        ) : (
          <ul>
            {shown.map((r, i) => (
              <li key={r.id}>
                <button
                  type="button"
                  tabIndex={-1}
                  data-testid="cbt-lookup-option"
                  data-record-id={r.id}
                  data-active={i === at}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent",
                    i === at && "bg-accent",
                  )}
                  // Keep focus in the input (FR-CBT-63).
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(r.id)}
                >
                  <span className="flex-1 truncate">{r.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {r.cr !== null ? `CR ${r.cr} · ${r.xp ?? 0} XP` : ""}
                  </span>
                  <Badge variant="outline">{r.badge}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
