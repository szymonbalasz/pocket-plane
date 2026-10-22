// FR-CAMP-49 Alert sounds in Campaign options (TT3): static renders of the rows over props, the
// option list, and the upload's outcomes. Clicks (pick, Test, upload rejects) run in
// e2e/alert-sounds.e2e.ts.
import { describe, expect, test } from "bun:test";
import type { AudioAssetRecord } from "@shared/assets-pipeline/audio";
import { TooltipProvider } from "@ui/components/ui/overlays";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AlertSoundRows,
  type AlertSoundRowsProps,
  pickValue,
  SOUND_ACCEPT,
  soundOptions,
  soundUploadResult,
  uploadSound,
} from "./AlertSoundsSection";

const CHIME = "C".repeat(22);
const sound = (id: string, name: string, seq: number): AudioAssetRecord => ({
  id,
  campaignId: "c1",
  seq,
  name,
  mime: "audio/wav",
  bytes: 17_684,
  durationMs: 400,
  createdAt: "2026-10-22T10:00:00.000Z",
});
const LIBRARY = [sound("G".repeat(22), "Gong", 2), sound(CHIME, "Chime", 1)];

function render(over: Partial<AlertSoundRowsProps> = {}): string {
  const props: AlertSoundRowsProps = {
    picks: { request: CHIME, pause: "none" },
    library: LIBRARY,
    libraryState: "ready",
    live: true,
    onRetry: () => {},
    onPick: async () => {},
    onPreview: async () => "played",
    onUpload: async () => ({ kind: "ok", id: CHIME, name: "Chime" }),
    ...over,
  };
  return renderToStaticMarkup(
    <TooltipProvider delayDuration={0} skipDelayDuration={0}>
      <AlertSoundRows {...props} />
    </TooltipProvider>,
  );
}

const rowHtml = (html: string, key: string) => {
  const start = html.indexOf(`data-testid="camp-sound" data-value="${key}"`);
  const next = html.indexOf('data-testid="camp-sound"', start + 10);
  return html.slice(start, next < 0 ? undefined : next);
};
const tag = (html: string, id: string) =>
  html.match(new RegExp(`<[^>]*data-testid="${id}"[^>]*>`))?.[0] ?? "";

describe("FR-CAMP-49 alert sounds section", () => {
  test("FR-CAMP-49 alert sounds section: a row per key with its pick, Test, one Upload; disabled unless live", () => {
    const html = render();
    expect(html).toContain("Alert sounds");
    for (const [key, value] of [
      ["turn", "default"],
      ["request", CHIME],
      ["pause", "none"],
      ["resume", "default"],
    ]) {
      const row = rowHtml(html, key as string);
      expect(tag(row, "camp-sound-select")).toContain(`data-value="${value}"`);
      expect(row).toContain('data-testid="camp-sound-test"');
    }
    expect(html.split('data-testid="camp-sound-upload"').length - 1).toBe(1);
    expect(tag(html, "camp-sound-file")).toContain(`accept="${SOUND_ACCEPT}"`);
    expect(tag(html, "camp-sound-upload")).not.toContain('disabled=""');
    expect(html).not.toContain('data-testid="camp-sound-error"');
    const off = render({ live: false });
    expect(tag(off, "camp-sound-upload")).toContain('disabled=""');
    expect(tag(off, "camp-sound-select")).toContain('disabled=""');
    expect(render({ libraryState: "error" })).toContain("load the sounds");
  });

  test("FR-CAMP-49 options: Default (Ping / Silent), None, then the library by name; picks map to values", () => {
    expect(soundOptions("turn", LIBRARY, "default").map((o) => o.label)).toEqual([
      "Default (Ping)",
      "None",
      "Chime",
      "Gong",
    ]);
    expect(soundOptions("resume", [], "default")[0]?.label).toBe("Default (Silent)");
    // A pick the library doesn't hold (not loaded yet) stays selectable.
    expect(soundOptions("turn", [], CHIME).map((o) => o.value)).toEqual(["default", "none", CHIME]);
    expect([pickValue(undefined, "turn"), pickValue({ turn: "none" }, "turn")]).toEqual([
      "default",
      "none",
    ]);
  });

  test("FR-CAMP-49 upload: kind=audio with the DM secret; the server's refusal shows as sent; 401 → unauthorized", async () => {
    const sent: { url: string; init: RequestInit }[] = [];
    const reply = (status: number, body: unknown) =>
      (async (url: string, init: RequestInit) => {
        sent.push({ url, init });
        return new Response(JSON.stringify(body), { status });
      }) as unknown as typeof fetch;
    const file = new File([new Uint8Array(10)], "big.wav");
    const big = await uploadSound(
      file,
      "secret-123456",
      reply(413, { code: "invalid", message: "Too large (max 512 KB)" }),
    );
    expect(big).toEqual({ kind: "error", message: "Too large (max 512 KB)" });
    const init = sent[0]?.init as RequestInit;
    expect(sent[0]?.url).toBe("/api/assets");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-123456");
    expect((init.body as FormData).get("kind")).toBe("audio");
    expect(soundUploadResult(422, { code: "invalid", message: "Too long (max 5 s)" })).toEqual({
      kind: "error",
      message: "Too long (max 5 s)",
    });
    expect(soundUploadResult(415, { code: "invalid", message: "Unsupported file type" })).toEqual({
      kind: "error",
      message: "Unsupported file type",
    });
    expect(soundUploadResult(401, null)).toEqual({ kind: "unauthorized" });
    expect(soundUploadResult(500, "oops")).toEqual({
      kind: "error",
      message: "Upload failed, try again",
    });
    const ok = soundUploadResult(201, {
      asset: {
        ...sound(CHIME, "Chime", 1),
        width: 0,
        height: 0,
        displayWidth: 0,
        displayHeight: 0,
        tags: [],
      },
    });
    expect(ok).toEqual({ kind: "ok", id: CHIME, name: "Chime" });
  });
});
