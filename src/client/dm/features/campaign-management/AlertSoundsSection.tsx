// Alert sounds in Campaign options (FR-CAMP-49, OQ-CAMP-35 A; sprint 8 TT3): a row per alert key
// (Select Default / None / the library's sounds, Test ▶) and one "Upload sound…" whose refusals
// show inline. The library is the lazy DM-only `audio-asset` type, loaded when the Dialog opens
// (FR-ASSET-57). A pick sends `camp.setAlertSound`; players get only the picked IDs. DM only,
// `live` only.
import { AUDIO_ASSET_TYPE, type AudioAssetRecord } from "@shared/assets-pipeline/audio";
import { UploadResponse } from "@shared/assets-pipeline/schemas";
import {
  ALERT_DEFAULTS,
  ALERT_KEYS,
  type AlertKey,
  type AlertSoundPick,
  type AlertSounds,
  SET_ALERT_SOUND_INTENT,
} from "@shared/campaign-management/table-state";
import { RestError } from "@shared/protocol/codes";
import { Button } from "@ui/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ui/components/ui/overlays";
import { Tip } from "@ui/components/ui/tip";
import { uploadBody } from "@ui/features/assets-pipeline/upload";
import { intentErrorText } from "@ui/features/character-sheet/routing";
import type { SoundOutcome } from "@ui/features/play-shell/audio";
import { useAlertController } from "@ui/features/play-shell/ShellContext";
import { ALERT_LABELS } from "@ui/features/play-shell/sounds";
import { loadChunk } from "@ui/lib/lazy-chunk";
import { useLazyRecords, useSync } from "@ui/sync/store";
import { PlayIcon, UploadIcon } from "lucide-react";
import { useRef, useState } from "react";

export type SoundPick = AlertSoundPick | "default";

/** A key's Select value: its pick, or `default` when absent (FR-CAMP-48). */
export const pickValue = (picks: AlertSounds | undefined, key: AlertKey): SoundPick =>
  picks?.[key] ?? "default";

/** "Default (Ping)" for turn / request, "Default (Silent)" for pause / resume (OQ-CAMP-36 A). */
export const defaultLabel = (key: AlertKey) =>
  ALERT_DEFAULTS[key] === "ping" ? "Default (Ping)" : "Default (Silent)";

/** Select options: Default, None, then the library by name (a pick not in it stays listed). */
export function soundOptions(
  key: AlertKey,
  library: readonly AudioAssetRecord[],
  current: SoundPick,
): { value: SoundPick; label: string }[] {
  const sounds = [...library]
    .sort((a, b) => a.name.localeCompare(b.name) || a.seq - b.seq)
    .map((s) => ({ value: s.id, label: s.name }));
  const known =
    current === "default" || current === "none" || sounds.some((s) => s.value === current);
  return [
    { value: "default", label: defaultLabel(key) },
    { value: "none", label: "None" },
    ...sounds,
    ...(known ? [] : [{ value: current, label: "Sound" }]),
  ];
}

export type SoundUploadResult =
  | { kind: "ok"; id: string; name: string }
  | { kind: "unauthorized" }
  | { kind: "error"; message: string };

/** The upload's outcome from a REST status and body (FR-ASSET-52's messages shown as sent). */
export function soundUploadResult(status: number, body: unknown): SoundUploadResult {
  if (status === 401) return { kind: "unauthorized" };
  if (status === 200 || status === 201) {
    const r = UploadResponse.safeParse(body);
    if (r.success) return { kind: "ok", id: r.data.asset.id, name: r.data.asset.name };
  }
  const err = RestError.safeParse(body);
  return { kind: "error", message: err.success ? err.data.message : "Upload failed, try again" };
}

/** `POST /api/assets` with `kind=audio`: anything but a sound → 415 (FR-ASSET-52). */
export async function uploadSound(
  file: File,
  secret: string,
  fetchFn: typeof fetch = fetch,
): Promise<SoundUploadResult> {
  const body = uploadBody(file, { listed: true });
  body.append("kind", "audio");
  try {
    const res = await fetchFn("/api/assets", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
      body,
    });
    return soundUploadResult(res.status, await res.json().catch(() => null));
  } catch {
    return { kind: "error", message: "Upload failed, try again" };
  }
}

/** File types the picker offers (the server sniffs; this only narrows the dialog). */
export const SOUND_ACCEPT = "audio/mpeg,audio/ogg,audio/wav,audio/x-wav,.mp3,.ogg,.oga,.opus,.wav";

