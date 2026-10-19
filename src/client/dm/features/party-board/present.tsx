// DM present controls (FR-PARTY-38 b–d): the "On screen: ‹n›" Badge (Tooltip: names in present
// order), the "Open on screens…" dialog (everyone it's shared with / chosen players who can see
// it → `party.presentHandout`) and "Close on all screens" (`party.closePresent {handoutId}`). The
// DM's own client never pops anything.
import {
  HANDOUT_PRESENT_TYPE,
  type HandoutPresentRecord,
  type HandoutRecord,
} from "@shared/party-board/schemas";
import { Button } from "@ui/components/ui/button";
import { Checkbox } from "@ui/components/ui/controls";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Tooltip,
} from "@ui/components/ui/overlays";
import { Badge, Label } from "@ui/components/ui/primitives";
import { RadioGroup, RadioGroupItem } from "@ui/features/party-board/controls";
import { togglePlayer } from "@ui/features/party-board/logic";
import {
  EMPTY_PRESENT_DRAFT,
  LOST_PRESENT,
  onScreenNames,
  onScreenText,
  type PresentDraft,
  type PresentMode,
  presentCandidates,
  presentEnabled,
  presentPayload,
  presentsOf,
} from "@ui/features/party-board/present-logic";
import { onlineDot } from "@ui/sync/presence";
import { usePresence, useRecords } from "@ui/sync/store";
import { useEffect, useMemo, useState } from "react";
import { OnlineDot, usePlayers } from "./ShareDialog";
import { useIntent, useLive } from "./send";

const MODES: { value: PresentMode; label: string }[] = [
  { value: "all", label: "Everyone it's shared with" },
  { value: "players", label: "Chosen players" },
];

/** FR-PARTY-38 (c): the handout's open rows, in present order. */
export function useOnScreen(handoutId: string): HandoutPresentRecord[] {
  const rows = useRecords<HandoutPresentRecord>(HANDOUT_PRESENT_TYPE);
  return useMemo(() => presentsOf(rows, handoutId), [rows, handoutId]);
}

/** "On screen: ‹n›" while n > 0; Tooltip: the players' names. */
export function OnScreenBadge({ handoutId }: { handoutId: string }) {
  const rows = useOnScreen(handoutId);
  const players = usePlayers();
  const names = useMemo(() => new Map(players.map((p) => [p.id, p.name])), [players]);
  if (rows.length === 0) return null;
  return (
    <Tooltip content={onScreenNames(rows, (id) => names.get(id)) || onScreenText(rows.length)}>
      <Badge
        variant="default"
        className="px-1.5 py-0"
        data-testid="party-present-count"
        data-value={rows.length}
      >
        {onScreenText(rows.length)}
      </Badge>
    </Tooltip>
  );
}

/** FR-PARTY-38 (d): "Close on all screens" while n > 0. */
export function CloseAllButton({ handoutId }: { handoutId: string }) {
  const live = useLive();
  const rows = useOnScreen(handoutId);
  const close = useIntent(LOST_PRESENT);
  if (rows.length === 0) return null;
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2"
        data-testid="party-present-close-all"
        disabled={!live || close.busy}
        onClick={() => close.send("party.closePresent", { handoutId })}
      >
        Close on all screens
      </Button>
      {close.error && (
        <span role="alert" className="text-xs text-destructive">
          {close.error}
        </span>
      )}
    </>
  );
}

/** FR-PARTY-38 (b): "Open on screens…" (shared handouts only). */
export function PresentDialog({
  handout,
  open,
  onOpenChange,
}: {
  handout: HandoutRecord;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const players = usePlayers();
  const candidates = useMemo(
    () => presentCandidates(handout.sharedWith, players),
    [handout.sharedWith, players],
  );
  const presence = usePresence();
  const live = useLive();
  const [draft, setDraft] = useState<PresentDraft>(EMPTY_PRESENT_DRAFT);
  const { busy, error, setError, send } = useIntent(LOST_PRESENT);
  // A fresh draft (Everyone it's shared with) each time the dialog opens.
  useEffect(() => {
    if (open) {
      setDraft(EMPTY_PRESENT_DRAFT);
      setError(null);
    }
  }, [open, setError]);
  const enabled = presentEnabled(draft, candidates, { live, busy });
  const submit = async () => {
    const p = presentPayload(draft, candidates);
    if (!enabled || !p.ok) return;
    const ok = await send("party.presentHandout", { handoutId: handout.id, to: p.value });
    if (ok) onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="party-present-dialog" className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Open “{handout.title}” on screens</DialogTitle>
          <DialogDescription>
            It opens over everything until each player closes it.
          </DialogDescription>
        </DialogHeader>
        <fieldset disabled={!live} className="flex flex-col gap-2">
          <RadioGroup
            value={draft.mode}
            onValueChange={(v) => setDraft((d) => ({ ...d, mode: v as PresentMode }))}
            aria-label="Open on"
          >
            {MODES.map((m) => (
              <div key={m.value} className="flex items-center gap-2">
                <RadioGroupItem
                  id={`party-present-${m.value}`}
                  value={m.value}
                  data-testid="party-present-mode"
                  data-value={m.value}
                />
                <Label htmlFor={`party-present-${m.value}`} className="text-sm font-normal">
                  {m.label}
                </Label>
              </div>
            ))}
          </RadioGroup>
          {draft.mode === "players" && (
            <ul className="flex flex-col gap-1.5 pl-6">
              {candidates.length === 0 && (
                <li className="text-xs text-muted-foreground">Nobody can see this handout.</li>
              )}
              {candidates.map((p) => {
                return (
                  <li key={p.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`party-present-player-${p.id}`}
                      data-testid="party-present-player"
                      data-record-id={p.id}
                      checked={draft.playerIds.includes(p.id)}
                      onCheckedChange={(c) =>
                        setDraft((d) => ({
                          ...d,
                          playerIds: togglePlayer(d.playerIds, p.id, c === true),
                        }))
                      }
                    />
                    <Label
                      htmlFor={`party-present-player-${p.id}`}
                      className="flex items-center gap-1.5 text-sm font-normal"
                    >
                      {p.name}
                      <OnlineDot dot={onlineDot(presence, p.id)} />
                    </Label>
                  </li>
                );
              })}
            </ul>
          )}
        </fieldset>
        {error && (
          <p data-testid="party-present-error" role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" data-testid="party-present-submit" disabled={!enabled} onClick={submit}>
            Open
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
