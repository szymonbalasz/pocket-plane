// DM "Share…" dialog (FR-PARTY-16): Not shared / Everyone / Chosen players, a checkbox per player
// (name, online dot) under Chosen, the unshare-vs-images hint, Share disabled while Chosen has
// none ticked, unchanged, not live or in flight. Sends `party.shareHandout` (share and unshare).
// FR-PARTY-38 (a): "Also open it on the screens of players who newly get it" (gainers named;
// "Nobody new" disables it; hidden for Not shared) → `present: true` (FR-PARTY-33).
import type { PlayerRecord } from "@shared/campaign-management/schemas";
import type { HandoutRecord, ShareMode } from "@shared/party-board/schemas";
import { Button } from "@ui/components/ui/button";
import { Checkbox } from "@ui/components/ui/controls";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ui/components/ui/overlays";
import { Label } from "@ui/components/ui/primitives";
import { RadioGroup, RadioGroupItem } from "@ui/features/party-board/controls";
import {
  choseEveryone,
  LOST_SHARE,
  SHARE_HINT,
  SHARE_PLAYERS_NOTE,
  type ShareDraft,
  shareDraftOf,
  shareEnabled,
  sharePayload,
  togglePlayer,
} from "@ui/features/party-board/logic";
import {
  draftGainers,
  opensOnText,
  PRESENT_TICK,
  presentFlag,
} from "@ui/features/party-board/present-logic";
import { onlineDot } from "@ui/sync/presence";
import { usePresence, useRecords } from "@ui/sync/store";
import { useEffect, useMemo, useState } from "react";
import { useIntent, useLive } from "./send";

const MODES: { value: ShareMode; label: string }[] = [
  { value: "none", label: "Not shared" },
  { value: "all", label: "Everyone" },
  { value: "players", label: "Chosen players" },
];

export function usePlayers(): PlayerRecord[] {
  const players = useRecords<PlayerRecord>("player");
  return useMemo(
    () => [...players].sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1)),
    [players],
  );
}

/** A player's online dot (FR-SYNC-29), as the Share and present dialogs show it. */
export function OnlineDot({ dot }: { dot: ReturnType<typeof onlineDot> }) {
  return (
    <>
      <span
        aria-hidden
        data-online={dot === "unknown" ? undefined : dot === "online"}
        className={
          dot === "online"
            ? "size-2 rounded-full bg-emerald-500"
            : "size-2 rounded-full bg-muted-foreground/40"
        }
      />
      <span className="sr-only">{dot === "online" ? "online" : "offline"}</span>
    </>
  );
}

export function ShareDialog({
  handout,
  open,
  onOpenChange,
}: {
  handout: HandoutRecord;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const players = usePlayers();
  const order = players.map((p) => p.id);
  const presence = usePresence();
  const live = useLive();
  const [draft, setDraft] = useState<ShareDraft>(() => shareDraftOf(handout.sharedWith));
  const [present, setPresent] = useState(false);
  const { busy, error, setError, send } = useIntent(LOST_SHARE);
  // A fresh draft from the stored share each time the dialog opens; the tick starts unticked.
  useEffect(() => {
    if (open) {
      setDraft(shareDraftOf(handout.sharedWith));
      setPresent(false);
      setError(null);
    }
  }, [open, handout.sharedWith, setError]);
  const enabled = shareEnabled(draft, handout.sharedWith, order, { live, busy });
  const gainers = draftGainers(handout.sharedWith, sharePayload(draft, order), players);
  const submit = async () => {
    const p = sharePayload(draft, order);
    if (!enabled || !p.ok) return;
    const ok = await send("party.shareHandout", {
      handoutId: handout.id,
      sharedWith: p.value,
      ...(presentFlag(present, p.value.mode, gainers.length) && { present: true }),
    });
    if (ok) onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="party-share-dialog" className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Share “{handout.title}”</DialogTitle>
          <DialogDescription>Who can see this handout.</DialogDescription>
        </DialogHeader>
        <fieldset disabled={!live} className="flex flex-col gap-2">
          <RadioGroup
            value={draft.mode}
            onValueChange={(v) => setDraft((d) => ({ ...d, mode: v as ShareMode }))}
            aria-label="Share with"
          >
            {MODES.map((m) => (
              <div key={m.value} className="flex items-center gap-2">
                <RadioGroupItem
                  id={`party-share-${m.value}`}
                  value={m.value}
                  data-testid="party-share-mode"
                  data-value={m.value}
                />
                <Label htmlFor={`party-share-${m.value}`} className="text-sm font-normal">
                  {m.label}
                </Label>
              </div>
            ))}
          </RadioGroup>
          <p data-testid="party-share-hint" className="text-xs text-muted-foreground">
            {SHARE_HINT}
          </p>
          {draft.mode === "players" && (
            <ul className="flex flex-col gap-1.5 pl-6">
              {players.length === 0 && (
                <li className="text-xs text-muted-foreground">No players in this campaign.</li>
              )}
              {players.map((p) => {
                const dot = onlineDot(presence, p.id);
                return (
                  <li key={p.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`party-share-player-${p.id}`}
                      data-testid="party-share-player"
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
                      htmlFor={`party-share-player-${p.id}`}
                      className="flex items-center gap-1.5 text-sm font-normal"
                    >
                      {p.name}
                      <OnlineDot dot={dot} />
                    </Label>
                  </li>
                );
              })}
              {choseEveryone(draft, order) && (
                <li className="text-xs text-muted-foreground">{SHARE_PLAYERS_NOTE}</li>
              )}
            </ul>
          )}
          {draft.mode !== "none" && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="party-share-present"
                  data-testid="party-share-present"
                  disabled={gainers.length === 0}
                  checked={present && gainers.length > 0}
                  onCheckedChange={(c) => setPresent(c === true)}
                />
                <Label htmlFor="party-share-present" className="text-sm font-normal">
                  {PRESENT_TICK}
                </Label>
              </div>
              <p
                data-testid="party-share-present-names"
                className="pl-6 text-xs text-muted-foreground"
              >
                {opensOnText(gainers)}
              </p>
            </div>
          )}
        </fieldset>
        {error && (
          <p data-testid="party-share-error" role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" data-testid="party-share-submit" disabled={!enabled} onClick={submit}>
            Share
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
