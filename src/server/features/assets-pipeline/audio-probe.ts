// Audio probe (FR-ASSET-53, OQ-ASSET-29 A): pure, hand-rolled, no dependency. Sniffs WAV / MP3 /
// OGG from content (never the extension or Content-Type) and measures the length from headers. It
// never decodes: a file that passes but won't decode falls back to the ping in the browser
// (FR-SHELL-131), and the client stops any source at 5 s (FR-SHELL-133).
import type { AudioMime } from "@shared/assets-pipeline/audio";

export type AudioProbe = { mime: AudioMime; durationMs: number } | null;

/**
 * Cross-check (FR-ASSET-53): the header's length must agree with the length the bytes imply
 * within 20 %, else the larger counts (a lying header can't shorten a sound).
 */
export function crossCheck(headerMs: number, bytesMs: number | null): number {
  if (bytesMs === null || !Number.isFinite(bytesMs)) return headerMs;
  const larger = Math.max(headerMs, bytesMs);
  return Math.abs(headerMs - bytesMs) <= 0.2 * larger ? headerMs : larger;
}

const ascii = (b: Uint8Array, at: number, s: string) =>
  b.length >= at + s.length && [...s].every((ch, i) => b[at + i] === ch.charCodeAt(0));

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

/** The sound's type and length, or null (not a sound we accept, or a header we can't read). */
export function probeAudio(bytes: Uint8Array): AudioProbe {
  const r = probeWav(bytes) ?? probeOgg(bytes) ?? probeMp3(bytes);
  if (!r || !Number.isFinite(r.durationMs) || r.durationMs <= 0) return null;
  return { mime: r.mime, durationMs: Math.round(r.durationMs) };
}

/** True when the bytes claim to be one of our sound types (before the length is read). */
export function looksLikeAudio(b: Uint8Array): boolean {
  return (
    (ascii(b, 0, "RIFF") && ascii(b, 8, "WAVE")) ||
    ascii(b, 0, "OggS") ||
    ascii(b, 0, "ID3") ||
    mp3Header(b, 0) !== null
  );
}

// ── WAV ────────────────────────────────────────────────────────────────────────────────────────

const WAV_PCM = 1;
const WAV_FLOAT = 3;
const WAV_EXTENSIBLE = 0xfffe;

/** `RIFF…WAVE`, PCM or float: `data` bytes ÷ byte rate, checked against the bytes present. */
function probeWav(b: Uint8Array): AudioProbe {
  if (!(ascii(b, 0, "RIFF") && ascii(b, 8, "WAVE"))) return null;
  const v = view(b);
  let fmt: {
    format: number;
    channels: number;
    rate: number;
    byteRate: number;
    bits: number;
  } | null = null;
  let at = 12;
  while (at + 8 <= b.length) {
    const size = v.getUint32(at + 4, true);
    const body = at + 8;
    if (ascii(b, at, "fmt ")) {
      if (size < 16 || body + 16 > b.length) return null;
      let format = v.getUint16(body, true);
      if (format === WAV_EXTENSIBLE && size >= 40 && body + 26 <= b.length) {
        format = v.getUint16(body + 24, true); // sub-format GUID's first two bytes
      }
      fmt = {
        format,
        channels: v.getUint16(body + 2, true),
        rate: v.getUint32(body + 4, true),
        byteRate: v.getUint32(body + 8, true),
        bits: v.getUint16(body + 14, true),
      };
    } else if (ascii(b, at, "data")) {
      if (!fmt || (fmt.format !== WAV_PCM && fmt.format !== WAV_FLOAT)) return null;
      const { channels, rate, bits } = fmt;
      if (channels < 1 || channels > 8 || rate < 1 || rate > 384_000) return null;
      if (![8, 16, 24, 32, 64].includes(bits)) return null;
      const realRate = (rate * channels * bits) / 8;
      const present = b.length - body;
      // 0 / 0xFFFFFFFF = a streamed WAV that never wrote its size: the bytes decide.
      const sized = size !== 0 && size !== 0xffffffff;
      const dataBytes = sized ? size : present;
      const headerRate = fmt.byteRate > 0 ? fmt.byteRate : realRate;
      const headerMs = (dataBytes / headerRate) * 1000;
      const bytesMs = (Math.min(dataBytes, present) / realRate) * 1000;
      return { mime: "audio/wav", durationMs: crossCheck(headerMs, bytesMs) };
    }
    at = body + size + (size % 2);
  }
  return null;
}

