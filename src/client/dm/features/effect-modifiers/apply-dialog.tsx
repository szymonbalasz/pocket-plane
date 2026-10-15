// DM apply dialog (FR-MOD-09/10/28): duration (default the preset's), source, link to or start
// the source's concentration, secret; sends `mod.apply` for the targets the token menu picked.
// Skipped targets (same preset already active) show in a Toast. "Edit presets…" opens the
// preset manager.
import { endsRoundOf } from "@shared/combat-extras/rules";
import type { ApplyResult } from "@shared/effect-modifiers/intents";
import { MOD_INTENTS } from "@shared/effect-modifiers/intents";
import type { PresetChoice } from "@shared/effect-modifiers/rules";
import { Button } from "@ui/components/ui/button";
import { Checkbox } from "@ui/components/ui/controls";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ui/components/ui/overlays";
import { Input, Label } from "@ui/components/ui/primitives";
import { activeEffects, creatureOf, effectsOn, endsHint } from "@ui/features/combat-extras/logic";
import { useCombatants, useStartedEncounter } from "@ui/features/combat-tracker/store";
import { modifiersText } from "@ui/features/effect-modifiers/describe";
import { useModIntent } from "@ui/features/effect-modifiers/store";
import { useSync } from "@ui/sync/store";
import { useState } from "react";
import { toast } from "sonner";
import { PresetManager } from "./preset-manager";
import { type ModTarget, useModDialogs } from "./store";

const NONE = "none";

export const presetRef = (c: PresetChoice) =>
  c.source === "campaign" ? { presetId: c.preset.id } : { key: c.key };

function ApplyForm({
  targets,
  choice,
  close,
}: {
  targets: ModTarget[];
  choice: PresetChoice;
  close(): void;
}) {
  const { send, disabled } = useModIntent();
  const enc = useStartedEncounter();
  const rows = useCombatants(enc?.id).filter((c) => !c.removed);
  const store = useSync((s) => s.store);
  const p = choice.preset;
  const [duration, setDuration] = useState(
    p.durationRounds === null ? "" : String(p.durationRounds),
  );
  const [source, setSource] = useState<string>(NONE);
  const [link, setLink] = useState(false);
  const [start, setStart] = useState(p.concentration);
  const [secret, setSecret] = useState(false);
  const src = rows.find((c) => c.id === source);
  const conc = src
    ? effectsOn(activeEffects(store), creatureOf(src)).find((e) => e.kind === "concentration")
    : undefined;
  const rounds = duration.trim() === "" ? null : Number(duration);
  const validRounds = rounds === null || (Number.isInteger(rounds) && rounds >= 1 && rounds <= 100);
  const startOn = !!src && p.concentration && start;
  const linkOn = !!src && !startOn && !!conc && link;
  const submit = async () => {
    if (!validRounds) return;
    const r = await send<ApplyResult>(MOD_INTENTS.apply, {
      targets: targets.map((t) => t.ref),
      preset: presetRef(choice),
      durationRounds: rounds,
      ...(src ? { sourceCombatantId: src.id } : {}),
      ...(startOn ? { startConcentration: true } : {}),
      ...(linkOn ? { linkConcentration: true } : {}),
      ...(secret ? { secret: true } : {}),
    });
    if (r === undefined) return;
    if (r && r.skipped.length > 0) {
      toast(
        <span data-testid="mod-apply-skipped">
          {p.name} already on: {r.skipped.join(", ")}
        </span>,
      );
    }
    close();
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>Apply {p.name}</DialogTitle>
        <DialogDescription>
          {targets.map((t) => t.name).join(", ")} · {modifiersText(p.modifiers)}
        </DialogDescription>
      </DialogHeader>
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="mod-apply-duration">Duration (rounds)</Label>
          <Input
            id="mod-apply-duration"
            data-testid="mod-apply-duration"
            inputMode="numeric"
            placeholder="Until removed"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {!enc
              ? "No encounter running: no duration"
              : typeof rounds === "number" && validRounds
                ? endsHint({
                    sourceName: src?.name ?? null,
                    turnName: rows.find((c) => c.id === enc.turnCombatantId)?.name ?? null,
                    targetNames: targets.map((t) => t.name),
                    endsRound: endsRoundOf(enc.round, rounds),
                  })
                : "Until removed"}
          </p>
        </div>
        {enc && (
          <div className="grid gap-1.5">
            <Label>Source</Label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger data-testid="mod-apply-source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No source</SelectItem>
                {rows.map((c) => (
                  <SelectItem
                    key={c.id}
                    value={c.id}
                    data-testid="mod-apply-source-option"
                    data-value={c.id}
                  >
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {src && p.concentration && (
          <div className="flex items-center gap-2 text-sm">
            <Checkbox
              id="mod-apply-start-conc"
              data-testid="mod-apply-start-conc"
              checked={start}
              onCheckedChange={(v) => setStart(v === true)}
            />
            <Label htmlFor="mod-apply-start-conc">
              {src.name} starts concentrating on {p.name}
            </Label>
          </div>
        )}
        {src && conc && !startOn && (
          <div className="flex items-center gap-2 text-sm">
            <Checkbox
              id="mod-apply-link"
              data-testid="mod-apply-link"
              checked={link}
              onCheckedChange={(v) => setLink(v === true)}
            />
            <Label htmlFor="mod-apply-link">
              Ends with {src.name}'s concentration ({conc.label})
            </Label>
          </div>
        )}
        <div className="flex items-center gap-2 text-sm">
          <Checkbox
            id="mod-apply-secret"
            data-testid="mod-apply-secret"
            checked={secret}
            onCheckedChange={(v) => setSecret(v === true)}
          />
          <Label htmlFor="mod-apply-secret">Hidden from players</Label>
        </div>
      </form>
      <DialogFooter>
        <PresetManager />
        <Button variant="ghost" onClick={close}>
          Cancel
        </Button>
        <Button data-testid="mod-apply-submit" disabled={disabled || !validRounds} onClick={submit}>
          Apply
        </Button>
      </DialogFooter>
    </>
  );
}

/** The token menu entry's Dialog (FR-MAP-29 dialog mechanism). */
export function ApplyDialog({ close }: { close(): void }) {
  const d = useModDialogs((s) => s.apply);
  const reset = useModDialogs((s) => s.close);
  const done = () => {
    reset();
    close();
  };
  return (
    <Dialog open={d !== null} onOpenChange={(o) => !o && done()}>
      <DialogContent data-testid="mod-apply" className="sm:max-w-sm">
        {d && <ApplyForm key={`${d.choice.key}-${d.targets.length}`} {...d} close={done} />}
      </DialogContent>
    </Dialog>
  );
}
