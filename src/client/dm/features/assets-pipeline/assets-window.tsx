// `asset.library` "Assets" (DM, FR-ASSET-69, -70, decision #394): the campaign's uploads in one
// launcher window, no host form needed. Tabs **Images** (the one picker without Select: search,
// tags, upload, Rename / Delete, a "Used in" line, double-click → full-size preview) and **Sounds**
// (the lazy `audio-asset` library: play, rename, delete, upload; moved here from Campaign options'
// upload, which stays). DM only: players have no asset UI (ASSET §7).
import { AUDIO_ASSET_TYPE, type AudioAssetRecord } from "@shared/assets-pipeline/audio";
import {
  ALERT_SOUND_NAMES,
  ASSET_MANAGE_INTENTS,
  type AssetUse,
  type AssetUsesResult,
} from "@shared/assets-pipeline/manage";
import type { AssetRecord } from "@shared/assets-pipeline/schemas";
import type { CampaignRecord } from "@shared/campaign-management/schemas";
import type { AlertKey, AlertSounds } from "@shared/campaign-management/table-state";
import { Button } from "@ui/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@ui/components/ui/overlays";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@ui/components/ui/tabs";
import { Tip } from "@ui/components/ui/tip";
import { AssetImg } from "@ui/features/assets-pipeline/AssetImg";
import { AssetPicker } from "@ui/features/assets-pipeline/AssetPicker";
import { ImageActions } from "@ui/features/assets-pipeline/ImageActions";
import { defineWindow } from "@ui/features/play-shell/registry";
import { useAlertController } from "@ui/features/play-shell/ShellContext";
import { loadChunk } from "@ui/lib/lazy-chunk";
import { useLazyRecords, useRecords, useSync } from "@ui/sync/store";
import { ImagesIcon, PlayIcon, UploadIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { SOUND_ACCEPT, uploadSound } from "../campaign-management/AlertSoundsSection";

export const ASSETS_KIND = "asset.library";

/** FR-ASSET-69: "Used in" text for a use list. */
export function usedInText(uses: readonly AssetUse[]): string {
  if (uses.length === 0) return "Not used anywhere: it can be deleted.";
  const names = uses.map((u) => (u.name === null ? u.kind : `${u.name} (${u.kind})`));
  return `Used in: ${names.join(", ")}`;
}

/** FR-ASSET-70: the alerts that pick a sound, by their labels ("Your turn, Pause"). */
export function soundUsedBy(picks: AlertSounds | undefined, id: string): string[] {
  return Object.entries(picks ?? {})
    .filter(([, pick]) => pick === id)
    .map(([key]) => ALERT_SOUND_NAMES[key as AlertKey] ?? key);
}

/** FR-ASSET-70: a sound's length, "0.4 s". */
export const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

type Uses = { state: "loading" } | { state: "ready"; uses: AssetUse[] } | { state: "error" };

/**
 * FR-ASSET-69: the selected image's uses (`assets.uses`), asked again when the selection or the
 * image's record changes (a rename, a tag edit, a reconnect).
 */
function UsedIn({ asset }: { asset: AssetRecord }) {
  const connection = useSync((s) => s.connection);
  const live = useSync((s) => s.state === "live");
  const [uses, setUses] = useState<Uses>({ state: "loading" });
  useEffect(() => {
    if (!live) return;
    let on = true;
    setUses({ state: "loading" });
    connection
      .sendIntent(ASSET_MANAGE_INTENTS.uses, { assetId: asset.id })
      .then((r) => on && setUses({ state: "ready", uses: (r as AssetUsesResult).uses }))
      .catch(() => on && setUses({ state: "error" }));
    return () => {
      on = false;
    };
  }, [connection, live, asset]);
  return (
    <p
      data-testid="asset-lib-used"
      data-record-id={asset.id}
      data-state={uses.state}
      className="text-xs text-muted-foreground"
    >
      {uses.state === "ready"
        ? usedInText(uses.uses)
        : uses.state === "error"
          ? "Couldn't check where it's used."
          : "Checking where it's used…"}
    </p>
  );
}

function ImagesTab() {
  const records = useRecords<AssetRecord>("asset");
  const [preview, setPreview] = useState<string | null>(null);
  const shown = records.find((a) => a.id === preview) ?? null;
  return (
    <>
      <AssetPicker
        className="h-full"
        onOpen={setPreview}
        selectedExtra={(a) => <UsedIn asset={a} />}
      />
      <Dialog open={shown !== null} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent
          className="max-h-[90vh] max-w-[90vw] sm:max-w-[90vw]"
          aria-describedby={undefined}
          data-testid="asset-lib-preview"
          data-record-id={shown?.id}
        >
          <DialogHeader>
            <DialogTitle>{shown?.name}</DialogTitle>
          </DialogHeader>
          {shown && (
            <AssetImg
              id={shown.id}
              file="display"
              alt={shown.name}
              className="max-h-[calc(90vh-6rem)] w-full"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The DM store's campaign row (the DM holds only the active one). */
function useCampaign(): CampaignRecord | undefined {
  return useSync((s) => {
    const byId = s.store.records.campaign as Record<string, CampaignRecord> | undefined;
    const id = s.store.you?.campaignId;
    return (id ? byId?.[id] : undefined) ?? (byId ? Object.values(byId)[0] : undefined);
  });
}

function SoundsTab() {
  const lib = useLazyRecords<AudioAssetRecord>(AUDIO_ASSET_TYPE);
  const live = useSync((s) => s.state === "live");
  const picks = useCampaign()?.alertSounds;
  const alerts = useAlertController();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Newest first, as the image picker (FR-ASSET-10).
  const sounds = useMemo(
    () =>
      [...lib.rows].sort((a, b) =>
        a.createdAt === b.createdAt ? b.seq - a.seq : a.createdAt < b.createdAt ? 1 : -1,
      ),
    [lib.rows],
  );
  async function upload(file: File) {
    setUploading(true);
    setError(null);
    // Loaded on use: the session store reads browser storage when its module loads.
    const { useDmSession } = await loadChunk(() => import("../campaign-management/session"), {
      notice: true,
    });
    const secret = useDmSession.getState().secret;
    const r = secret ? await uploadSound(file, secret) : ({ kind: "unauthorized" } as const);
    setUploading(false);
    // A 401 resets the secret (back to login), as every DM REST call.
    if (r.kind === "unauthorized") useDmSession.getState().setSecret(null);
    else if (r.kind === "error") setError(r.message);
  }
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          data-testid="asset-lib-sound-upload"
          disabled={uploading || !live}
          onClick={() => input.current?.click()}
        >
          <UploadIcon className="size-4" /> {uploading ? "Uploading…" : "Upload"}
        </Button>
        <span className="text-xs text-muted-foreground">MP3, OGG or WAV · 512 KB · 5 s</span>
        <input
          ref={input}
          type="file"
          accept={SOUND_ACCEPT}
          className="hidden"
          data-testid="asset-lib-sound-file"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (file) void upload(file);
          }}
        />
      </div>
      {error && (
        <p data-testid="asset-lib-sound-error" role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {lib.state === "error" ? (
        <p className="text-xs text-destructive">
          Couldn't load the sounds.{" "}
          <button type="button" className="underline" onClick={lib.retry}>
            Retry
          </button>
        </p>
      ) : lib.state === "loading" ? (
        <p className="text-xs text-muted-foreground">Loading sounds…</p>
      ) : sounds.length === 0 ? (
        <p
          data-testid="asset-lib-sounds-empty"
          className="py-6 text-center text-sm text-muted-foreground"
        >
          No sounds yet. Upload a short alert sound.
        </p>
      ) : (
        <ul aria-label="Sounds" className="flex min-h-0 flex-col divide-y overflow-auto">
          {sounds.map((s) => {
            const used = soundUsedBy(picks, s.id);
            return (
              <li
                key={s.id}
                data-testid="asset-lib-sound"
                data-record-id={s.id}
                className="flex items-center gap-1 py-1"
              >
                <Tip content={`Play ${s.name}`}>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    aria-label={`Play ${s.name}`}
                    data-testid="asset-lib-sound-play"
                    onClick={() => void alerts.preview("turn", s.id)}
                  >
                    <PlayIcon className="size-3.5" />
                  </Button>
                </Tip>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm" data-testid="asset-lib-sound-name">
                    {s.name}
                  </span>
                  <span
                    data-testid="asset-lib-sound-used"
                    className="truncate text-xs text-muted-foreground"
                  >
                    {seconds(s.durationMs)}
                    {used.length > 0 ? ` · Alert: ${used.join(", ")}` : ""}
                  </span>
                </div>
                <ImageActions asset={s} live={live} noun="sound" />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function AssetsWindow() {
  const [tab, setTab] = useState("images");
  return (
    <Tabs
      value={tab}
      onValueChange={setTab}
      data-testid="asset-lib"
      className="flex h-full min-h-0 flex-col gap-2 p-2"
    >
      <TabsList>
        <TabsTrigger value="images" data-testid="asset-lib-tab" data-value="images">
          Images
        </TabsTrigger>
        <TabsTrigger value="sounds" data-testid="asset-lib-tab" data-value="sounds">
          Sounds
        </TabsTrigger>
      </TabsList>
      <TabsContent value="images" className="flex min-h-0 flex-1 flex-col">
        <ImagesTab />
      </TabsContent>
      <TabsContent value="sounds" className="flex min-h-0 flex-1 flex-col">
        <SoundsTab />
      </TabsContent>
    </Tabs>
  );
}

/** FR-ASSET-69: an ordinary DM launcher window, last in the bar. */
export const assetsWindow = defineWindow({
  kind: ASSETS_KIND,
  title: "Assets",
  clients: ["dm"],
  // As the Compendium: left edge clear of the rail; no full-size slot at 1280×720, open 400 high.
  defaultSize: { w: 440, h: 560 },
  minSize: { w: 320, h: 280 },
  usefulSize: { w: 440, h: 400 },
  minOpenH: 400,
  defaultPosition: { anchor: "top-left", dx: 56 },
  defaultOpen: false,
  // After Notifications: on a narrow bar it is the one that moves into "⋯", never the bell.
  launcher: { icon: ImagesIcon, label: "Assets", order: 85 },
  component: AssetsWindow,
});