// ── MP3 (MPEG audio Layer III) ─────────────────────────────────────────────────────────────────

const BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000], // MPEG 1
  2: [22050, 24000, 16000], // MPEG 2
  0: [11025, 12000, 8000], // MPEG 2.5
};

interface Mp3Frame {
  /** kbit/s */
  bitrate: number;
  rate: number;
  samples: number;
  length: number;
  mpeg1: boolean;
  mono: boolean;
}

/** A Layer III frame header at `at`, or null (free-format and reserved values refused). */
export function mp3Header(b: Uint8Array, at: number): Mp3Frame | null {
  if (at + 4 > b.length) return null;
  const b1 = b[at + 1] as number;
  const b2 = b[at + 2] as number;
  const b3 = b[at + 3] as number;
  if (b[at] !== 0xff || (b1 & 0xe0) !== 0xe0) return null;
  const version = (b1 >> 3) & 3;
  if (version === 1 || ((b1 >> 1) & 3) !== 1) return null; // reserved version; not Layer III
  const brIdx = b2 >> 4;
  const srIdx = (b2 >> 2) & 3;
  if (brIdx === 0 || brIdx === 15 || srIdx === 3) return null;
  const mpeg1 = version === 3;
  const bitrate = (mpeg1 ? BITRATES_V1 : BITRATES_V2)[brIdx] as number;
  const rate = RATES[version]?.[srIdx] as number;
  const samples = mpeg1 ? 1152 : 576;
  const length = Math.floor(((samples / 8) * bitrate * 1000) / rate) + ((b2 >> 1) & 1);
  return { bitrate, rate, samples, length, mpeg1, mono: ((b3 >> 6) & 3) === 3 };
}

/** Bytes of ID3v2 tags at the start (several may follow each other). */
function id3Length(b: Uint8Array): number {
  let at = 0;
  while (ascii(b, at, "ID3") && at + 10 <= b.length) {
    const size =
      (((b[at + 6] as number) & 0x7f) << 21) |
      (((b[at + 7] as number) & 0x7f) << 14) |
      (((b[at + 8] as number) & 0x7f) << 7) |
      ((b[at + 9] as number) & 0x7f);
    const footer = ((b[at + 5] as number) & 0x10) !== 0 ? 10 : 0;
    at += 10 + size + footer;
  }
  return at;
}

/** How far past the tags the first frame may start (encoder padding). */
const MP3_SYNC_WINDOW = 4096;

/**
 * ID3v2 skipped; Layer III frames. Length from a Xing / Info / VBRI frame count, else a frame
 * walk; checked against the audio bytes ÷ the bitrate.
 */
function probeMp3(b: Uint8Array): AudioProbe {
  const tags = id3Length(b);
  if (tags > b.length) return null;
  // Without a tag the file must start on a frame; after one, a little padding is tolerated, and
  // the frame found must be followed by another (or the end) so stray 0xFF bytes don't count.
  const last = tags === 0 ? 0 : Math.min(b.length - 4, tags + MP3_SYNC_WINDOW);
  let start = -1;
  for (let at = tags; at <= last; at++) {
    const f = mp3Header(b, at);
    if (!f) continue;
    const next = at + f.length;
    if (next >= b.length || mp3Header(b, next) || tags === 0) {
      start = at;
      break;
    }
  }
  if (start < 0) return null;
  const first = mp3Header(b, start) as Mp3Frame;
  const end = ascii(b, b.length - 128, "TAG") ? b.length - 128 : b.length;
  const audioBytes = end - start;
  const bytesMs = (audioBytes * 8) / first.bitrate; // kbit/s = bit/ms

  const v = view(b);
  const side = first.mpeg1 ? (first.mono ? 17 : 32) : first.mono ? 9 : 17;
  const xing = start + 4 + side;
  if (ascii(b, xing, "Xing") || ascii(b, xing, "Info")) {
    if (xing + 12 > b.length) return null;
    const flags = v.getUint32(xing + 4, false);
    if (flags & 1) {
      const frames = v.getUint32(xing + 8, false);
      const headerMs = ((frames * first.samples) / first.rate) * 1000;
      // VBR: the header's byte count stands in for the bitrate, when it has one.
      if (flags & 2 && xing + 16 <= b.length) {
        const declared = v.getUint32(xing + 12, false);
        return {
          mime: "audio/mpeg",
          durationMs: crossCheck(
            headerMs,
            declared > 0 ? (headerMs * audioBytes) / declared : null,
          ),
        };
      }
      return { mime: "audio/mpeg", durationMs: crossCheck(headerMs, bytesMs) };
    }
  }
  const vbri = start + 4 + 32;
  if (ascii(b, vbri, "VBRI") && vbri + 18 <= b.length) {
    const declared = v.getUint32(vbri + 10, false);
    const frames = v.getUint32(vbri + 14, false);
    const headerMs = ((frames * first.samples) / first.rate) * 1000;
    return {
      mime: "audio/mpeg",
      durationMs: crossCheck(headerMs, declared > 0 ? (headerMs * audioBytes) / declared : null),
    };
  }
  // Frame walk: whole frames only; a cut last frame or trailing junk ends it.
  let walkedMs = 0;
  let at = start;
  for (let f = mp3Header(b, at); f && at + f.length <= end; f = mp3Header(b, at)) {
    walkedMs += (f.samples / f.rate) * 1000;
    at += f.length;
  }
  if (walkedMs === 0) return null;
  return { mime: "audio/mpeg", durationMs: crossCheck(walkedMs, bytesMs) };
}