export interface AlertSoundRowsProps {
  picks: AlertSounds | undefined;
  library: readonly AudioAssetRecord[];
  libraryState: "loading" | "ready" | "error";
  live: boolean;
  onRetry(): void;
  onPick(key: AlertKey, sound: SoundPick): Promise<void>;
  onPreview(key: AlertKey, sound: SoundPick): Promise<SoundOutcome | null>;
  onUpload(file: File): Promise<SoundUploadResult>;
}

function SoundRow({
  alert,
  value,
  props,
}: {
  alert: AlertKey;
  value: SoundPick;
  props: AlertSoundRowsProps;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const id = `camp-sound-${alert}`;
  async function pick(next: SoundPick) {
    setBusy(true);
    setError(null);
    try {
      await props.onPick(alert, next);
    } catch (err) {
      setError(intentErrorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div data-testid="camp-sound" data-value={alert} className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="w-24 shrink-0 text-sm">
          {ALERT_LABELS[alert]}
        </label>
        <Select value={value} disabled={busy || !props.live} onValueChange={(v) => void pick(v)}>
          <SelectTrigger
            id={id}
            className="h-8 min-w-0 flex-1"
            data-testid="camp-sound-select"
            data-value={value}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {soundOptions(alert, props.library, value).map((o) => (
              <SelectItem key={o.value} value={o.value} data-value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Tip content={`Test ${ALERT_LABELS[alert]} sound`}>
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label={`Test ${ALERT_LABELS[alert]} sound`}
            data-testid="camp-sound-test"
            data-outcome={outcome ?? undefined}
            onClick={() =>
              void props.onPreview(alert, value).then((o) => setOutcome(o ?? "silent"))
            }
          >
            <PlayIcon className="size-3.5" />
          </Button>
        </Tip>
      </div>
      {error && (
        <p data-testid="camp-sound-error" role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** FR-CAMP-49: the rows and the upload, from props (static-renderable; the section wires them). */
export function AlertSoundRows(props: AlertSoundRowsProps) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function upload(file: File) {
    setUploading(true);
    setError(null);
    const r = await props.onUpload(file);
    setUploading(false);
    if (r.kind === "error") setError(r.message);
  }
  return (
    <section data-testid="camp-sounds" className="flex flex-col gap-3 border-t pt-3">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-sm font-semibold">Alert sounds</h3>
        <p className="text-xs text-muted-foreground">
          Played on players' screens; their own mute and volume still apply.
        </p>
      </div>
      {ALERT_KEYS.map((k) => (
        <SoundRow key={k} alert={k} value={pickValue(props.picks, k)} props={props} />
      ))}
      {props.libraryState === "error" && (
        <p className="text-xs text-destructive">
          Couldn't load the sounds.{" "}
          <button type="button" className="underline" onClick={props.onRetry}>
            Retry
          </button>
        </p>
      )}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1"
            data-testid="camp-sound-upload"
            disabled={uploading || !props.live}
            onClick={() => input.current?.click()}
          >
            <UploadIcon className="size-3.5" /> {uploading ? "Uploading…" : "Upload sound…"}
          </Button>
          <span className="text-xs text-muted-foreground">MP3, OGG or WAV · 512 KB · 5 s</span>
          <input
            ref={input}
            type="file"
            accept={SOUND_ACCEPT}
            className="hidden"
            data-testid="camp-sound-file"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = "";
              if (file) void upload(file);
            }}
          />
        </div>
        {error && (
          <p data-testid="camp-sound-error" role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

/** FR-CAMP-49: the section in the Campaign options Dialog (mounted only while it is open). */
export function AlertSoundsSection({ picks }: { picks: AlertSounds | undefined }) {
  const connection = useSync((s) => s.connection);
  const live = useSync((s) => s.state === "live");
  const lib = useLazyRecords<AudioAssetRecord>(AUDIO_ASSET_TYPE);
  const alerts = useAlertController();
  return (
    <AlertSoundRows
      picks={picks}
      library={lib.rows}
      libraryState={lib.state}
      live={live}
      onRetry={lib.retry}
      onPick={async (alert, sound) => {
        await connection.sendIntent(SET_ALERT_SOUND_INTENT, { alert, sound });
      }}
      onPreview={(alert, sound) => alerts.preview(alert, sound)}
      onUpload={async (file) => {
        // Loaded on use: the session store reads browser storage when its module loads.
        const { useDmSession } = await loadChunk(() => import("./session"), { notice: true });
        const secret = useDmSession.getState().secret;
        if (!secret) return { kind: "unauthorized" };
        const r = await uploadSound(file, secret);
        // A 401 resets the secret (back to login), as every DM REST call.
        if (r.kind === "unauthorized") useDmSession.getState().setSecret(null);
        return r;
      }}
    />
  );
}
