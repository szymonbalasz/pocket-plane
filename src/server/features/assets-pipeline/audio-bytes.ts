// Sound files built in code (FR-ASSET-53 tests, the `audio-chime` fixture, e2e upload files): no
// binary is committed. WAV carries real PCM; the MP3 / OGG builders write valid headers around
// silent (zero) bodies, which is all the probe reads.

export interface WavOptions {
  rate?: number;
  channels?: number;
  bits?: number;
  /** PCM bytes as stored (little-endian samples); length = the real data. */
  data: Uint8Array;
  /** Header lies for the cross-check tests. */
  byteRate?: number;
  dataSize?: number;
  format?: number;
}

/** A canonical 44-byte-header RIFF / WAVE file. */
export function wavFile(o: WavOptions): Uint8Array {
  const rate = o.rate ?? 22_050;
  const channels = o.channels ?? 1;
  const bits = o.bits ?? 16;
  const out = new Uint8Array(44 + o.data.length);
  const v = new DataView(out.buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i);
  };
  text(0, "RIFF");
  v.setUint32(4, 36 + o.data.length, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, o.format ?? 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, o.byteRate ?? (rate * channels * bits) / 8, true);
  v.setUint16(32, (channels * bits) / 8, true);
  v.setUint16(34, bits, true);
  text(36, "data");
  v.setUint32(40, o.dataSize ?? o.data.length, true);
  out.set(o.data, 44);
  return out;
}

/** Silent PCM of `ms` (16-bit unless `bits` says otherwise). */
export function silentWav(ms: number, o: Omit<WavOptions, "data"> = {}): Uint8Array {
  const rate = o.rate ?? 22_050;
  const block = ((o.channels ?? 1) * (o.bits ?? 16)) / 8;
  const frames = Math.round((rate * ms) / 1000);
  return wavFile({ ...o, data: new Uint8Array(frames * block) });
}

/** MPEG-1 Layer III, 128 kbit/s, 44.1 kHz, stereo: 417 bytes and 1,152 samples a frame. */
const MP3_FRAME_HEADER = [0xff, 0xfb, 0x90, 0x00];
export const MP3_FRAME_BYTES = 417;
export const MP3_FRAME_MS = (1152 / 44_100) * 1000;

export interface Mp3Options {
  frames: number;
  /** Prepend an ID3v2 tag of this many body bytes. */
  id3?: number;
  /** A Xing / Info frame first, claiming this many frames (and `xingBytes` if given). */
  xingFrames?: number;
  xingBytes?: number;
  /** A VBRI frame first, claiming this many frames. */
  vbriFrames?: number;
}

export function mp3File(o: Mp3Options): Uint8Array {
  const parts: Uint8Array[] = [];
  if (o.id3 !== undefined) {
    const tag = new Uint8Array(10 + o.id3);
    tag.set([0x49, 0x44, 0x33, 4, 0, 0]);
    tag.set([(o.id3 >> 21) & 0x7f, (o.id3 >> 14) & 0x7f, (o.id3 >> 7) & 0x7f, o.id3 & 0x7f], 6);
    parts.push(tag);
  }
  const frame = () => {
    const f = new Uint8Array(MP3_FRAME_BYTES);
    f.set(MP3_FRAME_HEADER);
    return f;
  };
  if (o.xingFrames !== undefined) {
    const f = frame();
    const v = new DataView(f.buffer);
    const at = 4 + 32; // MPEG-1 stereo side info
    f.set([0x58, 0x69, 0x6e, 0x67], at); // "Xing"
    v.setUint32(at + 4, o.xingBytes !== undefined ? 3 : 1, false);
    v.setUint32(at + 8, o.xingFrames, false);
    if (o.xingBytes !== undefined) v.setUint32(at + 12, o.xingBytes, false);
    parts.push(f);
  }
  if (o.vbriFrames !== undefined) {
    const f = frame();
    const v = new DataView(f.buffer);
    const at = 4 + 32;
    f.set([0x56, 0x42, 0x52, 0x49], at); // "VBRI"
    v.setUint32(at + 10, (o.frames + 1) * MP3_FRAME_BYTES, false);
    v.setUint32(at + 14, o.vbriFrames, false);
    parts.push(f);
  }
  for (let i = 0; i < o.frames; i++) parts.push(frame());
  return concat(parts);
}

export interface OggOptions {
  codec: "vorbis" | "opus";
  /** Granule of each audio page, in order; each page carries `pageBytes` body bytes. */
  granules: number[];
  pageBytes?: number;
  /** Vorbis sample rate (Opus counts 48 kHz). */
  rate?: number;
  preSkip?: number;
}

function oggPage(serial: number, seq: number, granule: number, body: Uint8Array): Uint8Array {
  const segments: number[] = [];
  let left = body.length;
  while (left >= 255) {
    segments.push(255);
    left -= 255;
  }
  segments.push(left);
  const page = new Uint8Array(27 + segments.length + body.length);
  const v = new DataView(page.buffer);
  page.set([0x4f, 0x67, 0x67, 0x53, 0, seq === 0 ? 2 : 0]);
  v.setUint32(6, granule % 2 ** 32, true);
  v.setUint32(10, Math.floor(granule / 2 ** 32), true);
  v.setUint32(14, serial, true);
  v.setUint32(18, seq, true);
  page[26] = segments.length;
  page.set(segments, 27);
  page.set(body, 27 + segments.length);
  return page;
}

export function oggFile(o: OggOptions): Uint8Array {
  const serial = 0x1234;
  let id: Uint8Array;
  if (o.codec === "vorbis") {
    id = new Uint8Array(30);
    const v = new DataView(id.buffer);
    id.set([1, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73]); // "\x01vorbis"
    id[11] = 1; // channels
    v.setUint32(12, o.rate ?? 44_100, true);
  } else {
    id = new Uint8Array(19);
    const v = new DataView(id.buffer);
    id.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, 1, 1]); // "OpusHead", v1, mono
    v.setUint16(10, o.preSkip ?? 312, true);
    v.setUint32(12, 48_000, true);
  }
  const pages = [oggPage(serial, 0, 0, id), oggPage(serial, 1, 0, new Uint8Array(40))];
  o.granules.forEach((g, i) => {
    pages.push(oggPage(serial, i + 2, g, new Uint8Array(o.pageBytes ?? 1000)));
  });
  return concat(pages);
}

export function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
