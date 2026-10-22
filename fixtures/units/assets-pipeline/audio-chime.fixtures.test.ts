// Sprint 8 TT3 units `audio-chime` + `camp-alert-sounds` (dice-extras §13): loaded from empty.
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { closeDb } from "@server/db/client";
import { asset, campaign } from "@server/db/schema";
import { probeAudio } from "@server/features/assets-pipeline/audio-probe";
import { eq } from "drizzle-orm";
import { chimeWav } from "../../assets/audio/chime";
import { loadBundle } from "../../index";

const cleanups: (() => void)[] = [];
afterAll(() => {
  Bun.gc(true);
  for (const c of cleanups) {
    try {
      c();
    } catch {
      // Windows may hold the temp dir a moment longer; the OS cleans it up.
    }
  }
});

async function load() {
  const r = await loadBundle("alert-sounds");
  cleanups.push(r.cleanup);
  const db = r.openDb();
  const sounds = db.select().from(asset).where(eq(asset.kind, "audio")).all();
  const active = db.select().from(campaign).where(eq(campaign.active, true)).get();
  closeDb(db);
  return { ...r, sounds, active };
}

describe("alert-sound fixtures (FR-ASSET-54, FR-CAMP-48)", () => {
  test("FR-ASSET-54 audio-chime: generated 0.4 s 16-bit mono 22,050 Hz WAV of 17,684 B; picks request + pause", async () => {
    const bytes = chimeWav();
    expect(bytes.byteLength).toBe(17_684);
    expect(probeAudio(bytes)).toEqual({ mime: "audio/wav", durationMs: 400 });
    const r = await load();
    expect(r.sounds).toHaveLength(1);
    const chime = r.sounds[0];
    expect(chime).toMatchObject({
      name: "Chime",
      mime: "audio/wav",
      bytes: 17_684,
      durationMs: 400,
      listed: true,
      tags: [],
    });
    expect(r.manifest.records["audio-chime"]?.["audio-asset"]).toEqual([chime?.id as string]);
    const stored = readFileSync(path.join(r.config.assetDir, chime?.hash as string, "original"));
    expect(stored.equals(Buffer.from(bytes))).toBe(true);
    expect(r.active?.alertSounds).toEqual({ request: chime?.id, pause: chime?.id });
    // Same bytes and seed → the same ID on every load (FR-ASSET-18).
    const again = await load();
    expect(again.sounds[0]?.id).toBe(chime?.id as string);
  }, 60_000);
});