// ── OGG (Vorbis, Opus) ─────────────────────────────────────────────────────────────────────────

interface OggPage {
  serial: number;
  /** null = no packet ends on this page (granule −1). */
  granule: number | null;
  body: number;
  bodyBytes: number;
}

function oggPage(b: Uint8Array, v: DataView, at: number): OggPage | null {
  if (!ascii(b, at, "OggS") || at + 27 > b.length || b[at + 4] !== 0) return null;
  const segments = b[at + 26] as number;
  if (at + 27 + segments > b.length) return null;
  let bodyBytes = 0;
  for (let i = 0; i < segments; i++) bodyBytes += b[at + 27 + i] as number;
  const body = at + 27 + segments;
  if (body + bodyBytes > b.length) return null; // truncated page: not counted
  const lo = v.getUint32(at + 6, true);
  const hi = v.getUint32(at + 10, true);
  const granule = lo === 0xffffffff && hi === 0xffffffff ? null : hi * 2 ** 32 + lo;
  return { serial: v.getUint32(at + 14, true), granule, body, bodyBytes };
}

/**
 * `OggS`, a Vorbis or Opus id header: the last granule ÷ the rate (Opus: minus pre-skip, 48 kHz).
 * Cross-check over the pages: the granule per body byte of the pages before the last, times all
 * audio bytes (a single audio page has nothing to check against).
 */
function probeOgg(b: Uint8Array): AudioProbe {
  if (!ascii(b, 0, "OggS")) return null;
  const v = view(b);
  const first = oggPage(b, v, 0);
  if (!first) return null;
  let rate: number;
  let preSkip = 0;
  if (b[first.body] === 1 && ascii(b, first.body + 1, "vorbis") && first.bodyBytes >= 16) {
    rate = v.getUint32(first.body + 12, true);
  } else if (ascii(b, first.body, "OpusHead") && first.bodyBytes >= 19) {
    rate = 48_000; // Opus granules always count 48 kHz samples
    preSkip = v.getUint16(first.body + 10, true);
  } else {
    return null;
  }
  if (rate < 1 || rate > 384_000) return null;
  const audio: OggPage[] = [];
  let at = 0;
  for (let p: OggPage | null = first; p; p = oggPage(b, v, at)) {
    if (p.serial === first.serial && p.granule !== null && p.granule > 0) audio.push(p);
    at = p.body + p.bodyBytes;
  }
  const lastPage = audio.at(-1);
  if (!lastPage) return null;
  const granuleMs = (g: number) => (Math.max(0, g - preSkip) / rate) * 1000;
  const headerMs = granuleMs(Math.max(...audio.map((p) => p.granule as number)));
  const before = audio.at(-2);
  let bytesMs: number | null = null;
  if (before) {
    const upTo = audio.slice(0, -1).reduce((n, p) => n + p.bodyBytes, 0);
    const all = upTo + lastPage.bodyBytes;
    bytesMs = upTo > 0 ? (granuleMs(before.granule as number) * all) / upTo : null;
  }
  return { mime: "audio/ogg", durationMs: crossCheck(headerMs, bytesMs) };
}
